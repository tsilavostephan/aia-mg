// Scraping PARCELSAPP/WANBEXPRESS depuis CET ordinateur, avec le Chrome installé localement, au
// lieu du Chromium Vercel (@sparticuz/chromium-min). Raison d'être : ces deux sites (même famille,
// packageradar.com étant l'équivalent de parcelsapp.com pour WanbExpress) refusent les vraies
// données de suivi à une session lancée avec les flags --no-sandbox/--disable-setuid-sandbox
// qu'impose l'environnement serverless Vercel — un Chrome normal, lancé sans ces flags sur une
// machine classique, n'a pas ce problème (confirmé en diagnostic, voir lib/scrapers/parcelsapp.js).
//
// Usage (lancement manuel, pas un service qui tourne en continu — voir README) :
//   node --env-file=.env.local-worker scripts/local-scrape-worker.js
//
// Variables d'environnement attendues (voir .env.local-worker.example) :
//   APP_BASE_URL          URL de l'app déployée (ex. https://aia-mg-test-xxxx.vercel.app)
//   APP_ACCESS_CODE       Code d'accès (identique à celui utilisé sur /login.html)
//   CHROME_PATH           Chemin vers chrome.exe (optionnel, sinon emplacement standard Windows)
//   PARCELSAPP_COOKIES_JSON  Cookies de consentement pub pour parcelsapp.com (optionnel — voir le
//                            commentaire dans lib/scrapers/parcelsapp.js). Ne suffit pas toujours à
//                            lui seul avec un profil neuf (constaté en usage réel) — voir
//                            CHROME_USER_DATA_DIR ci-dessous pour l'option fiable.
//   CHROME_USER_DATA_DIR  Chemin vers VOTRE VRAI dossier de profil Chrome (ex.
//                         "C:\Users\<vous>\AppData\Local\Google\Chrome\User Data") — seule option
//                         constatée fiable pour PARCELSAPP (réputation/historique réel du profil).
//                         Chrome doit être COMPLÈTEMENT fermé pendant que ce script tourne.
//   CARRIERS              Transporteurs à traiter, séparés par des virgules (défaut : les deux)
//   CONCURRENCY           Onglets en parallèle (défaut 2 — modéré, pas d'agressivité inutile)

const path = require('node:path');
const parcelsapp = require('../lib/scrapers/parcelsapp');
const wanbexpress = require('../lib/scrapers/wanbexpress');

const BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const ACCESS_CODE = process.env.APP_ACCESS_CODE;
const CHROME_PATH = process.env.CHROME_PATH || path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
// Valeur par défaut plus agressive qu'en production Vercel (2) : sur un PC de bureau, plusieurs
// onglets en parallèle ne se font pas concurrence de la même façon que dans un conteneur serverless
// à CPU partagé et limité (voir le même raisonnement historique dans lib/scrapers/parcelsapp.js sur
// PAGE_POOL_SIZE) — ajustez CONCURRENCY selon les performances réelles constatées sur votre machine.
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY, 10) || 6);
const CARRIER_KEYS = (process.env.CARRIERS || 'parcelsapp,wanbexpress').split(',').map(s => s.trim()).filter(Boolean);
const PAGE_LOAD_WAIT_MS = parseInt(process.env.PAGE_LOAD_WAIT_MS, 10) || 4000;
const PER_NUMBER_BUDGET_MS = 45000;

// Reproduit resolveCarrierKeysForRow/CARRIERS.match (assets/script.js) pour les deux transporteurs
// concernés — ne tient PAS compte d'une association manuelle enregistrée depuis la fenêtre
// "⚙ Transporteurs" (stockée dans le localStorage du navigateur, inaccessible depuis ce script).
const CARRIER_MATCHERS = {
  parcelsapp: { module: parcelsapp, match: ['SF EXPRESS'], label: 'PARCELSAPP' },
  wanbexpress: { module: wanbexpress, match: ['WANBEXPRESS'], label: 'WanbExpress' },
};

