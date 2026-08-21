// Fonction serverless Vercel : scraping headless de la page de suivi LANDMARK (landmarkglobal.com).
//
// Contrairement aux autres transporteurs, il n'y a ni bouton de copie ni presse-papier à lire ici :
// la page https://track.landmarkglobal.com/?search=NUM1,+NUM2 affiche directement, pour chaque
// colis, un bloc "Shipment X of Y ... · LTNxxxxxxxxx" (le numéro de suivi LANDMARK) suivi d'une
// carte contenant les détails du transporteur final. Cette carte contient toujours, y compris pour
// le transporteur final "Postal Carrier" dont le numéro n'apparaît nulle part ailleurs dans le texte
// visible, un <noscript><input class="tracking_submit" value="LE255009588BE" ...></noscript> — dont
// la valeur correspond exactement au numéro dernier kilométrique attendu (confirmé sur les deux cas
// de figure observés : Colis Prive et Postal Carrier/bpost). On lit donc directement cette valeur
// dans le DOM plutôt que de simuler un clic de copie.
const path = require('node:path');
const { launchBrowser, discardBrowser, cleanNumSuivi, setCorsHeaders, parseScrapeRequest, buildStructureChangeWarning } = require('../../api/_scrapeLib');

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

  const url = `https://track.landmarkglobal.com/?search=${encodeURIComponent(trackingNumbers.join(', '))}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });
    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    const rawResults = await page.evaluate(() => {
      // Chaque bloc d'expédition est une <div> "feuille" (sans enfant élément) dont le texte finit
      // par "... · LTNxxxxxxxxx", immédiatement suivie de la <div class="card"> avec les détails.
      const headers = Array.from(document.querySelectorAll('div')).filter(d =>
        d.children.length === 0 && /Shipment\s+\d+\s+of\s+\d+/i.test(d.textContent || '')
      );

      const out = [];
      headers.forEach(h => {
        const text = (h.textContent || '').replace(/\s+/g, ' ').trim();
        const m = text.match(/·\s*([A-Za-z0-9]+)\s*$/);
        if (!m) return;
        const trackingNumber = m[1];

        let card = h.nextElementSibling;
        while (card && !(card.classList && card.classList.contains('card'))) card = card.nextElementSibling;

        let lastKm = '';
        if (card) {
          const noscriptEl = card.querySelector('noscript');
          if (noscriptEl) {
            const raw = noscriptEl.textContent || '';
            const vm = raw.match(/class=['"]tracking_submit['"][^>]*value=['"]([^'"]+)['"]/)
              || raw.match(/value=['"]([^'"]+)['"][^>]*class=['"]tracking_submit['"]/);
            if (vm) lastKm = vm[1];
          }
        }
        out.push({ trackingNumber, lastKm });
      });
      return out;
    });

    // La page affiche le numéro LTN "de base" (ex. "LTN473434883"), sans le suffixe que la base de
    // données conserve (ex. "LTN473434883N1") — on retrouve donc le numéro d'origine tel qu'envoyé
    // en entrée (celui qui correspond réellement à la commande en base) plutôt que la version
    // tronquée affichée par le site.
    const results = rawResults
      .map(r => {
        const scraped = cleanNumSuivi(r.trackingNumber);
        const original = trackingNumbers.find(n => cleanNumSuivi(n).startsWith(scraped)) || scraped;
        return { trackingNumber: cleanNumSuivi(original), lastKm: cleanNumSuivi(r.lastKm) };
      })
      .filter(r => r.trackingNumber);

    const debug = {};
    if (results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
        shipmentHeaderCount: Array.from(document.querySelectorAll('div')).filter(d =>
          d.children.length === 0 && /Shipment\s+\d+\s+of\s+\d+/i.test(d.textContent || '')
        ).length,
      }));
      Object.assign(debug, domDebug);
      debug.structureChangeWarning = buildStructureChangeWarning(domDebug);
    }

    // Ferme uniquement la page (pas le navigateur) pour permettre sa réutilisation par un prochain
    // appel "à chaud" de cette même fonction Vercel — voir launchBrowser() dans _scrapeLib.js.
    await page.close().catch(() => {});
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    await discardBrowser(browser);
    const message = e && e.message ? e.message : 'échec du scraping LANDMARK';
    res.status(502).json({ error: message });
  }
};
