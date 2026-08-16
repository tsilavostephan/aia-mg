// Fonction serverless Vercel : scraping headless de la page de suivi officielle 4PX
// (track.4px.com — à ne pas confondre avec CAINIAO, géré par api/scrape-cainiao.js, qui utilisait
// auparavant le nom "4PX" dans cette application avant d'être renommé).
//
// La page https://track.4px.com/#/result/34/NUM1,NUM2,... est une application JS (route en
// fragment #) qui affiche une carte par colis. Chaque carte contient le numéro d'origine dans un
// <p class="orderNum"> et le numéro dernier kilométrique en texte visible (pas de presse-papier à
// lire) dans un <span>Numéro de suivi： LP765416770FR<button ...copyBtn...></button></span> —
// confirmé par le HTML fourni par l'utilisateur. On associe les deux listes par leur position dans
// le DOM (i-ème carte = i-ème numéro de suivi), les deux étant censées apparaître dans le même
// ordre ; le nombre d'éléments trouvés de chaque côté est toujours renvoyé en diagnostic pour
// vérifier que cette hypothèse tient si jamais 0 résultat n'est exploitable.
const path = require('node:path');
const { launchBrowser, cleanNumSuivi, setCorsHeaders, parseScrapeRequest } = require('./_scrapeLib');

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
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    // La fenêtre par défaut du Chromium headless est étroite, ce qui déclenche la mise en page
    // mobile du site (un seul colis affiché en détail, sans la liste ".next-list-items") au lieu de
    // la mise en page desktop attendue (liste complète des colis) — on force donc une largeur desktop.
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    // La liste peut mettre plus de temps à se remplir quand plusieurs numéros sont demandés à la
    // fois (chargement/rendu progressif côté site) — on retente plusieurs fois avant d'abandonner,
    // plutôt qu'une seule attente fixe.
    let orderNumsFound = false;
    let retryCount = 0;
    for (let attempt = 1; attempt <= 4; attempt++) {
      retryCount = attempt;
      orderNumsFound = await page.waitForSelector('.orderNum', { timeout: 8000 }).then(() => true).catch(() => false);
      if (orderNumsFound) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    await new Promise((r) => setTimeout(r, pageLoadWaitMs));

    const rawResults = await page.evaluate(() => {
      // La langue de la page dépend de la locale détectée par le site (navigateur headless ->
      // souvent anglais, "Tracking No.", plutôt que français, "Numéro de suivi") — on reconnaît les
      // deux plutôt que de dépendre d'une langue fixe.
      const SUIVI_LABEL_RE = /(num[ée]ro de suivi|tracking no\.?)/i;
      const orderNums = Array.from(document.querySelectorAll('.orderNum')).map((el) => (el.textContent || '').trim());
      const suiviValues = Array.from(document.querySelectorAll('span'))
        .filter((el) => SUIVI_LABEL_RE.test(el.textContent || ''))
        .map((el) => {
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const m = text.match(new RegExp(SUIVI_LABEL_RE.source + '\\s*[:：]?\\s*(\\S+)', 'i'));
          return m ? m[2] : '';
        });

      // Repli : mise en page "détail" (ex. mobile) avec des libellés anglais séparés au lieu de la
      // liste desktop — "4PX Order No." suivi du numéro, puis "Tracking No." suivi du numéro
      // dernier kilométrique, chacun dans son propre élément.
      if (orderNums.length === 0) {
        const allEls = Array.from(document.querySelectorAll('body *'));
        const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
        const findValueAfterLabel = (labelRe) => {
          const labelEl = allEls.find((el) => el.children.length === 0 && labelRe.test(textOf(el)));
          if (!labelEl) return '';
          let sib = labelEl.nextElementSibling;
          while (sib && !textOf(sib)) sib = sib.nextElementSibling;
          return sib ? textOf(sib) : '';
        };
        const orderNo = findValueAfterLabel(/^4PX Order No\.?$/i);
        const trackingNo = findValueAfterLabel(/^Tracking No\.?$/i);
        if (orderNo) { orderNums.push(orderNo); suiviValues.push(trackingNo); }
      }

      return { orderNums, suiviValues };
    });

    const results = rawResults.orderNums
      .map((num, i) => ({ trackingNumber: cleanNumSuivi(num), lastKm: cleanNumSuivi(rawResults.suiviValues[i] || '') }))
      .filter((r) => r.trackingNumber && r.lastKm);

    const debug = {
      orderNumsFound,
      retryCount,
      orderNumCount: rawResults.orderNums.length,
      suiviCount: rawResults.suiviValues.length,
    };

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
