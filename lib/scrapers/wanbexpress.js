// Fonction serverless Vercel : scraping headless de la page de suivi WANBEXPRESS (packageradar.com).
//
// Ce site n'accepte qu'un seul numéro par lien
// (https://packageradar.com/courier/wanbexpress/tracking/NUM) — l'app envoie plusieurs numéros par
// appel de fonction (voir chunkSize:1 + scrapeChunkSize:10 sur l'entrée 'wanbexpress' dans CARRIERS,
// assets/script.js), traités ici par petits groupes en parallèle (PAGE_POOL_SIZE onglets).
//
// Le numéro dernier kilométrique apparaît dans une carte confirmant explicitement le transporteur
// WanbExpress (confirmé par capture de l'utilisateur) :
//   <div class="card">
//     <dl class="card-body">
//       <dt>Additional tracking number</dt>
//       <dd><a href="/detect/DOFR9010212977328HD">DOFR9010212977328HD</a></dd>
//     </dl>
//     <p class="by-courier">Information by <a href="/courier/wanbexpress">Wanb Express</a></p>
//   </div>
// Absent (carte manquante) pour les colis sans relais local — ce colis est alors simplement ignoré
// (pas d'entrée dans les résultats), comme pour les autres transporteurs.
//
// Reprend les leçons apprises sur lib/scrapers/parcelsapp.js (même famille de site — anti-bot,
// bannière de consentement cookies, iframes publicitaires tierces potentiellement bloquantes) :
// stealth plugin, aucun blocage de requêtes/images (détecté comme ad-blocker sur parcelsapp.com,
// prudence appliquée ici aussi), fermeture de bannière de consentement bornée dans le temps total
// (pas juste par frame), et tous les appels de nettoyage (cookies, page.close, browser.close)
// bornés par un timeout explicite pour ne jamais bloquer la fonction indéfiniment.
const path = require('node:path');
const {
  cleanNumSuivi,
  setCorsHeaders,
  parseScrapeRequest,
  buildStructureChangeWarning,
} = require('../../api/_scrapeLib');

// Truc pour le traceur de fichiers de Vercel (@vercel/nft) — voir lib/scrapers/parcelsapp.js pour
// le détail : puppeteer-extra résout les dépendances de ses plugins via un require() calculé à
// l'exécution, indétectable par nft sans ce leurre.
if (false) {
  require('puppeteer-extra-plugin-user-preferences');
  require('puppeteer-extra-plugin-user-data-dir');
}

const PAGE_POOL_SIZE = 1;
const FUNCTION_BUDGET_MS = 45000;
const MIN_TIME_TO_ATTEMPT_MS = 8000;
const CLEANUP_TIMEOUT_MS = 5000;
const FRAME_EVALUATE_TIMEOUT_MS = 500;
const DISMISS_CONSENT_BUDGET_MS = 4000;
const REALISTIC_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

function withTimeout(promise, ms) {
  const safePromise = promise.catch(() => {});
  return Promise.race([
    safePromise,
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

// Une vraie valeur de suivi contient toujours un mélange de lettres et de chiffres — un mot de
// statut ou une valeur vide ne passe jamais ce test, sans avoir besoin d'un vrai dictionnaire.
function isPlausibleTrackingNumber(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (!/^[A-Za-z0-9]+$/.test(v)) return false;
  const letterCount = (v.match(/[A-Za-z]/g) || []).length;
  const digitCount = (v.match(/[0-9]/g) || []).length;
  return letterCount >= 2 && digitCount >= 5;
}

async function launchDedicatedStealthBrowser(deadline) {
  const { addExtra } = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  const puppeteerCore = require('puppeteer-core');
  const puppeteer = addExtra(puppeteerCore);
  puppeteer.use(StealthPlugin());

  const launchOptions = { headless: true };

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

  const timeoutMs = Math.max(1000, deadline.remaining());
  return Promise.race([
    puppeteer.launch(launchOptions),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`Lancement du navigateur trop long (> ${timeoutMs}ms)`)),
      timeoutMs,
    )),
  ]);
}

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
  return page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const cards = Array.from(document.querySelectorAll('div.card'));
    const card = cards.find((c) => {
      const byCourier = c.querySelector('p.by-courier');
      return byCourier && /wanb\s*express/i.test(norm(byCourier.textContent));
    });
    if (!card) return '';
    const rows = Array.from(card.querySelectorAll('dl.card-body > dt'));
    const dt = rows.find((el) => /^additional tracking number$/i.test(norm(el.textContent)));
    if (!dt) return '';
    const dd = dt.nextElementSibling;
    if (!dd || dd.tagName !== 'DD') return '';
    const link = dd.querySelector('a');
    return norm(link ? link.textContent : dd.textContent);
  });
}

async function simulateHumanPresence(page) {
  try {
    const width = 1366, height = 900;
    for (let i = 0; i < 2; i++) {
      await page.mouse.move(Math.random() * width, Math.random() * height, { steps: 10 + Math.floor(Math.random() * 10) });
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));
    }
  } catch (e) { /* best-effort, jamais bloquant */ }
}

