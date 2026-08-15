// Fonction serverless Vercel : scraping headless de la page de suivi Yun Express (yuntrack.com).
//
// La page https://www.yuntrack.com/parcelTracking?id=... affiche un bouton "Copy & Export"
// (menu déroulant type element-ui, ouvert au survol). Il faut d'abord survoler ce bouton pour que
// le menu apparaisse, puis cliquer sur l'entrée "Copy Summary" pour copier le résumé dans le
// presse-papier — même règle de découpage que l'import manuel par collage (colonne 0 = numéro de
// suivi, colonne 1 = numéro dernier kilométrique) — voir parseOverviewText dans api/_scrapeLib.js
// et parseTrackingPaste dans assets/script.js.
const path = require('node:path');
const {
  launchBrowser,
  cleanNumSuivi,
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

  const url = `https://www.yuntrack.com/parcelTracking?id=${encodeURIComponent(trackingNumbers.join(','))}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });
    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    let overviewText = null;
    const clickDebug = { dropdownBtnFound: false, menuItemFound: false, clipboardResult: null };
    try {
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://www.yuntrack.com', ['clipboard-read', 'clipboard-write']);

      // Confirmé par capture DevTools : <button class="el-button el-button--primary
      // el-dropdown-selfdefine" aria-haspopup="list" aria-controls="dropdown-menu-XXXX">Copy & Export</button>
      await page.waitForSelector('button.el-dropdown-selfdefine', { timeout: 15000 }).catch(() => {});

      await page.bringToFront();
      await page.evaluate(() => window.focus());

      const sentinel = await readClipboardWithSentinelCheck(page);

      const dropdownBtnHandle = (await page.evaluateHandle(() => {
        const byClass = document.querySelector('button.el-dropdown-selfdefine');
        if (byClass) return byClass;
        return Array.from(document.querySelectorAll('button')).find(b => /copy\s*&?\s*export/i.test(b.textContent || '')) || null;
      })).asElement();
      clickDebug.dropdownBtnFound = !!dropdownBtnHandle;

      if (dropdownBtnHandle) {
        // Le menu déroulant element-ui s'ouvre au survol réel (pas au clic synthétique).
        await dropdownBtnHandle.hover().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));

        const menuItemHandle = (await page.evaluateHandle(() => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const candidates = Array.from(document.querySelectorAll('li, .el-dropdown-menu__item, [role="menuitem"]'));
          return candidates.find(el => el.offsetParent !== null && /copy\s*summary/i.test(norm(el.textContent))) || null;
        })).asElement();
        clickDebug.menuItemFound = !!menuItemHandle;

        if (menuItemHandle) {
          await menuItemHandle.hover().catch(() => {});
          await new Promise(r => setTimeout(r, clickWaitMs));
          await menuItemHandle.click().catch(() => {});
          await new Promise(r => setTimeout(r, clickWaitMs));

          const rawClipboard = await page.evaluate(() =>
            navigator.clipboard.readText().then(t => ({ ok: true, value: t })).catch(e => ({ ok: false, error: e && e.message }))
          );
          clickDebug.clipboardResult = rawClipboard;
          clickDebug.clipboardUnchangedFromSentinel = rawClipboard.ok && rawClipboard.value === sentinel;
          overviewText = rawClipboard.ok ? rawClipboard.value : null;
        }
      }
    } catch (e) {
      clickDebug.error = e && e.message;
      overviewText = null;
    }

    let results;
    if (overviewText) {
      results = parseOverviewText(overviewText);
    } else {
      // Repli si le bouton/menu ou le presse-papier headless n'est pas accessible : lecture directe
      // des lignes du tableau de résultats dans le DOM (mêmes colonnes 0/1).
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('table tr')).map(tr =>
          Array.from(tr.querySelectorAll('td, th')).map(td => (td.textContent || '').trim())
        )
      );
      results = rows
        .filter(cols => cols.length >= 1 && cols[0])
        .map(cols => {
          const trackingNumber = cleanNumSuivi(cols[0]);
          let lastKm = cols.length > 1 ? cols[1] : '';
          if (!lastKm || /^\(?unknown\)?$/i.test(lastKm)) lastKm = '';
          return { trackingNumber, lastKm };
        })
        .filter(r => r.trackingNumber);
    }

    const debug = { clickDebug, overviewTextPreview: overviewText ? overviewText.slice(0, 500) : null };

    if (!results || results.length === 0) {
      const domDebug = await page.evaluate(() => {
        const describe = (el) => ({
          tag: el.tagName,
          className: typeof el.className === 'string' ? el.className : '',
          text: (el.textContent || '').trim().slice(0, 80),
        });
        const dropdownItems = Array.from(document.querySelectorAll('li, .el-dropdown-menu__item, [role="menuitem"]')).map(describe);

        return {
          pageTitle: document.title,
          bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
          dropdownItems,
        };
      });
      Object.assign(debug, domDebug);
    }

    await browser.close();
    res.status(200).json({ results, usedOverviewButton: !!overviewText, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping Yun Express';
    res.status(502).json({ error: message });
  }
};
