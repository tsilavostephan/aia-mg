// Fonction serverless Vercel : scraping headless de la page de suivi multi-transporteur 17TRACK
// (t.17track.net) utilisée pour SF Express.
//
// La page https://t.17track.net/fr#nums=NUM1,NUM2,... est une application JS lourde (React) qui
// affiche une carte par colis. Le premier colis est développé par défaut, les autres sont repliés —
// il faut donc cliquer sur le bouton de bascule de chaque carte repliée pour afficher son détail,
// qui contient alors un bloc "Last-mile Tracking Number" (confirmé par capture DevTools de
// l'utilisateur) donnant exactement le numéro dernier kilométrique attendu, quel que soit le
// transporteur final (Colis Prive, bpost, ...). Pas de bouton copier utilisé ici : lecture directe
// du DOM après dépliage de chaque carte.
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

  const url = `https://t.17track.net/fr#nums=${trackingNumbers.join(',')}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    // 17track passe parfois par une vérification anti-bot Cloudflare ("Just a moment...") avant
    // d'afficher la page réelle. Ce n'est pas un CAPTCHA interactif : sur un navigateur qui exécute
    // le JS normalement, la page se débloque toute seule après quelques secondes — on attend donc
    // que le titre change avant de continuer, plutôt qu'un simple délai fixe qui risque d'être trop
    // court.
    let challengeCleared = true;
    if ((await page.title()).toLowerCase().includes('just a moment')) {
      challengeCleared = await page.waitForFunction(
        () => !document.title.toLowerCase().includes('just a moment'),
        { timeout: 20000 }
      ).then(() => true).catch(() => false);
      if (challengeCleared) {
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
      }
    }

    const cardsFound = await page.waitForSelector('.bg-card', { timeout: 20000 }).then(() => true).catch(() => false);
    await new Promise(r => setTimeout(r, pageLoadWaitMs));

    const rawResults = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const cards = Array.from(document.querySelectorAll('.bg-card'));
      // Déplie chaque carte repliée (la première est ouverte par défaut, les autres non) en
      // cliquant sur son bouton de bascule — un vrai .click() natif suffit ici (gestionnaire
      // onClick React classique, pas une interaction au survol comme sur d'autres sites).
      cards.forEach((card) => {
        const closedState = card.querySelector('[data-state="closed"]');
        if (closedState) {
          const toggleBtn = Array.from(card.querySelectorAll('button')).find((b) => b.hasAttribute('aria-expanded'));
          if (toggleBtn) toggleBtn.click();
        }
      });
      await sleep(600);

      return cards.map((card) => {
        const numSpan = card.querySelector('span.truncate[title]');
        const trackingNumber = numSpan ? (numSpan.getAttribute('title') || numSpan.textContent || '').trim() : '';

        let lastKm = '';
        const pairDivs = Array.from(card.querySelectorAll('div')).filter((d) =>
          d.children.length === 2 && d.children[0].tagName === 'SPAN' && d.children[1].tagName === 'SPAN'
        );
        const target = pairDivs.find((d) => (d.children[0].textContent || '').trim().toLowerCase() === 'last-mile tracking number');
        if (target) lastKm = (target.children[1].textContent || '').trim();

        return { trackingNumber, lastKm };
      });
    });

    const results = rawResults
      .map((r) => ({ trackingNumber: cleanNumSuivi(r.trackingNumber), lastKm: cleanNumSuivi(r.lastKm) }))
      .filter((r) => r.trackingNumber);

    const debug = { challengeCleared, cardsFound };
    if (results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
        cardCount: document.querySelectorAll('.bg-card').length,
      }));
      Object.assign(debug, domDebug);
    }

    await browser.close();
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping SF Express';
    res.status(502).json({ error: message });
  }
};
