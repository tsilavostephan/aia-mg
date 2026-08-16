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
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    const orderNumsFound = await page.waitForSelector('.orderNum', { timeout: 20000 }).then(() => true).catch(() => false);
    await new Promise((r) => setTimeout(r, pageLoadWaitMs));

    const rawResults = await page.evaluate(() => {
      const orderNums = Array.from(document.querySelectorAll('.orderNum')).map((el) => (el.textContent || '').trim());
      const suiviValues = Array.from(document.querySelectorAll('span'))
        .filter((el) => /num[ée]ro de suivi/i.test(el.textContent || ''))
        .map((el) => {
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const m = text.match(/num[ée]ro de suivi\s*[:：]\s*(\S+)/i);
          return m ? m[1] : '';
        });
      return { orderNums, suiviValues };
    });

    const results = rawResults.orderNums
      .map((num, i) => ({ trackingNumber: cleanNumSuivi(num), lastKm: cleanNumSuivi(rawResults.suiviValues[i] || '') }))
      .filter((r) => r.trackingNumber && r.lastKm);

    const debug = {
      orderNumsFound,
      orderNumCount: rawResults.orderNums.length,
      suiviCount: rawResults.suiviValues.length,
    };

    if (results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
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
