// Fonction serverless Vercel : scraping headless de la page de suivi CNE (cne.com).
//
// Contrairement aux autres transporteurs, ce site n'accepte qu'un seul numéro par lien
// (https://www.cne.com/en/track?no=NUM) — voir chunkSize:1 sur l'entrée 'cne' dans CARRIERS
// (assets/script.js), qui fait que l'application appelle cette fonction une fois par colis. On
// traite malgré tout trackingNumbers comme un tableau (boucle), pour rester robuste si jamais ce
// réglage change.
//
// La page affiche directement dans le panneau "Shipment Information" un libellé "Last mile
// number" suivi de sa valeur (ex. "6A07434243409") — confirmé par capture d'écran de l'utilisateur.
// Lecture directe du DOM, pas de bouton copier à cliquer.
const path = require('node:path');
const { launchBrowser, cleanNumSuivi, setCorsHeaders, parseScrapeRequest } = require('./_scrapeLib');

async function extractLastMile(page) {
  return page.evaluate(() => {
    const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const allEls = Array.from(document.querySelectorAll('body *'));
    const labelEl = allEls.find((el) => el.children.length === 0 && /^last mile number$/i.test(textOf(el)));
    if (!labelEl) return '';
    let sib = labelEl.nextElementSibling;
    while (sib && !textOf(sib)) sib = sib.nextElementSibling;
    if (!sib) return '';
    const m = textOf(sib).match(/^(\S+)/);
    return m ? m[1] : '';
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
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));
    const page = await browser.newPage();

    const results = [];
    const perNumberDebug = [];

    for (const num of trackingNumbers) {
      const url = `https://www.cne.com/en/track?no=${encodeURIComponent(num)}`;
      try {
        let response = null;
        let navigateAttempts = 0;

        // La navigation aboutit parfois sur "about:blank" (page vide, ~39 caractères de HTML) au
        // lieu du vrai site — probablement transitoire (DNS, redirection avortée) : on retente
        // jusqu'à 3 fois avant d'abandonner ce colis.
        for (navigateAttempts = 1; navigateAttempts <= 3; navigateAttempts++) {
          response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);
          await new Promise((r) => setTimeout(r, Math.max(pageLoadWaitMs, 3000)));
          if (page.url() !== 'about:blank') break;
        }

        let lastKm = await extractLastMile(page);
        if (!lastKm) {
          await new Promise((r) => setTimeout(r, 3000));
          lastKm = await extractLastMile(page);
        }

        if (lastKm) {
          results.push({ trackingNumber: cleanNumSuivi(num), lastKm: cleanNumSuivi(lastKm) });
        } else {
          const htmlLength = await page.content().then((h) => h.length).catch(() => -1);
          perNumberDebug.push({
            num,
            found: false,
            httpStatus: response ? response.status() : null,
            finalUrl: page.url(),
            htmlLength,
            navigateAttempts,
          });
        }
      } catch (e) {
        perNumberDebug.push({ num, error: e && e.message });
      }
    }

    const debug = { requestedCount: trackingNumbers.length, resultCount: results.length };
    if (results.length === 0) {
      debug.perNumberDebug = perNumberDebug;
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
      }));
      Object.assign(debug, domDebug);
    }

    await browser.close();
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping CNE';
    res.status(502).json({ error: message });
  }
};