function normCarrierName(v) {
  return String(v || '').trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

if (!BASE_URL || !ACCESS_CODE) {
  console.error('APP_BASE_URL et APP_ACCESS_CODE sont requis (voir .env.local-worker.example).');
  process.exit(1);
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: ACCESS_CODE }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`Échec de connexion (HTTP ${res.status})${body && body.error ? ' — ' + body.error : ''}`);
  }
  const setCookieList = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  const authCookie = setCookieList.map(c => c.split(';')[0]).find(c => c.startsWith('aia_auth='));
  if (!authCookie) throw new Error('Cookie de session introuvable dans la réponse de /api/auth.');
  return authCookie;
}

async function dbGet(cookie, action, params) {
  const qs = new URLSearchParams({ action, ...params });
  const res = await fetch(`${BASE_URL}/api/db?${qs.toString()}`, {
    headers: { Cookie: cookie },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`GET ${action} — HTTP ${res.status}${body && body.error ? ' — ' + body.error : ''}`);
  }
  return res.json();
}

async function dbPost(cookie, action, body) {
  const res = await fetch(`${BASE_URL}/api/db`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ action, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(`POST ${action} — HTTP ${res.status}${err && err.error ? ' — ' + err.error : ''}`);
  }
  return res.json();
}

async function fetchAllUnresolved(cookie) {
  // Pagination par curseur (id > afterId), pas par offset — voir le même principe dans
  // assets/script.js (refreshUnresolvedRows) et lib/db.js (unresolvedRows).
  const rows = [];
  let afterId = 0;
  for (;;) {
    const page = await dbGet(cookie, 'unresolved-rows', { limit: 5000, afterId });
    if (!page.rows || page.rows.length === 0) break;
    rows.push(...page.rows);
    afterId = page.rows[page.rows.length - 1].id;
    if (page.rows.length < 5000) break;
  }
  return rows;
}

async function runWithConcurrencyLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

async function scrapeCarrier(browser, key, numSuivis) {
  const { module: scraperModule, label } = CARRIER_MATCHERS[key];
  console.log(`\n[${label}] ${numSuivis.length} colis non résolu(s) à traiter (concurrence=${CONCURRENCY})...`);

  let done = 0;
  const found = [];
  await runWithConcurrencyLimit(numSuivis, CONCURRENCY, async (num) => {
    const deadline = new scraperModule.Deadline(PER_NUMBER_BUDGET_MS);
    const outcome = await scraperModule.scrapeOne(browser, num, deadline, PAGE_LOAD_WAIT_MS, () => {});
    done++;
    if (outcome.found) {
      found.push({ numSuivi: outcome.trackingNumber, numDernierKm: outcome.lastKm });
      console.log(`  [${label}] ${done}/${numSuivis.length} — ${num} -> ${outcome.lastKm}`);
    } else {
      const reason = outcome.apiResponseBody || outcome.error || (outcome.domDebug && outcome.domDebug.bodyTextPreview ? outcome.domDebug.bodyTextPreview.slice(0, 150) : '(aucun détail)');
      console.log(`  [${label}] ${done}/${numSuivis.length} — ${num} : pas de résultat — ${reason}`);
    }
  });

  return found;
}

