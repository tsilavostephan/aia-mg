// Fonction serverless Vercel : scraping headless de la page de suivi PARCELSAPP (parcelsapp.com).
//
// Ce site n'accepte qu'un seul numéro par lien (https://parcelsapp.com/en/tracking/NUM) — voir
// chunkSize:1 + scrapeChunkSize:10 sur l'entrée 'parcelsapp' dans CARRIERS (assets/script.js) :
// l'app envoie plusieurs numéros par appel de fonction, traités ici par petits groupes en
// parallèle (PAGE_POOL_SIZE onglets en même temps).
//
// Contrairement aux autres scrapers, chaque numéro est ouvert dans son propre CONTEXTE DE
// NAVIGATION PRIVÉE (BrowserContext incognito) — aucun cookie partagé entre deux colis, et fermer
// le contexte à la fin de chacun détruit tout son stockage. Le navigateur entier (jamais mis en
// cache pour un prochain appel, contrairement aux autres scrapers "furtifs") est aussi fermé
// systématiquement en fin d'invocation. Ce choix sacrifie le gain de vitesse d'un navigateur
// réutilisé à chaud entre deux appels — accepté explicitement (demande : "ce n'est pas grave si
// cela prend du temps") au profit de ne jamais laisser de trace (cookies, session) sur ce site.
//
// Le numéro dernier kilométrique apparaît dans le tableau "parcel-attributes", sous la ligne dont
// le libellé est exactement "Next tracking numbers" (confirmé par capture de l'utilisateur) :
//   <table class="parcel-attributes"><tbody>
//     <tr><td>Next tracking numbers</td><td class="value"><span>LP756943248FR</span></td></tr>
//   </tbody></table>
// La valeur n'est retenue que si elle ressemble réellement à un numéro de suivi (voir
// isPlausibleTrackingNumber) : alphanumérique sans espace, au moins 2 lettres et 5 chiffres — ça
// exclut à la fois les valeurs vides et les mots de statut (ex. "Unknown", "Pending") sans avoir
// besoin d'un vrai dictionnaire, puisqu'un mot du dictionnaire ne contient jamais 5 chiffres.
//
// parcelsapp.com a une détection anti-bot qui bloque un Chromium headless "nu" — contournée via
// puppeteer-extra-plugin-stealth, avec quelques signaux supplémentaires pour paraître humain (User-
// Agent desktop réaliste, en-tête Accept-Language, léger mouvement de souris avant lecture) : aucune
// garantie de contournement fiable (voir la mésaventure avec Cloudflare Turnstile sur OrderTracker),
// mais ça ne peut pas nuire.
const path = require('node:path');
const {
  cleanNumSuivi,
  setCorsHeaders,
  parseScrapeRequest,
  buildStructureChangeWarning,
} = require('../../api/_scrapeLib');

// Truc pour le traceur de fichiers de Vercel (@vercel/nft), qui décide quels fichiers de
// node_modules embarquer dans le bundle de la fonction serverless en analysant statiquement les
// require() du code : puppeteer-extra résout les dépendances déclarées par ses plugins (stealth →
// user-preferences → user-data-dir) via un require(nom) où "nom" est une CHAÎNE CALCULÉE À
// L'EXÉCUTION — indétectable par nft, d'où l'erreur "Cannot find module" en prod bien que le
// paquet soit présent en local (voir le même truc dans api/_stealthScrapeLib.js, plus utilisé ici
// puisque ce fichier lance désormais son propre navigateur furtif au lieu de partager le sien).
// Ces require() jamais exécutés (mais visibles syntaxiquement) suffisent à faire tracer par nft ces
// paquets ET leurs propres dépendances directes, sans avoir à lister chaque sous-dépendance à la
// main dans vercel.json.
if (false) {
  require('puppeteer-extra-plugin-user-preferences');
  require('puppeteer-extra-plugin-user-data-dir');
}

