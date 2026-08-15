// Fonction serverless Vercel : scraping headless de la page de suivi YANWEN.
//
// Contrairement à 4PX, la page https://track.yw56.com.cn/en/querydel?nums=... affiche d'abord un
// champ pré-rempli avec les numéros de suivi : il faut appuyer sur Entrée pour lancer la recherche,
// ce qui affiche ensuite la page de résultats. On y clique sur le bouton "Copy Track"
// (id="copyTrack", title="Copy summarily tracking results for all numbers.") et on lit le texte
// copié dans le presse-papier du navigateur headless — même règle de découpage que l'import manuel
// par collage (colonne 0 = numéro de suivi, colonne 1 = numéro dernier kilométrique) — voir
// parseOverviewText dans api/_scrapeLib.js et parseTrackingPaste dans assets/script.js.
//
// ⚠️ Non vérifié en conditions réelles (pas de navigateur disponible pour tester dans cet
// environnement) : le délai après l'appui sur Entrée est une estimation à ajuster si besoin,
// contrairement au sélecteur du bouton qui est un id stable fourni par l'utilisateur.
const path = require('node:path');
const {
  launchBrowser,
  parseOverviewText,
  setCorsHeaders,
  parseScrapeRequest,
  readClipboardWithSentinelCheck,
} = require('./_scrapeLib');

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

  const url = `https://track.yw56.com.cn/en/querydel?nums=${encodeURIComponent(trackingNumbers.join(','))}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });
    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    // La page affichée pré-remplit un champ avec les numéros collés dans l'URL ; il faut appuyer
    // sur Entrée pour lancer la recherche, ce qui charge la page de résultats. Mais une touche
    // Entrée simulée n'a aucun effet si aucun élément n'a le focus — on clique donc d'abord dans le
    // champ de saisie pré-rempli pour lui donner le focus.
    const submitDebug = { inputFound: false, navigated: false };
    try {
      const inputHandle = (await page.evaluateHandle(() => {
        const candidates = Array.from(document.querySelectorAll('textarea, input[type="text"], input:not([type])'));
        return candidates.find(el => el.offsetParent !== null) || candidates[0] || null;
      })).asElement();
      submitDebug.inputFound = !!inputHandle;

      if (inputHandle) {
        await inputHandle.click({ clickCount: 3 }).catch(() => {});
        await new Promise(r => setTimeout(r, 200));
      }
      await page.keyboard.press('Enter').catch(() => {});

      submitDebug.navigated = await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 })
        .then(() => true)
        .catch(() => false);

      // Si aucune navigation n'a été détectée, on tente en repli de cliquer un bouton/icône de
      // recherche visible (ex. la flèche bleue à droite du champ) au cas où Entrée seule ne suffise pas.
      if (!submitDebug.navigated) {
        submitDebug.searchBtnClicked = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button, a, svg, [role="button"]'))
            .find(el => el.offsetParent !== null && (
              el.tagName === 'BUTTON' || el.tagName === 'SVG' || /search|submit|arrow|query/i.test(el.className || '')
            ));
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (submitDebug.searchBtnClicked) {
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
        }
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
    }

    await browser.close();
    res.status(200).json({ results, usedOverviewButton: !!overviewText, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping YANWEN';
    res.status(502).json({ error: message });
  }
};
