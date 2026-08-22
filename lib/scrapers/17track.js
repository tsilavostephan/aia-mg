// Fonction serverless Vercel : scraping headless de la page de suivi 17TRACK (t.17track.net).
//
// https://t.17track.net/fr#nums=NUM1,NUM2,... est une application JS (route en fragment #) qui
// affiche une carte par numéro de suivi. Le numéro dernier kilométrique n'apparaît que dans le
// panneau de détail déplié de chaque carte, sous le libellé exact "Last-mile Tracking Number"
// (confirmé par capture de l'utilisateur — reste en anglais même sur la page /fr) :
//   <div class="flex flex-col gap-1">
//     <span class="text-text-secondary">Last-mile Tracking Number</span>
//     <span class="font-medium text-text-primary">LP756453567FR</span>
//   </div>
// Absent pour les colis livrés directement par le transporteur d'origine, sans relais local — dans
// ce cas, ce colis est simplement ignoré (pas d'entrée dans les résultats), comme pour les autres
// transporteurs de cette app quand aucune valeur n'est trouvée.
//
// Toutes les cartes sont dépliées d'un coup via le bouton "tout déplier" en haut à droite de la
// liste (icône chevrons-up-down, bouton carré ~36x36 — distinct des boutons individuels de chaque
// carte qui ont une forme différente) : le libellé "Last-mile Tracking Number" n'existe dans le DOM
// qu'une fois les détails dépliés.
const path = require('node:path');
const {
  cleanNumSuivi,
  setCorsHeaders,
  parseScrapeRequest,
  buildStructureChangeWarning,
} = require('../../api/_scrapeLib');

// 17TRACK est protégé par le challenge JS anti-bot de Cloudflare ("Just a moment..."), qui bloque un
// Chromium headless "nu" avant même que la vraie page ne charge — confirmé par test en conditions
// réelles. puppeteer-extra-plugin-stealth masque les signaux les plus courants détectés par
// Cloudflare (navigator.webdriver, plugins/fonts manquants, incohérences WebGL, etc.).
//
// Lancement dédié à ce fichier (pas via launchBrowser() de _scrapeLib.js) : les 9 autres
// transporteurs n'ont pas ce problème et partagent un navigateur non "stealth" mis en cache au
// niveau du module — mélanger les deux dans le même cache créerait une dépendance croisée inutile
// entre transporteurs sans rapport. Cache séparé ici pour la même raison de réutilisation "à chaud".
let cachedExecutablePath = null;
let launchPromise = null;
let cachedBrowser = null;

async function launchStealthBrowser(binDir) {
  const chromium = (await import('@sparticuz/chromium-min')).default;
  const { addExtra } = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  const puppeteerCore = require('puppeteer-core');

  if (cachedBrowser) {
    try {
      if (cachedBrowser.isConnected()) return cachedBrowser;
    } catch (e) { /* navigateur invalide, on en relance un ci-dessous */ }
    cachedBrowser = null;
  }

  if (!cachedExecutablePath) {
    if (!launchPromise) {
      launchPromise = chromium.executablePath(binDir)
        .then(p => { cachedExecutablePath = p; return p; })
        .catch(e => { launchPromise = null; throw e; });
    }
    await launchPromise;
  }

  const puppeteer = addExtra(puppeteerCore);
  puppeteer.use(StealthPlugin());

  cachedBrowser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: cachedExecutablePath,
    headless: true,
  });
  return cachedBrowser;
}

async function discardStealthBrowser(browser) {
  if (cachedBrowser === browser) cachedBrowser = null;
  if (browser) {
    try { await browser.close(); } catch (e) { /* déjà fermé */ }
  }
}