async function scrapeOne(browser, num, deadline, pageLoadWaitMs, log = () => {}) {
  log(`  [${num}] newPage()...`);
  const page = await browser.newPage();
  log(`  [${num}] page créée`);
  try {
    await page.setUserAgent(REALISTIC_USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7' });
    await page.setViewport({ width: 1366, height: 900 });
    // Pas de blocage des images/requêtes ici : sur parcelsapp.com (même famille de site), ça se
    // faisait détecter comme un bloqueur de pub et cassait le rendu — prudence appliquée par défaut.
    log(`  [${num}] page configurée, goto()...`);

    const url = `https://packageradar.com/courier/wanbexpress/tracking/${encodeURIComponent(num)}`;
    const response = await page.goto(url, { waitUntil: 'load', timeout: Math.min(30000, deadline.remaining()) }).catch((e) => { log(`  [${num}] goto échoué: ${e && e.message}`); return null; });
    log(`  [${num}] goto terminé (status=${response ? response.status() : null})`);

    // Bannière de consentement cookies : un ou deux essais bornés au total (voir
    // DISMISS_CONSENT_BUDGET_MS), pas plus — inutile d'empiler les tentatives.
    let consentDismissed = await dismissCookieConsent(page);
    if (!consentDismissed) {
      await new Promise((r) => setTimeout(r, 500));
      consentDismissed = await dismissCookieConsent(page);
    }
    log(`  [${num}] consentement fermé=${consentDismissed}`);

    // Pas de sélecteur fixe à attendre ici (la carte n'a pas de classe dédiée identifiable avant
    // lecture) : une pause + une présence "humaine" avant de lire le contenu, avec une retentative
    // si rien n'est trouvé du premier coup.
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

    const domDebug = await withTimeout(page.evaluate(() => ({
      pageTitle: document.title,
      bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
    })), CLEANUP_TIMEOUT_MS) || { pageTitle: '', bodyTextPreview: '' };

    return {
      found: false,
      num,
      rawValue: rawValue || null,
      httpStatus: response ? response.status() : null,
      finalUrl: page.url(),
      domDebug,
    };
  } catch (e) {
    log(`  [${num}] EXCEPTION: ${e && e.message}`);
    return { found: false, num, error: e && e.message };
  } finally {
    log(`  [${num}] nettoyage (cookies + close)...`);
    const cookies = await withTimeout(page.cookies(), CLEANUP_TIMEOUT_MS) || [];
    if (cookies.length) await withTimeout(page.deleteCookie(...cookies), CLEANUP_TIMEOUT_MS);
    await withTimeout(page.close(), CLEANUP_TIMEOUT_MS);
    log(`  [${num}] nettoyage terminé`);
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

  const deadline = new Deadline(FUNCTION_BUDGET_MS);
  const startedAt = Date.now();
  const log = (msg) => console.log(`[wanbexpress +${Date.now() - startedAt}ms] ${msg}`);

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
      const preview = lastAttempt && lastAttempt.domDebug ? lastAttempt.domDebug.bodyTextPreview || '' : '';
      // Distingue les cas légitimes (temporaires, pas des bugs) d'un vrai problème :
      // - "your package is being tracked... please wait" : le site n'a pas encore fini de
      //   récupérer les données depuis le transporteur — se résoudra tout seul, repris
      //   automatiquement au prochain lancement du scraping (constaté en prod).
      // - "solve the captcha" : blocage anti-bot intermittent (probablement lié à la réputation
      //   de l'IP datacenter Vercel — constaté en prod, mais pas systématique, la plupart des
      //   requêtes passent).
      if (/being tracked|please wait a few minutes/i.test(preview)) {
        debug.stillProcessingInfo = "Le site n'a pas encore fini de récupérer les données de ce colis (\"your package is being tracked\") — pas une erreur, ça se résoudra en relançant le scraping plus tard.";
      } else if (/solve the captcha|confirm that you're not a robot/i.test(preview)) {
        debug.antiBotBlockWarning = "Le site a affiché un CAPTCHA (protection anti-bot, probablement liée à l'IP du serveur) — intermittent, pas systématique, réessayez plus tard.";
      } else if (lastAttempt && lastAttempt.domDebug) {
        debug.structureChangeWarning = buildStructureChangeWarning(lastAttempt.domDebug);
      }
    }

    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    log(`EXCEPTION handler: ${e && e.message}`);
    const message = e && e.message ? e.message : 'échec du scraping WANBEXPRESS';
    res.status(502).json({ error: message });
  } finally {
    if (browser) {
      log('fermeture du navigateur...');
      await withTimeout(browser.close(), CLEANUP_TIMEOUT_MS);
      log('navigateur fermé (ou timeout de nettoyage atteint)');
      try {
        const proc = browser.process();
        if (proc && proc.exitCode === null && !proc.killed) proc.kill('SIGKILL');
      } catch (e) { /* best-effort */ }
    }
    log('handler terminé');
  }
};
