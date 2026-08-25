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
  // Un seul numéro à la fois (au lieu de plusieurs pages en parallèle) : la valeur met en réalité
  // bien plus longtemps à charger que prévu (le site interroge apparemment plusieurs transporteurs
  // en direct, voir EXTRA_VALUE_WAIT_MS ci-dessous), donc chaque tentative peut consommer la quasi
  // totalité du budget de la fonction — inutile (et coûteux en mémoire/CPU, cf. saturation Chromium
  // quand PARCELSAPP tourne en même temps) de garder plusieurs pages actives dans ce cas. Les
  // numéros non traités dans cet appel sont simplement repris au prochain lancement du scraping
  // (voir computeCarrierGroups, assets/script.js).
  const PAGE_POOL_SIZE = 1;
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
    // ordertracker.com protège son appel API de suivi par un CAPTCHA Cloudflare Turnstile, qui
    // pèse notamment sur la cohérence des signaux du navigateur (UA par défaut de Chromium headless
    // très reconnaissable, langue absente, etc.) — on aligne donc UA + Accept-Language sur un vrai
    // Chrome desktop en plus du patch StealthPlugin (navigator.webdriver, etc.), déjà appliqué au
    // niveau du navigateur (voir api/_stealthScrapeLib.js). Pas de garantie de contournement (le
    // score Turnstile dépend aussi de la réputation de l'IP du datacenter Vercel, hors de contrôle
    // ici), mais ne peut qu'aider.
    await firstPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await firstPage.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7' });
    await blockImages(firstPage);

    const results = [];
    const perNumberDebug = [];
    let stoppedEarly = false;
    let nextIndex = 0;

    // La ligne data-transit-lastmiletrackingnumber apparaît vite, mais sa valeur reste souvent
    // "…………" bien plus longtemps que prévu (constaté en prod : toujours un placeholder après 15s
    // supplémentaires — le site interroge apparemment plusieurs transporteurs en direct, comme
    // parcelsapp mais plus lentement). On attend donc désormais jusqu'à épuisement quasi complet du
    // budget restant de la fonction plutôt qu'un plafond fixe, en sondant régulièrement, pour laisser
    // sa chance à un numéro plutôt que d'abandonner trop tôt avec le placeholder.
    async function processOne(page, num) {
      const remainingMs = DEADLINE_MS - Date.now();
      if (remainingMs < 15000) { stoppedEarly = true; return; }
      const url = `https://www.ordertracker.com/fr/track/${encodeURIComponent(num)}`;
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: Math.min(30000, remainingMs) }).catch(() => null);
        const selectorTimeout = Math.max(1000, Math.min(20000, DEADLINE_MS - Date.now() - 2000));
        const tableFound = await page.waitForSelector('tr[data-transit-lastmiletrackingnumber]', { timeout: selectorTimeout }).then(() => true).catch(() => false);
        await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pageLoadWaitMs, DEADLINE_MS - Date.now() - 1000))));

        let lastKm = await extractLastMile(page);
        // Marge de 3s en fin de budget : laisse le temps de fermer la page et répondre avant la
        // coupure dure de la fonction (maxDuration 60s, vercel.json) plutôt que de sonder jusqu'à 0.
        while (!lastKm && DEADLINE_MS - Date.now() > 3000) {
          const stepMs = Math.max(0, Math.min(1000, DEADLINE_MS - Date.now() - 3000));
          await new Promise((r) => setTimeout(r, stepMs));
          lastKm = await extractLastMile(page);
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
        if (DEADLINE_MS - Date.now() < 15000) { stoppedEarly = true; return; }
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