(async () => {
  console.log(`Connexion à ${BASE_URL}...`);
  const cookie = await login();
  console.log('Connecté.');

  console.log('Récupération des colis non résolus...');
  const unresolved = await fetchAllUnresolved(cookie);
  console.log(`${unresolved.length} colis non résolu(s) au total.`);

  const byCarrier = {};
  for (const key of CARRIER_KEYS) {
    if (!CARRIER_MATCHERS[key]) { console.warn(`Transporteur inconnu ignoré : "${key}"`); continue; }
    const matchers = CARRIER_MATCHERS[key].match;
    byCarrier[key] = unresolved
      .filter(r => matchers.includes(normCarrierName(r.transporteur)))
      .map(r => r.numSuivi)
      .filter(Boolean);
  }

  const totalToScrape = Object.values(byCarrier).reduce((s, a) => s + a.length, 0);
  if (totalToScrape === 0) {
    console.log('Rien à scraper pour les transporteurs sélectionnés.');
    return;
  }

  const { addExtra } = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  const puppeteerCore = require('puppeteer-core');
  const puppeteer = addExtra(puppeteerCore);
  puppeteer.use(StealthPlugin());

  const launchOptions = {
    // HEADFUL=1 force une fenêtre visible — utile pour diagnostiquer un blocage silencieux au
    // démarrage (ex. dialogue "Restaurer les pages ?" après une fermeture non propre, un
    // avertissement de mise à jour, etc.) qu'un lancement headless ne peut pas laisser passer.
    headless: !process.env.HEADFUL,
    executablePath: CHROME_PATH,
    // Pas de --no-sandbox ici : c'est justement ce qui bloque parcelsapp.com/packageradar.com sur
    // Vercel — un Chrome normal sur une machine classique n'en a pas besoin.
    // --no-first-run/--no-default-browser-check/--disable-session-crashed-bubble : suppriment les
    // dialogues de première exécution / de restauration après fermeture non propre, qui bloqueraient
    // silencieusement un lancement headless (rien ne peut cliquer dessus) — constaté en usage réel
    // avec le vrai profil Chrome (timeout de 120s en attendant l'endpoint WS sans autre indice).
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-restore-session-state',
    ],
    // Délai par défaut de Puppeteer (30s) parfois trop court pour démarrer avec un VRAI profil
    // Chrome (beaucoup d'historique/extensions/cache à charger au premier lancement) — constaté en
    // usage réel ("Timed out ... waiting for the WS endpoint URL").
    timeout: 120000,
  };

  // CHROME_USER_DATA_DIR pointe directement sur le VRAI profil Chrome de l'utilisateur (pas une
  // copie, pas un profil dédié) — bénéficie de sa réputation/historique de navigation réel, seul
  // moyen constaté fiable pour PARCELSAPP (un profil neuf ou copié ne suffit pas, même avec les bons
  // cookies présents). Nécessite que Chrome soit COMPLÈTEMENT fermé (le dossier de profil est
  // verrouillé par une instance en cours) et désactive le nettoyage des cookies après chaque colis
  // (voir PARCELSAPP_KEEP_COOKIES dans lib/scrapers/parcelsapp.js) pour ne pas supprimer le cookie
  // de consentement du vrai profil dès le premier colis traité.
  if (process.env.CHROME_USER_DATA_DIR) {
    const fs = require('node:fs');
    const lockPath = path.join(process.env.CHROME_USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(lockPath)) {
      console.error(`\nChrome semble encore ouvert sur ce profil (${lockPath} présent).`);
      console.error('Fermez complètement Chrome (toutes les fenêtres, y compris en arrière-plan) avant de relancer ce script.');
      process.exit(1);
    }
    launchOptions.userDataDir = process.env.CHROME_USER_DATA_DIR;
    launchOptions.args.push(`--profile-directory=${process.env.CHROME_PROFILE_DIRECTORY || 'Default'}`);
    process.env.PARCELSAPP_KEEP_COOKIES = '1';
    console.log(`\n⚠️  Utilisation du profil Chrome réel (${process.env.CHROME_USER_DATA_DIR}) — ne rouvrez pas Chrome tant que ce script tourne.`);
  }

  console.log(`\nLancement de Chrome (${CHROME_PATH})...`);
  const browser = await puppeteer.launch(launchOptions);

  let totalUpdated = 0;
  try {
    for (const key of Object.keys(byCarrier)) {
      if (byCarrier[key].length === 0) continue;
      const found = await scrapeCarrier(browser, key, byCarrier[key]);
      if (found.length > 0) {
        const res = await dbPost(cookie, 'apply-scrape-results', { results: found });
        totalUpdated += res.updated;
        console.log(`[${CARRIER_MATCHERS[key].label}] ${res.updated} colis mis à jour en base.`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nTerminé — ${totalUpdated} colis mis à jour au total.`);
})().catch((e) => {
  console.error('ERREUR:', e && e.message ? e.message : e);
  process.exit(1);
});
