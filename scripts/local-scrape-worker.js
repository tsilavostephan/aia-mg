// Scraping WANBEXPRESS depuis CET ordinateur, avec le Chrome installé localement, en secours du
// scraping automatique sur Vercel (utile si un lot échoue en prod pour une raison ponctuelle —
// CAPTCHA intermittent lié à la réputation de l'IP datacenter Vercel, par exemple).
//
// Usage (lancement manuel, pas un service qui tourne en continu — voir README) :
//   node --env-file=.env.local-worker scripts/local-scrape-worker.js
//
// Variables d'environnement attendues (voir .env.local-worker.example) :
//   APP_BASE_URL          URL de l'app déployée (ex. https://aia-mg-test-xxxx.vercel.app)
//   APP_ACCESS_CODE       Code d'accès (identique à celui utilisé sur /login.html)
//   CHROME_PATH           Chemin vers chrome.exe (optionnel, sinon emplacement standard Windows)
//   CONCURRENCY           Onglets en parallèle (défaut 6 — un PC de bureau encaisse mieux la
//                         concurrence qu'une fonction serverless Vercel à CPU partagé)
//   PAGE_LOAD_WAIT_MS     Délai d'attente après chargement de page avant lecture (défaut 4000)

const path = require('node:path');
const wanbexpress = require('../lib/scrapers/wanbexpress');

const BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const ACCESS_CODE = process.env.APP_ACCESS_CODE;
const CHROME_PATH = process.env.CHROME_PATH || path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
// Valeur par défaut plus agressive qu'en production Vercel (2) : sur un PC de bureau, plusieurs
// onglets en parallèle ne se font pas concurrence de la même façon que dans un conteneur serverless
// à CPU partagé et limité (voir le même raisonnement historique dans lib/scrapers/wanbexpress.js sur
// PAGE_POOL_SIZE) — ajustez CONCURRENCY selon les performances réelles constatées sur votre machine.
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY, 10) || 6);
const PAGE_LOAD_WAIT_MS = parseInt(process.env.PAGE_LOAD_WAIT_MS, 10) || 4000;
const PER_NUMBER_BUDGET_MS = 45000;

// Reproduit resolveCarrierKeysForRow/CARRIERS.match (assets/script.js) pour WANBEXPRESS — ne tient
// PAS compte d'une association manuelle enregistrée depuis la fenêtre "⚙ Transporteurs" (stockée
// dans le localStorage du navigateur, inaccessible depuis ce script).
const CARRIER_MATCH = ['WANBEXPRESS'];
const CARRIER_LABEL = 'WanbExpress';

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

// Envoie les résultats en base par lots de FLUSH_THRESHOLD dès qu'ils s'accumulent, plutôt que
// d'attendre la toute fin du scraping — sur 1000+ colis, une interruption (Ctrl+C, coupure réseau,
// PC qui s'endort) en cours de route ne fait alors perdre que le dernier lot partiel, pas tout le
// travail déjà accompli.
const FLUSH_THRESHOLD = 50;

async function scrapeWanbexpress(cookie, browser, numSuivis) {
  console.log(`\n[${CARRIER_LABEL}] ${numSuivis.length} colis non résolu(s) à traiter (concurrence=${CONCURRENCY})...`);

  let pending = [];
  let totalUpdated = 0;
  // Les lots sont envoyés dans l'ordre où ils se remplissent, mais jamais deux envois en même
  // temps (POST /api/db) — chaque appel à scheduleFlush s'enchaîne après le précédent.
  let flushChain = Promise.resolve();

  function scheduleFlush(batch) {
    flushChain = flushChain
      .then(() => dbPost(cookie, 'apply-scrape-results', { results: batch }))
      .then((res) => {
        totalUpdated += res.updated;
        console.log(`  [${CARRIER_LABEL}] → lot de ${batch.length} envoyé en base (${res.updated} mis à jour, ${totalUpdated} au total jusqu'ici).`);
      })
      .catch((e) => console.error(`  [${CARRIER_LABEL}] échec d'envoi d'un lot de ${batch.length} résultat(s) :`, e && e.message ? e.message : e));
  }

  let done = 0;
  await runWithConcurrencyLimit(numSuivis, CONCURRENCY, async (num) => {
    const deadline = new wanbexpress.Deadline(PER_NUMBER_BUDGET_MS);
    const outcome = await wanbexpress.scrapeOne(browser, num, deadline, PAGE_LOAD_WAIT_MS, () => {});
    done++;
    if (outcome.found) {
      pending.push({ numSuivi: outcome.trackingNumber, numDernierKm: outcome.lastKm });
      console.log(`  [${CARRIER_LABEL}] ${done}/${numSuivis.length} — ${num} -> ${outcome.lastKm}`);
      // Découpage synchrone (pas d'await entre la vérification et la remise à zéro) : sûr même
      // avec plusieurs numéros traités en parallèle (CONCURRENCY), aucun résultat ne peut être
      // compté deux fois ni oublié entre deux lots.
      if (pending.length >= FLUSH_THRESHOLD) {
        const batch = pending;
        pending = [];
        scheduleFlush(batch);
      }
    } else {
      const reason = outcome.error || (outcome.domDebug && outcome.domDebug.bodyTextPreview ? outcome.domDebug.bodyTextPreview.slice(0, 150) : '(aucun détail)');
      console.log(`  [${CARRIER_LABEL}] ${done}/${numSuivis.length} — ${num} : pas de résultat — ${reason}`);
    }
  });

  if (pending.length > 0) scheduleFlush(pending);
  await flushChain;

  return totalUpdated;
}

(async () => {
  console.log(`Connexion à ${BASE_URL}...`);
  const cookie = await login();
  console.log('Connecté.');

  console.log('Récupération des colis non résolus...');
  const unresolved = await fetchAllUnresolved(cookie);
  console.log(`${unresolved.length} colis non résolu(s) au total.`);

  const numSuivis = unresolved
    .filter(r => CARRIER_MATCH.includes(normCarrierName(r.transporteur)))
    .map(r => r.numSuivi)
    .filter(Boolean);

  if (numSuivis.length === 0) {
    console.log(`Rien à scraper pour ${CARRIER_LABEL}.`);
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
    args: ['--disable-blink-features=AutomationControlled'],
  });

  let totalUpdated = 0;
  try {
    totalUpdated = await scrapeWanbexpress(cookie, browser, numSuivis);
  } finally {
    await browser.close();
  }

  console.log(`\nTerminé — ${totalUpdated} colis mis à jour au total.`);
})().catch((e) => {
  console.error('ERREUR:', e && e.message ? e.message : e);
  process.exit(1);
});
