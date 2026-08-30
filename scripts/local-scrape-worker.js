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
//   PARCELSAPP_COOKIES_JSON  Cookies de consentement pub pour parcelsapp.com (optionnel mais
//                            recommandé — voir le commentaire dans lib/scrapers/parcelsapp.js pour
//                            comment les obtenir).
//   CARRIERS              Transporteurs à traiter, séparés par des virgules (défaut : les deux)
//   CONCURRENCY           Onglets en parallèle (défaut 2 — modéré, pas d'agressivité inutile)

const path = require('node:path');
const parcelsapp = require('../lib/scrapers/parcelsapp');
const wanbexpress = require('../lib/scrapers/wanbexpress');

const BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const ACCESS_CODE = process.env.APP_ACCESS_CODE;
const CHROME_PATH = process.env.CHROME_PATH || path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY, 10) || 2);
const CARRIER_KEYS = (process.env.CARRIERS || 'parcelsapp,wanbexpress').split(',').map(s => s.trim()).filter(Boolean);
const PAGE_LOAD_WAIT_MS = 4000;
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
      console.log(`  [${label}] ${done}/${numSuivis.length} — ${num} : pas de résultat`);
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

  console.log(`\nLancement de Chrome (${CHROME_PATH})...`);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    // Pas de --no-sandbox ici : c'est justement ce qui bloque parcelsapp.com/packageradar.com sur
    // Vercel — un Chrome normal sur une machine classique n'en a pas besoin.
    args: ['--disable-blink-features=AutomationControlled'],
  });

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
