// Fonction serverless Vercel : scraping headless de la page de suivi YANWEN.
//
// Contrairement à 4PX, la page https://track.yw56.com.cn/en/querydel?nums=... affiche d'abord un
// champ pré-rempli (input#numbers_en) avec les numéros de suivi : il faut cliquer sur le bouton
// flèche <a id="search"> à côté pour lancer la recherche (confirmé par capture DevTools — Entrée
// seule ne fait rien), ce qui affiche ensuite la page de résultats. On y clique sur le bouton
// "Copy Track" (id="copyTrack", title="Copy summarily tracking results for all numbers.") et on lit
// le texte copié dans le presse-papier du navigateur headless — même règle de découpage que
// l'import manuel par collage (colonne 0 = numéro de suivi, colonne 1 = numéro dernier
// kilométrique) — voir parseOverviewText dans api/_scrapeLib.js et parseTrackingPaste dans
// assets/script.js.
const path = require('node:path');
const {
  launchBrowser,
  discardBrowser,
  parseOverviewText,
  setCorsHeaders,
  parseScrapeRequest,
  readClipboardWithSentinelCheck,
  buildStructureChangeWarning,
} = require('../../api/_scrapeLib');

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

  const url = `https://track.yw56.com.cn/en/querydel?nums=${trackingNumbers.join(',')}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });
    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    // La page affichée pré-remplit le champ #numbers_en avec les numéros collés dans l'URL ; il faut
    // cliquer sur le bouton flèche <a id="search"> à côté pour lancer la recherche, ce qui charge la
    // page de résultats (confirmé par capture DevTools de l'utilisateur — Entrée seule n'a aucun
    // effet, ce n'est pas un submit de formulaire classique).
    const submitDebug = { searchBtnFound: false, navigated: false };
    try {
      await page.waitForSelector('#search', { timeout: 15000 }).catch(() => {});
      const searchBtn = await page.$('#search');
      submitDebug.searchBtnFound = !!searchBtn;
      if (searchBtn) {
        await searchBtn.hover().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));
        await searchBtn.click().catch(() => {});
        submitDebug.navigated = await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 })
          .then(() => true)
          .catch(() => false);
      }
    } catch (e) {
      submitDebug.error = e && e.message;
    }

    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    let overviewText = null;
    const clickDebug = { iconFound: false, clipboardResult: null };
    try {
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://track.yw56.com.cn', ['clipboard-read', 'clipboard-write']);

      await page.waitForSelector('#copyTrack', { timeout: 15000 }).catch(() => {});
      await page.bringToFront();
      await page.evaluate(() => window.focus());

      const sentinel = await readClipboardWithSentinelCheck(page);

      const btnHandle = await page.$('#copyTrack');
      clickDebug.iconFound = !!btnHandle;
      if (btnHandle) {
        await btnHandle.hover().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));
        await btnHandle.click().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));

        const rawClipboard = await page.evaluate(() =>
          navigator.clipboard.readText().then(t => ({ ok: true, value: t })).catch(e => ({ ok: false, error: e && e.message }))
        );
        clickDebug.clipboardResult = rawClipboard;
        clickDebug.clipboardUnchangedFromSentinel = rawClipboard.ok && rawClipboard.value === sentinel;
        overviewText = rawClipboard.ok ? rawClipboard.value : null;
      }
    } catch (e) {
      clickDebug.error = e && e.message;
      overviewText = null;
    }

    const results = overviewText ? parseOverviewText(overviewText) : [];

    // Diagnostic : toujours inclus, pour voir précisément ce qui s'est passé (soumission de la
    // recherche puis clic de copie).
    const debug = { submitDebug, clickDebug, overviewTextPreview: overviewText ? overviewText.slice(0, 500) : null };

    if (!results || results.length === 0) {
      const domDebug = await page.evaluate(() => {
        const describe = (el) => ({
          tag: el.tagName,
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          title: el.getAttribute('title') || '',
          text: (el.textContent || '').trim().slice(0, 80),
        });
        const copyButtons = Array.from(document.querySelectorAll('[id*="copy" i], [class*="copy" i]')).map(describe);

        return {
          pageTitle: document.title,
          bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
          copyButtons,
        };
      });
      Object.assign(debug, domDebug);
      debug.structureChangeWarning = buildStructureChangeWarning(domDebug);
    }

    // Ferme uniquement la page (pas le navigateur) pour permettre sa réutilisation par un prochain
    // appel "à chaud" de cette même fonction Vercel — voir launchBrowser() dans _scrapeLib.js.
    await page.close().catch(() => {});
    res.status(200).json({ results, rawText: overviewText || null, usedOverviewButton: !!overviewText, debug });
  } catch (e) {
    await discardBrowser(browser);
    const message = e && e.message ? e.message : 'échec du scraping YANWEN';
    res.status(502).json({ error: message });
  }
};
