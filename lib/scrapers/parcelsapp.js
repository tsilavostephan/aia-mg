// Fonction serverless Vercel : scraping headless de la page de suivi PARCELSAPP (parcelsapp.com).
//
// Comme CNE, ce site n'accepte qu'un seul numéro par lien (https://parcelsapp.com/en/tracking/NUM)
// — voir chunkSize:1 + scrapeChunkSize:10 sur l'entrée 'parcelsapp' dans CARRIERS
// (assets/script.js) : l'app envoie plusieurs numéros par appel de fonction, et on boucle ici
// dessus dans le même navigateur déjà lancé, pour éviter un lancement par colis.
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
  // Marge sous la limite de 60s de la fonction Vercel. Plus généreuse que pour CNE : ce site
  // interroge plusieurs transporteurs en direct avant d'afficher le tableau de résultats, ce qui
  // peut prendre plusieurs secondes (confirmé : pas de blocage, juste plus lent qu'un site classique
  // à une seule source).
  const TIME_BUDGET_MS = 50000;
  try {
    browser = await launchStealthBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin'));
    let page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });

    const results = [];
    const perNumberDebug = [];
    let stoppedEarly = false;

    for (const num of trackingNumbers) {
      if (Date.now() - startTime > TIME_BUDGET_MS) { stoppedEarly = true; break; }
      const url = `https://parcelsapp.com/en/tracking/${encodeURIComponent(num)}`;
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        // Le tableau n'apparaît qu'une fois les transporteurs interrogés en direct (peut prendre
        // plusieurs secondes) — on attend son apparition plutôt qu'une pause fixe trop courte, avec
        // pageLoadWaitMs comme marge supplémentaire une fois le tableau présent.
        const tableFound = await page.waitForSelector('table.parcel-attributes', { timeout: 20000 }).then(() => true).catch(() => false);
        await new Promise((r) => setTimeout(r, pageLoadWaitMs));

        let lastKm = await extractLastMile(page);
        if (!lastKm) {
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

    const debug = { requestedCount: trackingNumbers.length, resultCount: results.length, stoppedEarly };
    if (results.length === 0) {
      debug.perNumberDebug = perNumberDebug;
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
      }));
      Object.assign(debug, domDebug);
      debug.structureChangeWarning = buildStructureChangeWarning(domDebug);
    }

    await page.close().catch(() => {});
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    await discardStealthBrowser(browser);
    const message = e && e.message ? e.message : 'échec du scraping PARCELSAPP';
    res.status(502).json({ error: message });
  }
};
