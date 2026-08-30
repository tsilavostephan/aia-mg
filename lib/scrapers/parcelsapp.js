// Fonction serverless Vercel : scraping headless de la page de suivi PARCELSAPP (parcelsapp.com).
//
// Ce site n'accepte qu'un seul numéro par lien (https://parcelsapp.com/en/tracking/NUM) — voir
// chunkSize:1 + scrapeChunkSize:10 sur l'entrée 'parcelsapp' dans CARRIERS (assets/script.js) :
// l'app envoie plusieurs numéros par appel de fonction, traités ici par petits groupes en
// parallèle (PAGE_POOL_SIZE onglets en même temps).
//
// Contrairement aux autres scrapers, chaque numéro est ouvert sur sa propre page, dont les cookies
// sont explicitement supprimés avant sa fermeture (voir scrapeOne) — rien n'est conservé une fois
// le colis traité (un BrowserContext incognito par numéro a été essayé d'abord pour une vraie
// navigation privée, mais s'est révélé instable sous l'environnement Chromium restreint de Vercel,
// voir le commentaire dans scrapeOne). Le navigateur entier (jamais mis en cache pour un prochain
// appel, contrairement aux autres scrapers "furtifs") est aussi fermé systématiquement en fin
// d'invocation. Ce choix sacrifie le gain de vitesse d'un navigateur réutilisé à chaud entre deux
// appels — accepté explicitement (demande : "ce n'est pas grave si cela prend du temps") au profit
// de ne jamais laisser de trace (cookies, session) sur ce site.
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
// Réduit à 1 (la demande initiale portait sur 5) : l'instrumentation temporaire a montré qu'avec
// plusieurs onglets ouverts en même temps (5, puis 2), chaque page.goto() prenait 20-30s+ au lieu
// de quelques secondes — signe d'une famine CPU (partagée entre les onglets d'une même invocation,
// mais aussi entre plusieurs invocations Vercel simultanées, voir maxConcurrentScrapes sur
// l'entrée 'parcelsapp' dans CARRIERS, assets/script.js). Un seul onglet à la fois dans cette
// fonction, combiné à moins d'invocations simultanées côté client, pour de vrai laisser à chaque
// page une chance de charger normalement.
const PAGE_POOL_SIZE = 1;
// Marge pour les appels de nettoyage (page.close, browser.close, cookies...) qui n'ont pas
// d'option "timeout" native contrairement à goto/waitForSelector — sans borne explicite, un de ces
// appels peut rester bloqué indéfiniment si la connexion au navigateur est instable (constaté en
// prod : FUNCTION_INVOCATION_TIMEOUT malgré le budget de 45s, très probablement un browser.close()
// ou page.close() jamais résolu ni rejeté après un crash partiel du navigateur), ce qu'un simple
// .catch() ne protège pas puisqu'il ne réagit qu'à un rejet, jamais à une promesse qui ne se
// termine tout simplement pas.
const CLEANUP_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  // Étouffe un rejet tardif de la promesse d'origine une fois la course déjà tranchée par le
  // timeout, pour ne jamais produire un "unhandled promise rejection" en arrière-plan.
  const safePromise = promise.catch(() => {});
  return Promise.race([
    safePromise,
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}
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

// Le site refuse de fournir de vraies données de suivi à une session "vierge" (sans cookies) — pas
// un blocage de l'automatisation en tant que telle : une session Puppeteer fraîche AVEC ces cookies
// injectés obtient les mêmes données qu'un navigateur normal, confirmé par un test isolé (extraction
// des cookies parcelsapp.com depuis un profil Chrome réel, réinjection dans une session neuve : le
// blocage disparaît). Ce sont des cookies de consentement publicitaire génériques (Google Funding
// Choices "FCCDCF" + identifiants Prebid.js "_pubcid"/"pbjs-unifiedid"), pas des données
// personnelles — le site semble conditionner l'affichage du contenu réel à un consentement pub déjà
// accepté, plutôt que d'attendre qu'une bannière soit fermée à chaque visite.
// Valeur JSON (tableau d'objets cookie, format Puppeteer/CDP) dans la variable d'environnement
// PARCELSAPP_COOKIES_JSON — à régénérer si le site finit par les faire expirer (voir "expires" dans
// chaque cookie ; certains expirent début-mi 2027, le cookie FCCDCF plus tard).
let cachedParcelsappCookies = null;
function getParcelsappCookies() {
  if (cachedParcelsappCookies) return cachedParcelsappCookies;
  const raw = process.env.PARCELSAPP_COOKIES_JSON;
  if (!raw) { cachedParcelsappCookies = []; return cachedParcelsappCookies; }
  try {
    cachedParcelsappCookies = JSON.parse(raw);
  } catch (e) {
    cachedParcelsappCookies = [];
  }
  return cachedParcelsappCookies;
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

// Bannière de consentement cookies (CMP) qui recouvre toute la page tant qu'elle n'est pas fermée
// — confirmé par capture d'écran : le bouton "Autoriser" reste affiché indéfiniment sinon, et rien
// en dessous n'est jamais rendu/lisible tant qu'elle est là.
//
// ⚠️ La page charge énormément d'iframes publicitaires tierces (Google, Criteo, etc. — confirmé
// par capture réseau) : frame.evaluate() n'a pas de timeout natif, et une seule iframe restée
// bloquée (navigation en cours, frame détachée...) suffisait à bloquer TOUTE cette fonction
// indéfiniment ("FUNCTION_INVOCATION_TIMEOUT" constaté en prod, aucun log après "goto terminé").
// Un timeout par frame seul ne suffit pas : avec des dizaines d'iframes, la somme des timeouts
// individuels peut encore dépasser la minute (59s constatés en prod avec 2s/frame × plusieurs
// dizaines de frames) — c'est donc le budget TOTAL de cette fonction qui est borné ci-dessous,
// quel que soit le nombre de frames à parcourir.
const FRAME_EVALUATE_TIMEOUT_MS = 500;
const DISMISS_CONSENT_BUDGET_MS = 4000;

async function dismissCookieConsent(page) {
  const stopAt = Date.now() + DISMISS_CONSENT_BUDGET_MS;
  for (const frame of page.frames()) {
    if (Date.now() >= stopAt) break;
    try {
      const clicked = await withTimeout(frame.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
        const btn = candidates.find((el) => /^(autoriser|accepter|accept|agree|tout accepter|j'accepte)$/i.test((el.textContent || '').trim()));
        if (btn) { btn.click(); return true; }
        return false;
      }), FRAME_EVALUATE_TIMEOUT_MS);
      if (clicked) return true;
    } catch (e) { /* frame cross-origin inaccessible ou détachée, on continue */ }
  }
  return false;
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

// Scrape un seul numéro sur une page dédiée — ses cookies sont explicitement supprimés avant sa
// fermeture (voir le "finally" plus bas), pour ne rien conserver une fois le colis traité.
//
// ⚠️ Utilisait initialement un BrowserContext incognito par numéro (navigation privée à proprement
// parler), mais celui-ci s'est révélé instable sous l'environnement Chromium restreint de Vercel
// (@sparticuz/chromium-min, système de fichiers en lecture seule sauf /tmp) : "Protocol error:
// Connection closed" constaté en prod sur les 5 pages en parallèle simultanément, signe d'un crash
// du navigateur entier lors de la création des contextes. Le nettoyage explicite des cookies offre
// une garantie équivalente ("rien n'est conservé après coup") sans cette instabilité.
async function scrapeOne(browser, num, deadline, pageLoadWaitMs, log = () => {}) {
  log(`  [${num}] newPage()...`);
  const page = await browser.newPage();
  log(`  [${num}] page créée`);

  // Capture la réponse de l'API réelle qui alimente le widget (/api/v2/parcels) — diagnostiquée
  // manuellement par captures d'écran une première fois (le site renvoie {"error":"RELOAD"} quand
  // sa protection anti-bot rejette la requête, {"error":"NO_DATA"} quand elle l'accepte mais que le
  // colis n'a simplement plus de données), pour ne plus avoir à refaire cette investigation
  // manuellement si le site rebloque à nouveau.
  let apiResponseBody = null;
  page.on('response', async (res) => {
    if (!/\/api\/v2\/parcels/i.test(res.url())) return;
    try { apiResponseBody = await res.text(); } catch (e) { /* best-effort */ }
  });

  try {
    await page.setUserAgent(REALISTIC_USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7' });
    await page.setViewport({ width: 1366, height: 900 });
    const parcelsappCookies = getParcelsappCookies();
    if (parcelsappCookies.length > 0) {
      await page.setCookie(...parcelsappCookies).catch((e) => log(`  [${num}] échec injection cookies: ${e && e.message}`));
    }
    // Pas de blocage des images ici : confirmé par capture d'écran, le site détecte
    // l'interception de requêtes (page.setRequestInterception) comme un bloqueur de pub et
    // affiche un bandeau "disable any ad or script blocking software" à la place du vrai contenu
    // — le blocage d'images "pour accélérer" cassait donc le scraping plutôt que de l'aider.
    log(`  [${num}] page configurée, goto()...`);

    const url = `https://parcelsapp.com/en/tracking/${encodeURIComponent(num)}`;
    const response = await page.goto(url, { waitUntil: 'load', timeout: Math.min(30000, deadline.remaining()) }).catch((e) => { log(`  [${num}] goto échoué: ${e && e.message}`); return null; });
    log(`  [${num}] goto terminé (status=${response ? response.status() : null})`);

    // Bannière de consentement cookies qui recouvre toute la page tant qu'elle n'est pas fermée
    // (confirmé par capture d'écran) — deux essais (pas plus, voir DISMISS_CONSENT_BUDGET_MS dans
    // dismissCookieConsent : une seule tentative est déjà bornée à 4s au total, pas la peine d'en
    // empiler beaucoup d'autres).
    let consentDismissed = await dismissCookieConsent(page);
    if (!consentDismissed) {
      await new Promise((r) => setTimeout(r, 500));
      consentDismissed = await dismissCookieConsent(page);
    }
    log(`  [${num}] consentement fermé=${consentDismissed}, waitForSelector...`);

    // Le tableau n'apparaît qu'une fois les transporteurs interrogés en direct (peut prendre
    // plusieurs secondes) — on attend son apparition plutôt qu'une pause fixe trop courte.
    const selectorTimeout = Math.max(1000, Math.min(20000, deadline.remaining() - 2000));
    const tableFound = await page.waitForSelector(RESULT_TABLE_SELECTOR, { timeout: selectorTimeout }).then(() => true).catch(() => false);
    log(`  [${num}] waitForSelector terminé (tableFound=${tableFound})`);

    await simulateHumanPresence(page);
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pageLoadWaitMs, deadline.remaining() - 1000))));

    let rawValue = await extractLastMile(page);
    log(`  [${num}] première extraction: ${JSON.stringify(rawValue)}`);
    if (!isPlausibleTrackingNumber(rawValue) && deadline.hasAtLeast(4000)) {
      await new Promise((r) => setTimeout(r, 3000));
      rawValue = await extractLastMile(page);
      log(`  [${num}] seconde extraction: ${JSON.stringify(rawValue)}`);
    }

    if (isPlausibleTrackingNumber(rawValue)) {
      return { found: true, trackingNumber: cleanNumSuivi(num), lastKm: cleanNumSuivi(rawValue) };
    }

    // Capturé avant la fermeture du contexte (voir "finally" ci-dessous) : permet de distinguer
    // "le site a changé de structure" d'une vraie absence de données, voir buildStructureChangeWarning.
    const domDebug = await withTimeout(page.evaluate(() => ({
      pageTitle: document.title,
      bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
    })), CLEANUP_TIMEOUT_MS) || { pageTitle: '', bodyTextPreview: '' };

    return {
      found: false,
      num,
      tableFound,
      rawValue: rawValue || null,
      httpStatus: response ? response.status() : null,
      finalUrl: page.url(),
      apiResponseBody: apiResponseBody ? apiResponseBody.slice(0, 300) : null,
      domDebug,
    };
  } catch (e) {
    log(`  [${num}] EXCEPTION: ${e && e.message}`);
    return { found: false, num, error: e && e.message };
  } finally {
    // "on supprime les cookies et on ferme" : nettoyage explicite avant fermeture de la page,
    // chaque étape bornée par CLEANUP_TIMEOUT_MS (voir sa définition) pour ne jamais bloquer
    // indéfiniment si la connexion au navigateur est instable.
    log(`  [${num}] nettoyage (cookies + close)...`);
    const cookies = await withTimeout(page.cookies(), CLEANUP_TIMEOUT_MS) || [];
    if (cookies.length) await withTimeout(page.deleteCookie(...cookies), CLEANUP_TIMEOUT_MS);
    await withTimeout(page.close(), CLEANUP_TIMEOUT_MS);
    log(`  [${num}] nettoyage terminé`);
  }
}

