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
  discardBrowser,
  cleanNumSuivi,
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

  const url = `https://www.yuntrack.com/parcelTracking?id=${encodeURIComponent(trackingNumbers.join(','))}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin'));

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

      // La bannière de consentement cookies (".cookies-box") recouvre le bouton et intercepte les
      // survols/clics envoyés aux coordonnées écran, empêchant le menu de s'ouvrir — on la masque.
      clickDebug.cookieBannerHidden = await page.evaluate(() => {
        const el = document.querySelector('.cookies-box');
        if (!el) return false;
        el.style.setProperty('display', 'none', 'important');
        return true;
      }).catch(() => false);

      await page.bringToFront();
      await page.evaluate(() => window.focus());

      const sentinel = await readClipboardWithSentinelCheck(page);

      const dropdownBtnHandle = (await page.evaluateHandle(() => {
        const byClass = document.querySelector('button.el-dropdown-selfdefine');
        if (byClass) return byClass;
        return Array.from(document.querySelectorAll('button')).find(b => /copy\s*&?\s*export/i.test(b.textContent || '')) || null;
      })).asElement();
      clickDebug.dropdownBtnFound = !!dropdownBtnHandle;

      const findVisibleMenuItem = async () => (await page.evaluateHandle(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const candidates = Array.from(document.querySelectorAll('li, .el-dropdown-menu__item, [role="menuitem"]'));
        return candidates.find(el => el.offsetParent !== null && /copy\s*summary/i.test(norm(el.textContent))) || null;
      })).asElement();

      if (dropdownBtnHandle) {
        await dropdownBtnHandle.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
        await new Promise(r => setTimeout(r, 200));

        // Confirmé par capture DevTools + diagnostic : malgré son apparence de menu element-ui,
        // ce dropdown "el-dropdown-selfdefine" ne s'ouvre pas au simple survol — il faut un vrai clic.
        await dropdownBtnHandle.hover().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));
        let menuItemHandle = await findVisibleMenuItem();

        if (!menuItemHandle) {
          // Un vrai clic (coordonnées CDP) peut atterrir sur un élément qui recouvre le bouton
          // (bannière/overlay) — on vérifie et on note ce cas dans le diagnostic.
          clickDebug.obscuringElement = await dropdownBtnHandle.evaluate(el => {
            const rect = el.getBoundingClientRect();
            const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            if (!top) return null;
            if (top === el || el.contains(top)) return null;
            return { tag: top.tagName, className: typeof top.className === 'string' ? top.className : '' };
          }).catch(() => null);

          await dropdownBtnHandle.click().catch(() => {});
          await new Promise(r => setTimeout(r, clickWaitMs));
          menuItemHandle = await findVisibleMenuItem();
        }

        if (!menuItemHandle) {
          // Repli supplémentaire : déclenche un clic natif directement sur le bouton (bypass
          // d'un éventuel élément qui le recouvrirait aux coordonnées CDP).
          await dropdownBtnHandle.evaluate(el => el.click()).catch(() => {});
          await new Promise(r => setTimeout(r, clickWaitMs));
          menuItemHandle = await findVisibleMenuItem();
          clickDebug.nativeClickTried = true;
        }
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
          visible: el.offsetParent !== null,
          display: getComputedStyle(el).display,
          visibility: getComputedStyle(el).visibility,
        });
        const dropdownItems = Array.from(document.querySelectorAll('li, .el-dropdown-menu__item, [role="menuitem"]')).map(describe);

        return {
          pageTitle: document.title,
          bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
          dropdownItems,
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
    const message = e && e.message ? e.message : 'échec du scraping Yun Express';
    res.status(502).json({ error: message });
  }
};
