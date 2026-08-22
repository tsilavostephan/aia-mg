// Fonction serverless Vercel : scraping headless de la page de suivi PARCELSAPP (parcelsapp.com).
//
// Comme CNE, ce site n'accepte qu'un seul numéro par lien (https://parcelsapp.com/en/tracking/NUM)
// — voir chunkSize:1 + scrapeChunkSize:10 sur l'entrée 'parcelsapp' dans CARRIERS
// (assets/script.js) : l'app envoie plusieurs numéros par appel de fonction. On les traite ici par
// petits groupes en parallèle (PAGE_POOL_SIZE pages du même navigateur déjà lancé) plutôt qu'un par
// un en séquence, pour accélérer le débit par lot sans multiplier les fonctions Vercel simultanées.
//
// Le numéro dernier kilométrique apparaît dans le tableau "parcel-attributes", sous la ligne dont
// le libellé est exactement "Next tracking numbers" (confirmé par capture de l'utilisateur) :
//   <table class="parcel-attributes"><tbody>
//     <tr><td>Next tracking numbers</td><td class="value"><span>LP756941613FR</span></td></tr>
//   </tbody></table>
// Absent (ligne manquante ou valeur vide) pour les colis sans relais local — dans ce cas, ce colis
// est simplement ignoré (pas d'entrée dans les résultats), comme pour les autres transporteurs.
//
// parcelsapp.com a lui aussi une détection anti-bot qui bloque un Chromium headless "nu" — même
// contournement que 17TRACK (avant son abandon) via puppeteer-extra-plugin-stealth, voir
// api/_stealthScrapeLib.js.
const path = require('node:path');
const {
  cleanNumSuivi,
  setCorsHeaders,
  parseScrapeRequest,
  buildStructureChangeWarning,
} = require('../../api/_scrapeLib');
const { launchStealthBrowser, discardStealthBrowser } = require('../../api/_stealthScrapeLib');

async function extractLastMile(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('table.parcel-attributes tr'));
    const row = rows.find((tr) => {
      const label = tr.querySelector('td');
      return label && /^next tracking numbers$/i.test(norm(label.textContent));
    });
    if (!row) return '';
    const valueCell = row.querySelector('td.value');
    if (!valueCell) return '';
    const span = valueCell.querySelector('span');
    return norm(span ? span.textContent : valueCell.textContent);
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
  // FUNCTION_INVOCATION_TIMEOUT constaté en prod (maxDuration 60s dans vercel.json) : un
  // waitForSelector fixe de 20s par numéro, multiplié par plusieurs numéros dans le même lot
  // (scrapeChunkSize), peut largement dépasser la limite si plusieurs colis n'ont aucune donnée
  // (le tableau n'apparaît alors jamais, le timeout est donc systématiquement atteint en entier).
  // DEADLINE_MS est une échéance absolue : le timeout de chaque attente est recalculé à partir du
  // temps réellement restant, pour renvoyer les résultats déjà trouvés avant la coupure plutôt que
  // de se faire tuer sans réponse. Les numéros non traités restent simplement non résolus et seront
  // repris par le prochain lancement du scraping (voir computeCarrierGroups dans assets/script.js).
  const DEADLINE_MS = startTime + 52000;
  // Traite plusieurs numéros en parallèle dans des pages distinctes du même navigateur (au lieu
  // d'un seul numéro à la fois) : chaque page attend son propre chargement/tableau indépendamment,
  // ce qui multiplie le débit par lot sans lancer davantage de fonctions Vercel en parallèle (voir
  // MAX_CONCURRENT_SCRAPES côté client, assets/script.js) — donc sans aggraver le risque de
  // détection anti-bot ou de saturation des exécutions concurrentes de la plateforme.
  const PAGE_POOL_SIZE = 3;
  try {
    browser = await launchStealthBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin'));
    const firstPage = await browser.newPage();
    await firstPage.setViewport({ width: 1366, height: 900 });

    const results = [];
    const perNumberDebug = [];
    let stoppedEarly = false;
    let nextIndex = 0;

    async function processOne(page, num) {
      const remainingMs = DEADLINE_MS - Date.now();
      // Marge minimale pour qu'une tentative ait un sens (navigation + une attente courte) : en
      // dessous, on renonce plutôt que de démarrer un numéro qu'on ne pourra pas terminer à temps.
      if (remainingMs < 8000) { stoppedEarly = true; return; }
      const url = `https://parcelsapp.com/en/tracking/${encodeURIComponent(num)}`;
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(30000, remainingMs) }).catch(() => null);
        // Le tableau n'apparaît qu'une fois les transporteurs interrogés en direct (peut prendre
        // plusieurs secondes) — on attend son apparition plutôt qu'une pause fixe trop courte, avec
        // pageLoadWaitMs comme marge supplémentaire une fois le tableau présent. Le timeout de cette
        // attente est plafonné par le temps réellement restant avant DEADLINE_MS.
        const selectorTimeout = Math.max(1000, Math.min(20000, DEADLINE_MS - Date.now() - 2000));
        const tableFound = await page.waitForSelector('table.parcel-attributes', { timeout: selectorTimeout }).then(() => true).catch(() => false);
        await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pageLoadWaitMs, DEADLINE_MS - Date.now() - 1000))));

        let lastKm = await extractLastMile(page);
        if (!lastKm && DEADLINE_MS - Date.now() > 4000) {
          await new Promise((r) => setTimeout(r, 3000));
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
        if (DEADLINE_MS - Date.now() < 8000) { stoppedEarly = true; return; }
        const num = trackingNumbers[nextIndex++];
        await processOne(page, num);
      }
    }

    const extraPages = [];
    for (let i = 1; i < Math.min(PAGE_POOL_SIZE, trackingNumbers.length); i++) {
      const p = await browser.newPage();
      await p.setViewport({ width: 1366, height: 900 });
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
    const message = e && e.message ? e.message : 'échec du scraping PARCELSAPP';
    res.status(502).json({ error: message });
  }
};