const RESULT_TABLE_SELECTOR = 'table.parcel-attributes';
// Nombre de colis traités en parallèle (chacun dans son propre onglet + contexte incognito) —
// demande explicite : "tu peux mettre 5 liens en parallèle".
const PAGE_POOL_SIZE = 5;
// Marge sous les 60s de maxDuration (vercel.json) : le chargement des modules (puppeteer-extra +
// évasions stealth) au démarrage à froid se produit avant handler() et n'est donc pas compté dans
// startTime, ce qui rognerait la marge réelle avant la coupure sans cette marge de 15s.
const FUNCTION_BUDGET_MS = 45000;
// En dessous de cette marge restante, on renonce à démarrer un nouveau numéro plutôt que d'en
// entamer un qu'on ne pourra manifestement pas terminer à temps.
const MIN_TIME_TO_ATTEMPT_MS = 8000;
const REALISTIC_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Regroupe le calcul du temps restant avant la coupure — évite de répéter "deadline - Date.now()"
// partout et centralise la marge de sécurité en fin de budget.
class Deadline {
  constructor(budgetMs) {
    this.at = Date.now() + budgetMs;
  }
  remaining() {
    return this.at - Date.now();
  }
  hasAtLeast(ms) {
    return this.remaining() >= ms;
  }
}

// Une vraie valeur de suivi (ex. "LP756943248FR") contient toujours un mélange de lettres et de
// chiffres — un mot de statut ("Unknown", "Pending", "N/A") ou une valeur vide ne passe jamais ce
// test, sans avoir besoin d'un vrai dictionnaire.
function isPlausibleTrackingNumber(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (!/^[A-Za-z0-9]+$/.test(v)) return false; // alphanumérique strict, sans espace ni ponctuation
  const letterCount = (v.match(/[A-Za-z]/g) || []).length;
  const digitCount = (v.match(/[0-9]/g) || []).length;
  return letterCount >= 2 && digitCount >= 5;
}

// Lance un navigateur furtif DÉDIÉ à cette invocation — jamais mis en cache pour un prochain appel
// (contrairement à api/_stealthScrapeLib.js, utilisé par les autres scrapers "furtifs") puisqu'il
// est de toute façon fermé en fin de handler() (voir le bloc finally plus bas).
async function launchDedicatedStealthBrowser(deadline) {
  const { addExtra } = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  const puppeteerCore = require('puppeteer-core');
  const puppeteer = addExtra(puppeteerCore);
  puppeteer.use(StealthPlugin());

  const launchOptions = { headless: true };

  // Hors de Vercel (VM classique) : Chromium système déjà installé — voir le même principe dans
  // api/_scrapeLib.js et api/_stealthScrapeLib.js.
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'];
    launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  } else {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    const executablePath = await chromium.executablePath(path.join(__dirname, '..', '..', 'api', 'chromium-bin'));
    launchOptions.args = [...chromium.args, '--disable-blink-features=AutomationControlled'];
    launchOptions.defaultViewport = chromium.defaultViewport;
    launchOptions.executablePath = executablePath;
    launchOptions.headless = chromium.headless ?? true;
  }

  // Borné par le temps restant : un lancement qui traîne (extraction du binaire Chromium au
  // démarrage à froid) ferait sinon tuer la fonction par Vercel à 60s (FUNCTION_INVOCATION_TIMEOUT,
  // sans réponse) plutôt que de renvoyer une erreur exploitable.
  const timeoutMs = Math.max(1000, deadline.remaining());
  return Promise.race([
    puppeteer.launch(launchOptions),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`Lancement du navigateur trop long (> ${timeoutMs}ms)`)),
      timeoutMs,
    )),
  ]);
}

async function blockImages(page) {
  // Inutiles pour lire le tableau parcel-attributes — accélère chaque page.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.resourceType() === 'image') req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

async function extractLastMile(page) {
  return page.evaluate((selector) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll(`${selector} tr`));
    const row = rows.find((tr) => {
      const label = tr.querySelector('td');
      return label && /^next tracking numbers$/i.test(norm(label.textContent));
    });
    if (!row) return '';
    const valueCell = row.querySelector('td.value');
    if (!valueCell) return '';
    const span = valueCell.querySelector('span');
    return norm(span ? span.textContent : valueCell.textContent);
  }, RESULT_TABLE_SELECTOR);
}

// Léger mouvement de souris avant de lire le contenu — signal comportemental basique en plus du
// patch StealthPlugin, sans prétendre à un contournement garanti (voir le commentaire d'en-tête).
async function simulateHumanPresence(page) {
  try {
    const width = 1366, height = 900;
    for (let i = 0; i < 2; i++) {
      await page.mouse.move(Math.random() * width, Math.random() * height, { steps: 10 + Math.floor(Math.random() * 10) });
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));
    }
  } catch (e) { /* best-effort, jamais bloquant */ }
}

