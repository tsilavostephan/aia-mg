// Fonction serverless Vercel : scraping headless de la page de suivi GOFO (gofo.com).
//
// Contrairement aux autres transporteurs, il n'y a ni bouton copier ni presse-papier à lire ici :
// la page https://www.gofo.com/fr/tracking-results/?id=NUM1%20NUM2 affiche directement un tableau
// (divs ".div-table-row" / ".div-table-cell") dont la 1ère colonne est le numéro de suivi d'origine
// et la 2ème colonne est déjà le numéro dernier kilométrique (ex. "GFFR26208105468739"), confirmé
// par le HTML fourni par l'utilisateur. On lit donc directement le DOM plutôt que de simuler un clic.
const path = require('node:path');
const { launchBrowser, cleanNumSuivi, setCorsHeaders, parseScrapeRequest } = require('./_scrapeLib');

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

  const url = `https://www.gofo.com/fr/tracking-results/?id=${encodeURIComponent(trackingNumbers.join(' '))}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    let rowsFound = await page.waitForSelector('.div-table-row', { timeout: 20000 }).then(() => true).catch(() => false);
    await new Promise((r) => setTimeout(r, pageLoadWaitMs));

    // Quand le lot contient des numéros de plusieurs "sites"/transporteurs différents, GOFO affiche
    // un avertissement ("Il y a XX colis provenant de sites différents...") au lieu de lancer la
    // recherche automatiquement — ce n'est pas une erreur (confirmé par l'utilisateur), il suffit de
    // cliquer sur le bouton de recherche pour continuer quand même.
    let searchBtnClicked = false;
    if (!rowsFound) {
      searchBtnClicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, a, div[role="button"]'))
          .find((el) => el.offsetParent !== null && /rechercher|search/i.test((el.textContent || '').trim()));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (searchBtnClicked) {
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
        rowsFound = await page.waitForSelector('.div-table-row', { timeout: 15000 }).then(() => true).catch(() => false);
        await new Promise((r) => setTimeout(r, pageLoadWaitMs));
      }
    }

    const rawResults = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.div-table-row')).map((row) =>
        Array.from(row.querySelectorAll('.div-table-cell')).map((cell) => (cell.textContent || '').trim())
      )
    );

    const results = rawResults
      .filter((cols) => cols.length >= 2 && cols[0])
      .map((cols) => ({ trackingNumber: cleanNumSuivi(cols[0]), lastKm: cleanNumSuivi(cols[1]) }))
      .filter((r) => r.trackingNumber && r.lastKm && r.lastKm !== r.trackingNumber);

    const debug = { rowsFound, searchBtnClicked };
    if (results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
        rowCount: document.querySelectorAll('.div-table-row').length,
      }));
      Object.assign(debug, domDebug);
    }

    await browser.close();
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping GOFO';
    res.status(502).json({ error: message });
  }
};
