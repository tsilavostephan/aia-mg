// Fonction serverless Vercel : scraping headless de la page de suivi officielle 4PX
// (track.4px.com — à ne pas confondre avec CAINIAO, géré par api/scrape-cainiao.js, qui utilisait
// auparavant le nom "4PX" dans cette application avant d'être renommé).
//
// La page https://track.4px.com/#/result/34/NUM1,NUM2,... est une application JS (route en
// fragment #) qui affiche la liste des colis (chaque carte a un <p class="orderNum">), mais le
// numéro dernier kilométrique ("Tracking No." / "Numéro de suivi") n'est affiché que pour le colis
// actuellement sélectionné dans le panneau de détail — confirmé par l'utilisateur : pas de bouton
// d'export groupé sur ce site. On clique donc sur chaque élément de la liste un par un, on attend
// que le panneau de détail affiche bien CE colis (vérifié via son "4PX Order No."), puis on lit son
// "Tracking No.".
const path = require('node:path');
const { launchBrowser, cleanNumSuivi, setCorsHeaders, parseScrapeRequest } = require('./_scrapeLib');

// La langue de la page dépend de la locale détectée par le site (navigateur headless -> souvent
// anglais, "Tracking No.", plutôt que français, "Numéro de suivi") — on reconnaît les deux.
const SUIVI_LABEL_SRC = '(num[ée]ro de suivi|tracking no\\.?)';
const ORDER_LABEL_SRC = '^4PX Order No\\.?$';

async function readDetailPair(page) {
  return page.evaluate(
    (suiviLabelSrc, orderLabelSrc) => {
      const suiviRe = new RegExp(suiviLabelSrc, 'i');
      const orderRe = new RegExp(orderLabelSrc, 'i');
      const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

      const allEls = Array.from(document.querySelectorAll('body *'));
      const orderLabelEl = allEls.find((el) => el.children.length === 0 && orderRe.test(textOf(el)));
      let orderNo = '';
      if (orderLabelEl) {
        let sib = orderLabelEl.nextElementSibling;
        while (sib && !textOf(sib)) sib = sib.nextElementSibling;
        orderNo = sib ? textOf(sib) : '';
      }

      let trackingNo = '';
      const suiviSpan = Array.from(document.querySelectorAll('span')).find((el) => suiviRe.test(el.textContent || ''));
      if (suiviSpan) {
        const text = textOf(suiviSpan);
        const m = text.match(new RegExp(suiviLabelSrc + '\\s*[:：]?\\s*(\\S+)', 'i'));
        trackingNo = m ? m[2] : '';
      }

      return { orderNo, trackingNo };
    },
    SUIVI_LABEL_SRC,
    ORDER_LABEL_SRC
  );
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

  const url = `https://track.4px.com/#/result/34/${trackingNumbers.join(',')}`;

  let browser;
  const startTime = Date.now();
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    // La fenêtre par défaut du Chromium headless est étroite, ce qui déclenche la mise en page
    // mobile du site (un seul colis affiché en détail, sans la liste ".next-list-items") au lieu de
    // la mise en page desktop attendue (liste complète des colis) — on force donc une largeur desktop.
    await page.setViewport({ width: 1440, height: 900 });
    // 'networkidle0' exige zéro connexion active pendant 500ms — un widget de chat, des analytics
    // ou un polling en arrière-plan peuvent empêcher ça indéfiniment et faire échouer la navigation
    // (constaté avec un lot de 38 colis). La boucle d'attente de ".orderNum" juste après gère déjà
    // le rendu progressif de la SPA, donc une condition moins stricte suffit ici.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // La liste peut mettre plus de temps à se remplir quand plusieurs numéros sont demandés à la
    // fois (chargement/rendu progressif côté site) — on retente plusieurs fois avant d'abandonner,
    // plutôt qu'une seule attente fixe.
    let orderNumsFound = false;
    let retryCount = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      retryCount = attempt;
      orderNumsFound = await page.waitForSelector('.orderNum', { timeout: 6000 }).then(() => true).catch(() => false);
      if (orderNumsFound) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await new Promise((r) => setTimeout(r, Math.min(pageLoadWaitMs, 4000)));

    const results = [];
    let clickedCount = 0;
    let mismatchCount = 0;
    let stoppedEarly = false;
    let firstMismatchDebug = null;
    const TIME_BUDGET_MS = 45000; // marge sous la limite de 60s de la fonction Vercel (depuis le tout début, browser inclus)

    if (orderNumsFound) {
      const itemHandles = await page.$$('.next-list-item');
      for (const item of itemHandles) {
        if (Date.now() - startTime > TIME_BUDGET_MS) { stoppedEarly = true; break; }

        const expectedNum = await item.$eval('.orderNum', (el) => el.textContent.trim()).catch(() => null);
        if (!expectedNum) continue;

        await item.click().catch(() => {});
        clickedCount++;

        // Attend que le panneau de détail affiche bien CE colis (vérifié via "4PX Order No."),
        // avec un temps d'attente volontairement court par élément pour ne jamais dépasser le
        // budget de temps total, quitte à manquer quelques colis plutôt que de tout perdre au timeout.
        let pair = { orderNo: '', trackingNo: '' };
        for (let i = 0; i < 3; i++) {
          pair = await readDetailPair(page);
          if (pair.orderNo === expectedNum) break;
          await new Promise((r) => setTimeout(r, 150));
        }

        if (pair.orderNo === expectedNum) {
          if (pair.trackingNo) {
            results.push({ trackingNumber: cleanNumSuivi(expectedNum), lastKm: cleanNumSuivi(pair.trackingNo) });
          }
        } else {
          mismatchCount++;
          if (!firstMismatchDebug) {
            firstMismatchDebug = {
              expectedNum,
              pair,
              bodyTextPreview: await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 500)),
            };
          }
        }
      }
    }

    const debug = { orderNumsFound, retryCount, clickedCount, mismatchCount, resultCount: results.length, stoppedEarly };
    if (firstMismatchDebug) debug.firstMismatchDebug = firstMismatchDebug;

    if (results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
        listItemCount: document.querySelectorAll('.next-list-item').length,
        listContainerFound: !!document.querySelector('.next-list-items'),
      }));
      Object.assign(debug, domDebug);
    }

    await browser.close();
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping 4PX';
    res.status(502).json({ error: message });
  }
};
