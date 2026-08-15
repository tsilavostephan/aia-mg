// Fonction serverless Vercel : scraping headless de la page de suivi SFC (sendfromchina.com).
//
// Contrairement aux autres transporteurs, SFC ne prend pas les numéros dans l'URL : il faut coller
// la liste dans le textarea #orderlists de https://www.sendfromchina.com/track, cliquer sur le
// bouton de recherche (div#submitTracknumber), attendre le chargement des résultats, cliquer sur le
// bouton "copy" (.copy-fresh-button) qui fait apparaître un menu, puis cliquer sur l'entrée
// "Copy the Latest Status" (span.copy-button avec onclick="copyOperate('newest')") pour copier le
// résumé dans le presse-papier — même règle de découpage que l'import manuel par collage (colonne
// matchColIndex = numéro de suivi, colonne kmColIndex = numéro dernier kilométrique, voir
// parseTrackingPaste dans assets/script.js, appliqué côté client sur le texte brut renvoyé ici).
const path = require('node:path');
const {
  launchBrowser,
  cleanNumSuivi,
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

  const url = 'https://www.sendfromchina.com/track';

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });
    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    const submitDebug = { textareaFound: false, submitBtnFound: false };
    try {
      await page.waitForSelector('#orderlists', { timeout: 15000 }).catch(() => {});
      const textareaHandle = await page.$('#orderlists');
      submitDebug.textareaFound = !!textareaHandle;
      if (textareaHandle) {
        const listText = trackingNumbers.join('\n');
        await page.evaluate((el, text) => {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, textareaHandle, listText);
      }

      const submitBtnHandle = await page.$('#submitTracknumber');
      submitDebug.submitBtnFound = !!submitBtnHandle;
      if (submitBtnHandle) {
        await submitBtnHandle.hover().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));
        await submitBtnHandle.click().catch(() => {});
        submitDebug.navigated = await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 })
          .then(() => true)
          .catch(() => false);

        // La recherche se fait en AJAX (pas de vraie navigation) : on attend que le réseau se
        // stabilise (résultats chargés) plutôt qu'un simple délai fixe, qui s'est révélé trop court
        // (le premier essai a copié un résultat vide car le tableau n'était pas encore rempli).
        if (!submitDebug.navigated) {
          submitDebug.networkIdleAfterSubmit = await page.waitForNetworkIdle({ idleTime: 800, timeout: 20000 })
            .then(() => true)
            .catch(() => false);
        }
      }
    } catch (e) {
      submitDebug.error = e && e.message;
    }

    // Marge supplémentaire pour laisser le tableau de résultats finir de se rendre côté JS.
    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    let overviewText = null;
    const clickDebug = { copyBtnFound: false, latestStatusBtnFound: false, clipboardResult: null };
    try {
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://www.sendfromchina.com', ['clipboard-read', 'clipboard-write']);

      await page.bringToFront();
      await page.evaluate(() => window.focus());

      const sentinel = await readClipboardWithSentinelCheck(page);

      const copyBtnHandle = (await page.evaluateHandle(() => {
        const byClass = document.querySelector('.copy-fresh-button');
        if (byClass) return byClass;
        return Array.from(document.querySelectorAll('div, button, span')).find(el =>
          el.offsetParent !== null && (el.textContent || '').trim().toLowerCase() === 'copy'
        ) || null;
      })).asElement();
      clickDebug.copyBtnFound = !!copyBtnHandle;

      if (copyBtnHandle) {
        await copyBtnHandle.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
        await new Promise(r => setTimeout(r, 200));
        await copyBtnHandle.hover().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));
        await copyBtnHandle.click().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));

        let latestStatusHandle = (await page.evaluateHandle(() => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const candidates = Array.from(document.querySelectorAll('span, div, a, li'));
          return candidates.find(el => el.offsetParent !== null && (
            /copy the latest status/i.test(norm(el.textContent)) ||
            (el.getAttribute('onclick') || '').includes("copyOperate('newest')")
          )) || null;
        })).asElement();

        if (!latestStatusHandle) {
          // Repli : le menu peut nécessiter un vrai clic natif plutôt qu'un clic via coordonnées
          // (cf. le même problème rencontré sur le dropdown Yun Express).
          await copyBtnHandle.evaluate(el => el.click()).catch(() => {});
          await new Promise(r => setTimeout(r, clickWaitMs));
          latestStatusHandle = (await page.evaluateHandle(() => {
            const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const candidates = Array.from(document.querySelectorAll('span, div, a, li'));
            return candidates.find(el => el.offsetParent !== null && (
              /copy the latest status/i.test(norm(el.textContent)) ||
              (el.getAttribute('onclick') || '').includes("copyOperate('newest')")
            )) || null;
          })).asElement();
        }
        clickDebug.latestStatusBtnFound = !!latestStatusHandle;
        clickDebug.copyBtnHTML = copyBtnHandle
          ? await copyBtnHandle.evaluate(el => el.outerHTML).then(h => h.slice(0, 500)).catch(() => null)
          : null;
        clickDebug.latestStatusHTML = latestStatusHandle
          ? await latestStatusHandle.evaluate(el => el.outerHTML).then(h => h.slice(0, 500)).catch(() => null)
          : null;
        clickDebug.latestStatusParentHTML = latestStatusHandle
          ? await latestStatusHandle.evaluate(el => el.parentElement ? el.parentElement.outerHTML : null).then(h => h ? h.slice(0, 1000) : null).catch(() => null)
          : null;

        if (latestStatusHandle) {
          // Vérifie qu'aucun autre élément (bannière, overlay) ne recouvre le bouton aux
          // coordonnées où Puppeteer va cliquer (cf. le même souci rencontré sur Yun Express).
          clickDebug.latestStatusObscuringElement = await latestStatusHandle.evaluate(el => {
            const rect = el.getBoundingClientRect();
            const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            if (!top) return null;
            if (top === el || el.contains(top)) return null;
            return { tag: top.tagName, className: typeof top.className === 'string' ? top.className : '' };
          }).catch(() => null);

          const clickAndRead = async () => {
            await latestStatusHandle.hover().catch(() => {});
            await new Promise(r => setTimeout(r, clickWaitMs));
            await latestStatusHandle.click().catch(() => {});
            await new Promise(r => setTimeout(r, clickWaitMs));
            // Repli : déclenche aussi un clic natif direct (bypass des coordonnées CDP) au cas où
            // un élément recouvrant intercepterait le clic réel.
            await latestStatusHandle.evaluate(el => el.click()).catch(() => {});
            await new Promise(r => setTimeout(r, clickWaitMs));
            return page.evaluate(() =>
              navigator.clipboard.readText().then(t => ({ ok: true, value: t })).catch(e => ({ ok: false, error: e && e.message }))
            );
          };

          let rawClipboard = await clickAndRead();
          // Le premier essai peut copier un résultat vide si le tableau n'a pas fini de se remplir
          // au moment du clic : on réessaie une fois après un délai supplémentaire.
          if (rawClipboard.ok && !rawClipboard.value.trim()) {
            clickDebug.emptyOnFirstTry = true;
            await new Promise(r => setTimeout(r, Math.max(pageLoadWaitMs, 3000)));
            rawClipboard = await clickAndRead();
          }

          clickDebug.clipboardResult = rawClipboard;
          clickDebug.clipboardUnchangedFromSentinel = rawClipboard.ok && rawClipboard.value === sentinel;
          overviewText = (rawClipboard.ok && rawClipboard.value.trim()) ? rawClipboard.value : null;
        }
      }
    } catch (e) {
      clickDebug.error = e && e.message;
      overviewText = null;
    }

    let results = [];
    if (!overviewText) {
      // Repli si le presse-papier headless n'est pas accessible : lecture directe des lignes du
      // tableau de résultats dans le DOM.
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('table tr')).map(tr =>
          Array.from(tr.querySelectorAll('td, th')).map(td => (td.textContent || '').trim())
        )
      );
      results = rows
        .filter(cols => cols.length >= 2 && cols[1])
        .map(cols => ({ trackingNumber: cleanNumSuivi(cols[1]), lastKm: cols.length > 2 ? cols[2] : '' }))
        .filter(r => r.trackingNumber);
    }

    const debug = { submitDebug, clickDebug, overviewTextPreview: overviewText ? overviewText.slice(0, 500) : null };

    if (!overviewText && results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
      }));
      Object.assign(debug, domDebug);
    }

    await browser.close();
    res.status(200).json({ results, rawText: overviewText || null, usedOverviewButton: !!overviewText, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping SFC';
    res.status(502).json({ error: message });
  }
};