// Truc pour le traceur de fichiers de Vercel (@vercel/nft), qui décide quels fichiers de
// node_modules embarquer dans le bundle de la fonction serverless en analysant statiquement les
// require() du code : puppeteer-extra résout les dépendances déclarées par les plugins (stealth →
// user-preferences → user-data-dir) via un require(nom) où "nom" est une CHAÎNE CALCULÉE À
// L'EXÉCUTION (resolvePluginDependencies() dans puppeteer-extra/dist/index.cjs.js) — indétectable
// par nft, d'où l'erreur "Cannot find module" en prod bien que le paquet soit présent en local.
// Ces require() jamais exécutés (mais visibles syntaxiquement) suffisent à faire tracer par nft ces
// paquets ET leurs propres dépendances directes (elles bien statiques, ex. fs-extra), sans avoir à
// lister chaque sous-dépendance à la main dans vercel.json.
if (false) {
  require('puppeteer-extra-plugin-user-preferences');
  require('puppeteer-extra-plugin-user-data-dir');
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

  const url = `https://t.17track.net/fr#nums=${encodeURIComponent(trackingNumbers.join(','))}`;

  let browser;
  try {
    browser = await launchStealthBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin'));

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Rendu progressif côté client (SPA) : attend l'apparition d'au moins un résultat avant de
    // continuer, avec une marge supplémentaire pour laisser le reste des cartes se charger.
    const resultsFound = await page.waitForSelector('span[title]', { timeout: 20000 }).then(() => true).catch(() => false);
    await new Promise((r) => setTimeout(r, pageLoadWaitMs));

    const expandDebug = { expandBtnFound: false, wasAlreadyOpen: false };
    try {
      const expandHandle = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll('button')).find((b) =>
          /\bh-9\b/.test(b.className) && /\bw-9\b/.test(b.className) && b.querySelector('svg.lucide-chevrons-up-down, svg.lucide-chevrons-down-up')
        ) || null;
      });
      const expandEl = expandHandle.asElement();
      expandDebug.expandBtnFound = !!expandEl;
      if (expandEl) {
        const state = await expandEl.evaluate((el) => el.getAttribute('data-state')).catch(() => null);
        expandDebug.wasAlreadyOpen = state === 'open';
        if (state !== 'open') {
          await expandEl.click().catch(() => {});
          await new Promise((r) => setTimeout(r, Math.max(pageLoadWaitMs, 3000)));
        }
      }
    } catch (e) {
      expandDebug.error = e && e.message;
    }

    const rawResults = await page.evaluate((nums) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const out = [];
      nums.forEach((num) => {
        const escaped = num.replace(/"/g, '\\"');
        const titleSpan = document.querySelector(`span[title="${escaped}"]`);
        if (!titleSpan) return;
        // Remonte jusqu'à la carte englobant ce numéro (repère : classes utilitaires stables
        // "bg-card" + "rounded-xl" présentes sur le conteneur de chaque résultat).
        let card = titleSpan;
        for (let i = 0; i < 15 && card && !(card.classList && card.classList.contains('bg-card') && card.classList.contains('rounded-xl')); i++) {
          card = card.parentElement;
        }
        if (!card) return;
        const labelEl = Array.from(card.querySelectorAll('span')).find((s) => /last-?mile\s+tracking\s+number/i.test(norm(s.textContent)));
        if (!labelEl) return;
        let sib = labelEl.nextElementSibling;
        while (sib && !norm(sib.textContent)) sib = sib.nextElementSibling;
        const lastKm = sib ? norm(sib.textContent) : '';
        if (lastKm) out.push({ trackingNumber: num, lastKm });
      });
      return out;
    }, trackingNumbers);

    const results = rawResults
      .map((r) => ({ trackingNumber: cleanNumSuivi(r.trackingNumber), lastKm: cleanNumSuivi(r.lastKm) }))
      .filter((r) => r.trackingNumber && r.lastKm);

    const debug = { resultsFound, expandDebug, requestedCount: trackingNumbers.length, resultCount: results.length };

    if (results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
      }));
      Object.assign(debug, domDebug);
      debug.structureChangeWarning = buildStructureChangeWarning(domDebug);
    }

    // Ferme uniquement la page (pas le navigateur) pour permettre sa réutilisation par un prochain
    // appel "à chaud" de cette même fonction Vercel — voir launchBrowser() dans _scrapeLib.js.
    await page.close().catch(() => {});
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    await discardStealthBrowser(browser);
    const message = e && e.message ? e.message : 'échec du scraping 17TRACK';
    res.status(502).json({ error: message });
  }
};
