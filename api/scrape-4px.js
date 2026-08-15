// Fonction serverless Vercel : scraping headless de la page de suivi Cainiao (4PX).
//
// On avait d'abord essayé d'appeler l'endpoint interne https://global.cainiao.com/global/detail.json,
// mais sa réponse ne contient pas le numéro dernier kilométrique (le tableau "detailList" est vide) —
// cette donnée n'existe que dans la page rendue, via l'icône "Copy Overview".
//
// Cette fonction ouvre donc réellement la page https://track.cainiao.com/orderTrack?mailNoList=...
// dans un navigateur headless, attend son chargement complet, clique sur cette icône et lit le
// texte ainsi copié dans le presse-papier du navigateur headless. Ce texte est ensuite découpé avec
// exactement la même règle que l'import manuel par collage de l'app — voir parseOverviewText dans
// api/_scrapeLib.js et parseTrackingPaste dans assets/script.js.
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

  const url = `https://track.cainiao.com/orderTrack?mailNoList=${encodeURIComponent(trackingNumbers.join(','))}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    // Laisse le temps au rendu JS de la page (chargement asynchrone des statuts de suivi) de finir.
    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    let overviewText = null;
    const clickDebug = { iconFound: false, clipboardResult: null };
    try {
      // Autorise la lecture/écriture du presse-papier headless avant d'interagir (nécessaire pour
      // que navigator.clipboard.readText() fonctionne une fois le bouton actionné).
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://track.cainiao.com', ['clipboard-read', 'clipboard-write']);

      // Confirmé par capture DevTools de l'utilisateur : c'est bien le <span> portant la classe
      // "copySingle" (en plus de "iconWrapper") qui donne le bon résultat (tableau complet) quand on
      // clique dessus manuellement. On le cible donc explicitement, avec repli sur le 1er span
      // aria-haspopup du wrapper si jamais la classe changeait.
      await page.waitForSelector('[class*="copyWrapper"] span[aria-haspopup="true"]', { timeout: 15000 }).catch(() => {});

      // Vercel/headless Chrome : la page doit être au premier plan et avoir le focus pour que
      // l'API Clipboard fonctionne (navigator.clipboard.readText() échoue silencieusement sinon).
      await page.bringToFront();
      await page.evaluate(() => window.focus());

      const sentinel = await readClipboardWithSentinelCheck(page);

      const iconHandle = (await page.evaluateHandle(() => {
        const wrapper = document.querySelector('[class*="copyWrapper"]');
        if (!wrapper) return null;
        const spans = Array.from(wrapper.querySelectorAll('span[aria-haspopup="true"]'));
        return spans.find(s => /copySingle/i.test(s.className)) || spans[0] || null;
      })).asElement();
      clickDebug.iconFound = !!iconHandle;
      if (iconHandle) {
        // Beaucoup de composants d'icône React n'affichent leur action qu'au survol réel
        // (onMouseEnter) — on simule donc un vrai survol souris avant de cliquer, plutôt qu'un
        // .click() synthétique via page.evaluate qui ne déclenche pas ces gestionnaires.
        await iconHandle.hover().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));
        await iconHandle.click().catch(() => {});
        await new Promise(r => setTimeout(r, clickWaitMs));

        // Si un menu/popup contenant un libellé "Copy Overview" est apparu, on le clique aussi ;
        // sinon on suppose que le clic/survol précédent a déjà déclenché la copie directement.
        await page.evaluate(() => {
          const el = Array.from(document.querySelectorAll('button, a, span, div, li'))
            .find(e => /copy overview/i.test(e.textContent || '') && e.offsetParent !== null);
          if (el) el.click();
        });
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

    let results;
    if (overviewText) {
      results = parseOverviewText(overviewText);
    } else {
      // Repli si l'icône "Copy Overview" ou le presse-papier headless n'est pas accessible :
      // lecture directe des lignes du tableau de résultats dans le DOM (mêmes colonnes 0/1).
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

    // Diagnostic : toujours inclus (pas seulement si 0 résultat), pour voir précisément ce que le
    // clic a réellement copié — y compris quand ça "marche" mais donne le mauvais format.
    const debug = { clickDebug, overviewTextPreview: overviewText ? overviewText.slice(0, 500) : null };

    if (!results || results.length === 0) {
      const domDebug = await page.evaluate(() => {
        const describe = (el) => ({
          tag: el.tagName,
          className: typeof el.className === 'string' ? el.className : '',
          title: el.getAttribute('title') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text: (el.textContent || '').trim().slice(0, 80),
          outerHTML: (el.outerHTML || '').slice(0, 300),
        });

        const haspopupElements = Array.from(document.querySelectorAll('[aria-haspopup]')).map(describe);
        const copyWrapperEl = document.querySelector('[class*="copyWrapper"]');

        return {
          pageTitle: document.title,
          bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
          haspopupElements,
          copyWrapperHTML: copyWrapperEl ? copyWrapperEl.outerHTML : null,
        };
      });
      Object.assign(debug, domDebug);
    }

    await browser.close();
    res.status(200).json({ results, rawText: overviewText || null, usedOverviewButton: !!overviewText, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping 4PX';
    res.status(502).json({ error: message });
  }
};