async function handler(req, res) {
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
  const startedAt = Date.now();
  // Instrumentation temporaire (à retirer une fois le diagnostic terminé) : les logs Vercel ne
  // montraient aucune trace applicative avant le "Task timed out after 60 seconds" côté
  // infrastructure — impossible de savoir où le temps partait sans ces horodatages.
  const log = (msg) => console.log(`[parcelsapp +${Date.now() - startedAt}ms] ${msg}`);

  let browser;
  try {
    log('avant lancement du navigateur');
    browser = await launchDedicatedStealthBrowser(deadline);
    log('navigateur lancé');

    const results = [];
    const perNumberDebug = [];
    let stoppedEarly = false;
    let nextIndex = 0;

    async function worker(workerId) {
      while (nextIndex < trackingNumbers.length) {
        if (!deadline.hasAtLeast(MIN_TIME_TO_ATTEMPT_MS)) { stoppedEarly = true; return; }
        const num = trackingNumbers[nextIndex++];
        log(`worker ${workerId} : début ${num}`);
        const outcome = await scrapeOne(browser, num, deadline, pageLoadWaitMs, log);
        log(`worker ${workerId} : fin ${num} (found=${outcome.found})`);
        if (outcome.found) results.push({ trackingNumber: outcome.trackingNumber, lastKm: outcome.lastKm });
        else perNumberDebug.push(outcome);
      }
    }

    const workerCount = Math.min(PAGE_POOL_SIZE, trackingNumbers.length);
    log(`lancement de ${workerCount} worker(s) pour ${trackingNumbers.length} numéro(s)`);
    await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i)));
    log('tous les workers ont terminé, envoi de la réponse');

    const debug = { requestedCount: trackingNumbers.length, resultCount: results.length, stoppedEarly };
    if (results.length === 0) {
      debug.perNumberDebug = perNumberDebug;
      const lastAttempt = perNumberDebug[perNumberDebug.length - 1];
      if (lastAttempt) {
        // Distingue une vraie absence de données (réponse API {"error":"NO_DATA"}, légitime — le
        // colis n'a simplement rien à afficher) d'un vrai changement de structure ou d'un blocage
        // anti-bot ({"error":"RELOAD"}) — sans cette distinction, le message générique
        // "le site a probablement changé de structure" était trompeur pour le cas NO_DATA,
        // pourtant le cas le plus fréquent en pratique (constaté en prod).
        if (lastAttempt.apiResponseBody && /"error"\s*:\s*"NO_DATA"/.test(lastAttempt.apiResponseBody)) {
          debug.structureChangeWarning = null;
          debug.noDataInfo = "Le site a répondu qu'il n'y a actuellement aucune donnée de suivi pour ce(s) colis (réponse API NO_DATA) — pas une erreur de scraping, juste une absence d'information côté parcelsapp.com pour l'instant.";
        } else if (lastAttempt.apiResponseBody && /"error"\s*:\s*"RELOAD"/.test(lastAttempt.apiResponseBody)) {
          debug.antiBotBlockWarning = "Le site a rejeté la requête (réponse API RELOAD) — probablement sa protection anti-bot qui a détecté quelque chose d'anormal, indépendamment des sélecteurs de scraping.";
        } else if (lastAttempt.domDebug) {
          debug.structureChangeWarning = buildStructureChangeWarning(lastAttempt.domDebug);
        }
      }
    }

    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    log(`EXCEPTION handler: ${e && e.message}`);
    const message = e && e.message ? e.message : 'échec du scraping PARCELSAPP';
    res.status(502).json({ error: message });
  } finally {
    // "on ferme le navigateur" : jamais réutilisé pour un prochain appel, contrairement aux autres
    // scrapers "furtifs" (voir le commentaire d'en-tête) — fermeture systématique ici, bornée par
    // CLEANUP_TIMEOUT_MS (voir sa définition : un close() peut sinon rester bloqué indéfiniment).
    if (browser) {
      log('fermeture du navigateur...');
      await withTimeout(browser.close(), CLEANUP_TIMEOUT_MS);
      log('navigateur fermé (ou timeout de nettoyage atteint)');
      // Filet de sécurité : si close() n'a pas abouti dans les temps, le process Chromium sous-
      // jacent pourrait continuer de tourner en arrière-plan (fuite de ressources dans un conteneur
      // Vercel réutilisé à chaud) — on le termine de force plutôt que de l'abandonner.
      try {
        const proc = browser.process();
        if (proc && proc.exitCode === null && !proc.killed) proc.kill('SIGKILL');
      } catch (e) { /* best-effort */ }
    }
    log('handler terminé');
  }
}

// Exporté par défaut pour Vercel (routage api/scrape.js) ; scrapeOne/Deadline sont aussi exposés
// pour scripts/local-scrape-worker.js, qui lance son PROPRE navigateur (le Chrome installé
// localement, sans les flags --no-sandbox imposés par @sparticuz/chromium-min sur Vercel — voir le
// commentaire sur getParcelsappCookies plus haut) et appelle scrapeOne directement dessus.
module.exports = handler;
module.exports.scrapeOne = scrapeOne;
module.exports.Deadline = Deadline;
