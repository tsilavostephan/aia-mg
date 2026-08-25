// Fonction serverless Vercel : scraping headless de la page de suivi OrderTracker
// (ordertracker.com), utilisé par défaut pour WanB et WanbExpress.
//
// Comme PARCELSAPP, ce site n'accepte qu'un seul numéro par lien
// (https://www.ordertracker.com/fr/track/NUM) — voir chunkSize:1 + scrapeChunkSize:10 sur l'entrée
// 'ordertracker' dans CARRIERS (assets/script.js) : l'app envoie plusieurs numéros par appel de
// fonction. On les traite ici par petits groupes en parallèle (PAGE_POOL_SIZE pages du même
// navigateur déjà lancé) plutôt qu'un par un en séquence, même principe que
// lib/scrapers/parcelsapp.js.
//
// Le numéro dernier kilométrique apparaît dans une ligne de tableau marquée par l'attribut
// data-transit-lastmiletrackingnumber, sous la forme (confirmée par capture de l'utilisateur) :
//   <tr data-transit-lastmiletrackingnumber="">
//     <td>Numéro de suivi du dernier kilomètre</td>
//     <td>DOFR9010186269552HD</td>
//   </tr>
// Absent (ligne manquante ou valeur vide) pour les colis sans relais local — dans ce cas, ce colis
// est simplement ignoré (pas d'entrée dans les résultats), comme pour les autres transporteurs.
const path = require('node:path');
const {
  cleanNumSuivi,
  setCorsHeaders,
  parseScrapeRequest,
  buildStructureChangeWarning,
} = require('../../api/_scrapeLib');
const { launchStealthBrowser, discardStealthBrowser } = require('../../api/_stealthScrapeLib');

// Bloque le chargement des images (inutiles pour lire la ligne data-transit-lastmiletrackingnumber)
// pour accélérer chaque page.
async function blockImages(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.resourceType() === 'image') req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

