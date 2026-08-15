// Fonction serverless Vercel : scraping headless de la page de suivi Cainiao (4PX).
//
// On avait d'abord essayé d'appeler l'endpoint interne https://global.cainiao.com/global/detail.json,
// mais sa réponse ne contient pas le numéro dernier kilométrique (le tableau "detailList" est vide) —
// cette donnée n'existe que dans la page rendue, via le bouton "Copy Overview".
//
// Cette fonction ouvre donc réellement la page https://track.cainiao.com/orderTrack?mailNoList=...
// dans un navigateur headless (Puppeteer + Chromium empaqueté pour environnement serverless),
// attend son chargement complet, clique sur "Copy Overview" et lit le texte ainsi copié dans le
// presse-papier du navigateur headless. Ce texte est ensuite découpé avec exactement la même règle
// que l'import manuel par collage de l'app (colonne 0 = numéro de suivi, colonne 1 = numéro dernier
// kilométrique, "(Unknown)"/vide => pas de numéro) — voir parseTrackingPaste dans assets/script.js.
//
// ⚠️ Non vérifié en conditions réelles (pas de navigateur disponible pour tester dans cet
// environnement) : le nom du bouton, le délai de rendu et le repli DOM ci-dessous sont une
// estimation raisonnable à ajuster une fois testés sur un vrai déploiement Vercel.

const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

// Nettoie une valeur comme cleanNumSuivi() dans assets/script.js (retire =, ", ', \, trim)
function cleanNumSuivi(v) {
  return String(v ?? '').replace(/[="'\\]/g, '').trim();
}

// Reprend exactement la règle de parseTrackingPaste(text, kmColIndex=1, skipHeader=false, matchColIndex=0)
// utilisée par l'import manuel 4PX dans assets/script.js, pour un résultat cohérent entre les deux voies.
function parseOverviewText(text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/\r$/, ''));
  const results = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^=+$/.test(trimmed)) return;          // ligne séparatrice ======
    if (/^Powered by/i.test(trimmed)) return;  // pied de page Cainiao

    let parts = line.split('\t');
    if (parts.length < 2) {
      parts = line.trim().split(/\s{2,}/);     // repli : séparation par espaces multiples
    }

    const trackingNumber = parts.length > 0 ? cleanNumSuivi(parts[0]) : '';
    if (!trackingNumber) return;

    let lastKm = parts.length > 1 ? String(parts[1]) : '';
    lastKm = lastKm.replace(/^'+/, '');
    lastKm = lastKm.replace(/["=\\]/g, '').trim();
    if (!lastKm || /^\(?unknown\)?$/i.test(lastKm)) lastKm = '';

    results.push({ trackingNumber, lastKm });
  });

  return results;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const trackingNumbers = req.method === 'POST'
    ? (req.body && req.body.trackingNumbers) || []
    : String(req.query.trackingNumbers || '').split(',').map(v => v.trim()).filter(Boolean);

  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    res.status(400).json({ error: 'trackingNumbers manquant ou vide' });
    return;
  }

  const url = `https://track.cainiao.com/orderTrack?mailNoList=${encodeURIComponent(trackingNumbers.join(','))}`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    // Laisse le temps au rendu JS de la page (chargement asynchrone des statuts de suivi) de finir.
    await new Promise(r => setTimeout(r, 4000));

    let overviewText = null;
    try {
      // Autorise la lecture/écriture du presse-papier headless avant de cliquer (nécessaire pour
      // que navigator.clipboard.readText() fonctionne une fois le bouton cliqué).
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://track.cainiao.com', ['clipboard-read', 'clipboard-write']);

      // L'icône "Copy Overview" est un <span> sans texte (juste une image), avec des noms de
      // classe générés (CSS Modules, ex. "MailNoList--iconWrapper--3jldZ43") dont le suffixe
      // haché peut changer d'un déploiement à l'autre — on cible donc le préfixe stable via
      // [class*=...], avec un repli sur une recherche par texte au cas où un libellé existe ailleurs.
      const iconSelector = '[class*="MailNoList--iconWrapper"], [class*="copySingle"], [class*="CopyOverview"], [class*="copyOverview"]';
      await page.waitForSelector(iconSelector, { timeout: 15000 }).catch(() => {});

      const clicked = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) { el.click(); return true; }
        return false;
      }, iconSelector);

      if (clicked) {
        // aria-haspopup="true" sur l'icône suggère qu'un menu/popup peut apparaître au clic — si un
        // élément "Copy Overview" y figure en texte, on le clique aussi ; sinon on suppose que le
        // premier clic a déjà déclenché la copie directement.
        await new Promise(r => setTimeout(r, 500));
        await page.evaluate(() => {
          const el = Array.from(document.querySelectorAll('button, a, span, div, li'))
            .find(e => /copy overview/i.test(e.textContent || '') && e.offsetParent !== null);
          if (el) el.click();
        });
        await new Promise(r => setTimeout(r, 500));

        overviewText = await page.evaluate(() =>
          navigator.clipboard.readText().catch(() => null)
        );
      }
    } catch (e) {
      overviewText = null;
    }

    let results;
    if (overviewText) {
      results = parseOverviewText(overviewText);
    } else {
      // Repli si le bouton "Copy Overview" ou le presse-papier headless n'est pas accessible :
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

    await browser.close();
    res.status(200).json({ results, usedOverviewButton: !!overviewText });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    res.status(502).json({ error: e && e.message ? e.message : 'échec du scraping 4PX' });
  }
};
