// Fonctions partagées entre les fonctions de scraping (4PX, YANWEN, ...). Le préfixe "_" indique à
// Vercel qu'il ne s'agit pas d'une route/fonction en soi (convention standard des dossiers /api).

let cachedExecutablePath = null;
let launchPromise = null;

// Lance un navigateur headless à partir des fichiers Chromium empaquetés localement (voir
// scripts/postinstall.mjs + "includeFiles" dans vercel.json). Le chemin de l'exécutable est résolu
// une seule fois par instance de fonction puis mis en cache.
async function launchBrowser(binDir) {
  const chromium = (await import('@sparticuz/chromium-min')).default;
  const puppeteer = require('puppeteer-core');

  if (!cachedExecutablePath) {
    if (!launchPromise) {
      launchPromise = chromium.executablePath(binDir)
        .then(p => { cachedExecutablePath = p; return p; })
        .catch(e => { launchPromise = null; throw e; });
    }
    await launchPromise;
  }

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: cachedExecutablePath,
    headless: true,
  });
}

// Nettoie une valeur comme cleanNumSuivi() dans assets/script.js (retire =, ", ', \, trim)
function cleanNumSuivi(v) {
  return String(v ?? '').replace(/[="'\\]/g, '').trim();
}

// Reprend exactement la règle de parseTrackingPaste(text, kmColIndex=1, skipHeader=false, matchColIndex=0)
// utilisée par l'import manuel dans assets/script.js (4PX et YANWEN utilisent tous les deux ce même
// format tabulé : colonne 0 = numéro de suivi, colonne 1 = numéro dernier kilométrique), pour un
// résultat cohérent entre import manuel et scraping automatique.
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

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Numéros de suivi + délais configurables reçus depuis la fenêtre "⚙ Config Scraping" de l'app.
function parseScrapeRequest(req) {
  const trackingNumbers = req.method === 'POST'
    ? (req.body && req.body.trackingNumbers) || []
    : String(req.query.trackingNumbers || '').split(',').map(v => v.trim()).filter(Boolean);

  const body = req.method === 'POST' ? (req.body || {}) : req.query;
  const pageLoadWaitMs = Number(body.pageLoadWaitMs) || 4000;
  const clickWaitMs = Number(body.clickWaitMs) || 600;

  return { trackingNumbers, pageLoadWaitMs, clickWaitMs };
}

// Lit le presse-papier après avoir écrit un marqueur au préalable, pour savoir avec certitude si le
// clic a réellement copié quelque chose plutôt que de deviner à partir du contenu lu seul.
async function readClipboardWithSentinelCheck(page) {
  const sentinel = '__SENTINEL_BEFORE_CLICK__';
  await page.evaluate((s) => navigator.clipboard.writeText(s).catch(() => {}), sentinel);
  return sentinel;
}

module.exports = {
  launchBrowser,
  cleanNumSuivi,
  parseOverviewText,
  setCorsHeaders,
  parseScrapeRequest,
  readClipboardWithSentinelCheck,
};
