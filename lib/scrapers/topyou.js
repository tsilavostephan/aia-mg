// Fonction serverless Vercel : scraping headless de la page de suivi TopYou (track.szty56.com).
//
// La zone de saisie des numéros n'est pas un simple <textarea> mais un éditeur CodeMirror
// (".CodeMirror-scroll") — il faut cliquer dedans pour le focaliser puis taper les numéros au
// clavier (un par ligne) plutôt que de manipuler sa valeur directement, CodeMirror gérant son
// propre modèle interne indépendamment de la valeur d'un éventuel <textarea> caché. On clique
// ensuite sur le bouton de recherche (a.search-right.search-btn, libellé "搜索" = "Rechercher").
//
// Les résultats s'affichent directement dans le DOM (pas de bouton copier) : chaque colis est un
// <div class="warpper"> dont le <p class="or_2"> contient le texte "运单号:XXXX ... 转单号:YYYY ...".
// "运单号" (waybill number) = numéro de suivi d'origine, "转单号" (transfer number) = numéro dernier
// kilométrique — absent tant qu'aucun transporteur final n'a encore été assigné à ce colis.
const path = require('node:path');
const { launchBrowser, discardBrowser, cleanNumSuivi, setCorsHeaders, parseScrapeRequest, buildStructureChangeWarning } = require('../../api/_scrapeLib');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { trackingNumbers, pageLoadWaitMs, clickWaitMs } = parseScrapeRequest(req);

  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    res.status(400).json({ error: 'trackingNumbers manquant ou vide' });
    return;
  }

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto('https://track.szty56.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise((r) => setTimeout(r, pageLoadWaitMs));

    const submitDebug = { editorFound: false, searchBtnFound: false };
    try {
      const editor = await page.waitForSelector('.CodeMirror-scroll', { timeout: 15000 }).catch(() => null);
      submitDebug.editorFound = !!editor;
      if (editor) {
        await editor.click().catch(() => {});
        await page.keyboard.type(trackingNumbers.join('\n'), { delay: 5 });
      }

      await new Promise((r) => setTimeout(r, clickWaitMs));

      const searchBtn = await page.$('a.search-right.search-btn');
      submitDebug.searchBtnFound = !!searchBtn;
      if (searchBtn) {
        await searchBtn.click().catch(() => {});
      }
    } catch (e) {
      submitDebug.error = e && e.message;
    }

    const warppersFound = await page.waitForSelector('.warpper', { timeout: 20000 }).then(() => true).catch(() => false);
    await new Promise((r) => setTimeout(r, pageLoadWaitMs));

    const rawParagraphs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.or_2')).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
    );

    // La recherche peut se déclencher deux fois (Entrée pendant la saisie dans CodeMirror, puis le
    // clic explicite sur le bouton), ce qui duplique les colis affichés (ex. 8 blocs pour 4 colis
    // demandés) sans que les anciens résultats soient effacés — on déduplique donc par numéro de
    // suivi avant de renvoyer les résultats.
    const seen = new Set();
    const results = rawParagraphs
      .map((text) => {
        const origMatch = text.match(/运单号[:：]\s*(\S+)/);
        const transferMatch = text.match(/转单号[:：]\s*(\S+)/);
        return {
          trackingNumber: cleanNumSuivi(origMatch ? origMatch[1] : ''),
          lastKm: cleanNumSuivi(transferMatch ? transferMatch[1] : ''),
        };
      })
      .filter((r) => r.trackingNumber && r.lastKm)
      .filter((r) => {
        if (seen.has(r.trackingNumber)) return false;
        seen.add(r.trackingNumber);
        return true;
      });

    const debug = { submitDebug, warppersFound, orParagraphCount: rawParagraphs.length, resultCount: results.length };

    if (results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
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
    const message = e && e.message ? e.message : 'échec du scraping TopYou';
    res.status(502).json({ error: message });
  }
};