// Scrape un seul numéro dans son propre contexte de navigation privée (créé et détruit ici) —
// aucun cookie partagé avec les autres colis traités en parallèle, ni conservé une fois terminé.
async function scrapeOne(browser, num, deadline, pageLoadWaitMs) {
  // Navigation privée : un BrowserContext incognito dédié à ce numéro, fermé dans le "finally"
  // ci-dessous — sa fermeture détruit tout son stockage (cookies compris), pas besoin d'appel de
  // nettoyage séparé.
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setUserAgent(REALISTIC_USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7' });
    await page.setViewport({ width: 1366, height: 900 });
    await blockImages(page);

    const url = `https://parcelsapp.com/en/tracking/${encodeURIComponent(num)}`;
    const response = await page.goto(url, { waitUntil: 'load', timeout: Math.min(30000, deadline.remaining()) }).catch(() => null);

    // Le tableau n'apparaît qu'une fois les transporteurs interrogés en direct (peut prendre
    // plusieurs secondes) — on attend son apparition plutôt qu'une pause fixe trop courte.
    const selectorTimeout = Math.max(1000, Math.min(20000, deadline.remaining() - 2000));
    const tableFound = await page.waitForSelector(RESULT_TABLE_SELECTOR, { timeout: selectorTimeout }).then(() => true).catch(() => false);

    await simulateHumanPresence(page);
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pageLoadWaitMs, deadline.remaining() - 1000))));

    let rawValue = await extractLastMile(page);
    if (!isPlausibleTrackingNumber(rawValue) && deadline.hasAtLeast(4000)) {
      await new Promise((r) => setTimeout(r, 3000));
      rawValue = await extractLastMile(page);
    }

    if (isPlausibleTrackingNumber(rawValue)) {
      return { found: true, trackingNumber: cleanNumSuivi(num), lastKm: cleanNumSuivi(rawValue) };
    }

    // Capturé avant la fermeture du contexte (voir "finally" ci-dessous) : permet de distinguer
    // "le site a changé de structure" d'une vraie absence de données, voir buildStructureChangeWarning.
    const domDebug = await page.evaluate(() => ({
      pageTitle: document.title,
      bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
    })).catch(() => ({ pageTitle: '', bodyTextPreview: '' }));

    return {
      found: false,
      num,
      tableFound,
      rawValue: rawValue || null,
      httpStatus: response ? response.status() : null,
      finalUrl: page.url(),
      domDebug,
    };
  } catch (e) {
    return { found: false, num, error: e && e.message };
  } finally {
    // "on supprime les cookies et on ferme" : fermer le contexte incognito suffit, il ne persiste
    // rien entre deux appels de toute façon.
    await context.close().catch(() => {});
  }
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

  // FUNCTION_INVOCATION_TIMEOUT constaté en prod (maxDuration 60s dans vercel.json) : les numéros
  // non traités avant l'échéance restent simplement non résolus et seront repris par le prochain
  // lancement du scraping (voir computeCarrierGroups dans assets/script.js), plutôt que de faire
  // tuer toute la fonction sans réponse.
  const deadline = new Deadline(FUNCTION_BUDGET_MS);

  let browser;
  try {
    browser = await launchDedicatedStealthBrowser(deadline);

    const results = [];
    const perNumberDebug = [];
    let stoppedEarly = false;
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < trackingNumbers.length) {
        if (!deadline.hasAtLeast(MIN_TIME_TO_ATTEMPT_MS)) { stoppedEarly = true; return; }
        const num = trackingNumbers[nextIndex++];
        const outcome = await scrapeOne(browser, num, deadline, pageLoadWaitMs);
        if (outcome.found) results.push({ trackingNumber: outcome.trackingNumber, lastKm: outcome.lastKm });
        else perNumberDebug.push(outcome);
      }
    }

    const workerCount = Math.min(PAGE_POOL_SIZE, trackingNumbers.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const debug = { requestedCount: trackingNumbers.length, resultCount: results.length, stoppedEarly };
    if (results.length === 0) {
      debug.perNumberDebug = perNumberDebug;
      const lastAttempt = perNumberDebug[perNumberDebug.length - 1];
      if (lastAttempt && lastAttempt.domDebug) {
        debug.structureChangeWarning = buildStructureChangeWarning(lastAttempt.domDebug);
      }
    }

    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    const message = e && e.message ? e.message : 'échec du scraping PARCELSAPP';
    res.status(502).json({ error: message });
  } finally {
    // "on ferme le navigateur" : jamais réutilisé pour un prochain appel, contrairement aux autres
    // scrapers "furtifs" (voir le commentaire d'en-tête) — fermeture systématique ici.
    if (browser) await browser.close().catch(() => {});
  }
};
