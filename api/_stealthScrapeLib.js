// Lancement de navigateur "furtif" partagé par les scrapers dont le site cible a une détection
// anti-bot (Cloudflare ou autre) qui bloque un Chromium headless "nu" — voir _scrapeLib.js pour
// l'équivalent standard utilisé par les autres transporteurs. Cache séparé de celui-ci (mais
// commun à TOUS les transporteurs "furtifs" entre eux : ce sont des instances Chromium identiques
// avec le même patch stealth, aucune raison de ne pas réutiliser la même instance à chaud).
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
    // --disable-blink-features=AutomationControlled : en plus du patch JS de StealthPlugin sur
    // navigator.webdriver, retire aussi l'indicateur correspondant côté moteur Chromium lui-même
    // (certaines vérifications anti-bot le lisent directement, avant même l'exécution du JS de la
    // page) — inoffensif à ajouter, ne peut qu'aider.
    args: [...chromium.args, '--disable-blink-features=AutomationControlled'],
    defaultViewport: chromium.defaultViewport,
    executablePath: cachedExecutablePath,
    // headless recommandé par @sparticuz/chromium pour la version du binaire embarqué (mode
    // "headless=new" quand disponible, moins facilement détectable que l'ancien mode headless) —
    // repli sur true si la propriété est absente (anciennes versions du package).
    headless: chromium.headless ?? true,
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
// lister chaque sous-dépendance à la main dans vercel.json. Les évasions de stealth
// (evasions/*, chargées via un mécanisme différent — une liste de chemins, pas des noms de paquets)
// restent à inclure via includeFiles dans vercel.json.
if (false) {
  require('puppeteer-extra-plugin-user-preferences');
  require('puppeteer-extra-plugin-user-data-dir');
}

module.exports = { launchStealthBrowser, discardStealthBrowser };