async function extractLastMile(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const row = document.querySelector('tr[data-transit-lastmiletrackingnumber]');
    if (!row) return '';
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) return '';
    const value = norm(cells[1].textContent);
    // La valeur est chargée en AJAX après le rendu initial de la ligne : un espace réservé de
    // points ("..................") s'affiche le temps du chargement, ce n'est pas un vrai
    // numéro de suivi — on n'accepte donc que des valeurs réellement alphanumériques, et on
    // continue d'attendre sinon (voir la boucle d'attente dans processOne ci-dessous).
    if (!/[a-z0-9]/i.test(value)) return '';
    return value;
  });
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { trackingNumbers, pageLoadWaitMs } = parseScrapeRequest(req);

  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    res.status(400).json({ error: 'trackingNumbers manquant ou vide' });
    return;
  }

  let browser;
  const startTime = Date.now();
  // Même mécanisme d'échéance absolue que lib/scrapers/parcelsapp.js : DEADLINE_MS recalcule le
  // timeout de chaque attente à partir du temps réellement restant, pour renvoyer les résultats déjà
  // trouvés avant la coupure (maxDuration 60s, vercel.json) plutôt que de se faire tuer sans réponse.
  // Marge de 15s (au lieu d'une échéance trop proche des 60s) : le chargement des modules
  // (puppeteer-extra + évasions stealth) au démarrage à froid se produit avant handler() et n'est
  // donc pas compté dans startTime.
  const DEADLINE_MS = startTime + 45000;
  // Traite plusieurs numéros en parallèle dans des pages distinctes du même navigateur, même
  // principe que lib/scrapers/parcelsapp.js (voir MAX_CONCURRENT_SCRAPES côté client,
  // assets/script.js). Volontairement limité à 2 (au lieu de 4) : PARCELSAPP et ORDERTRACKER
  // peuvent tourner en même temps (deux transporteurs distincts scrapés en parallèle côté client),
  // chacun lançant potentiellement plusieurs invocations Vercel simultanées — un pool trop large par
  // fonction multiplie le risque de saturer Chromium (mémoire/CPU) une fois cumulé entre les deux.
  const PAGE_POOL_SIZE = 2;
  try {
    // Le lancement du navigateur n'est pas borné par défaut : s'il traîne (ou reste bloqué), la
    // fonction se fait tuer par Vercel à 60s (FUNCTION_INVOCATION_TIMEOUT, sans réponse) plutôt que
    // de renvoyer une erreur exploitable. On le fait donc courir contre l'échéance restante.
    const launchTimeoutMs = Math.max(1000, DEADLINE_MS - Date.now());
    browser = await Promise.race([
      launchStealthBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin')),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`Lancement du navigateur trop long (> ${launchTimeoutMs}ms)`)),
        launchTimeoutMs,
      )),
    ]);
    const firstPage = await browser.newPage();
    await firstPage.setViewport({ width: 1366, height: 900 });
    await blockImages(firstPage);

    const results = [];
    const perNumberDebug = [];
    let stoppedEarly = false;
    let nextIndex = 0;

    // La ligne data-transit-lastmiletrackingnumber apparaît vite, mais sa valeur reste souvent
    // "…………" (chargement AJAX en arrière-plan) plusieurs secondes de plus — on attend donc jusqu'à
    // 15s supplémentaires (au-delà de pageLoadWaitMs), en sondant régulièrement plutôt qu'une seule
    // pause fixe, pour ne pas repartir avec le placeholder au lieu de la vraie valeur.
    const EXTRA_VALUE_WAIT_MS = 15000;

    async function processOne(page, num) {
      const remainingMs = DEADLINE_MS - Date.now();
      // Marge relevée (12s, au lieu de 8s) : un numéro peut désormais consommer jusqu'à
      // EXTRA_VALUE_WAIT_MS de plus qu'avant, inutile de démarrer une tentative qu'on ne pourra
      // manifestement pas mener à son terme.
      if (remainingMs < 12000) { stoppedEarly = true; return; }
      const url = `https://www.ordertracker.com/fr/track/${encodeURIComponent(num)}`;
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: Math.min(30000, remainingMs) }).catch(() => null);
        const selectorTimeout = Math.max(1000, Math.min(20000, DEADLINE_MS - Date.now() - 2000));
        const tableFound = await page.waitForSelector('tr[data-transit-lastmiletrackingnumber]', { timeout: selectorTimeout }).then(() => true).catch(() => false);
        await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pageLoadWaitMs, DEADLINE_MS - Date.now() - 1000))));

        let lastKm = await extractLastMile(page);
        if (!lastKm) {
          const extraWaitDeadline = Date.now() + EXTRA_VALUE_WAIT_MS;
          while (!lastKm && Date.now() < extraWaitDeadline && DEADLINE_MS - Date.now() > 2000) {
            const stepMs = Math.max(0, Math.min(1000, extraWaitDeadline - Date.now(), DEADLINE_MS - Date.now() - 1000));
            await new Promise((r) => setTimeout(r, stepMs));
            lastKm = await extractLastMile(page);
          }
        }

        if (lastKm) {
          results.push({ trackingNumber: cleanNumSuivi(num), lastKm: cleanNumSuivi(lastKm) });
        } else {
          perNumberDebug.push({
            num,
            found: false,
            tableFound,
            httpStatus: response ? response.status() : null,
            finalUrl: page.url(),
          });
        }
      } catch (e) {
        perNumberDebug.push({ num, error: e && e.message });
      }
    }

    async function worker(page) {
      while (nextIndex < trackingNumbers.length) {
        if (DEADLINE_MS - Date.now() < 8000) { stoppedEarly = true; return; }
        const num = trackingNumbers[nextIndex++];
        await processOne(page, num);
      }
    }

    const extraPages = [];
    for (let i = 1; i < Math.min(PAGE_POOL_SIZE, trackingNumbers.length); i++) {
      const p = await browser.newPage();
      await p.setViewport({ width: 1366, height: 900 });
      await blockImages(p);
      extraPages.push(p);
    }

    await Promise.all([firstPage, ...extraPages].map((p) => worker(p)));
    await Promise.all(extraPages.map((p) => p.close().catch(() => {})));

    const debug = { requestedCount: trackingNumbers.length, resultCount: results.length, stoppedEarly };
    if (results.length === 0) {
      debug.perNumberDebug = perNumberDebug;
      const domDebug = await firstPage.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
      }));
      Object.assign(debug, domDebug);
      debug.structureChangeWarning = buildStructureChangeWarning(domDebug);
    }

    await firstPage.close().catch(() => {});
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    await discardStealthBrowser(browser);
    const message = e && e.message ? e.message : 'échec du scraping OrderTracker';
    res.status(502).json({ error: message });
  }
};
