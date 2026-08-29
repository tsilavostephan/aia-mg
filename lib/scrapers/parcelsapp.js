// Fonction serverless Vercel : scraping headless de la page de suivi PARCELSAPP (parcelsapp.com).
//
// Comme CNE, ce site n'accepte qu'un seul numéro par lien (https://parcelsapp.com/en/tracking/NUM)
// — voir chunkSize:1 + scrapeChunkSize:10 sur l'entrée 'parcelsapp' dans CARRIERS
// (assets/script.js) : l'app envoie plusieurs numéros par appel de fonction, traités ici par petits
// groupes en parallèle (PAGE_POOL_SIZE pages du même navigateur déjà lancé).
//
// Le numéro dernier kilométrique apparaît dans le tableau "parcel-attributes", sous la ligne dont
// le libellé est exactement "Next tracking numbers" (confirmé par capture de l'utilisateur) :
//   <table class="parcel-attributes"><tbody>
//     <tr><td>Next tracking numbers</td><td class="value"><span>LP756941613FR</span></td></tr>
//   </tbody></table>
// Absent (ligne manquante ou valeur vide) pour les colis sans relais local — ce colis est alors
// simplement ignoré (pas d'entrée dans les résultats), comme pour les autres transporteurs.
//
// parcelsapp.com a une détection anti-bot qui bloque un Chromium headless "nu" — contournée via
// puppeteer-extra-plugin-stealth, voir api/_stealthScrapeLib.js.
const path = require('node:path');
const {
  cleanNumSuivi,
  setCorsHeaders,
  parseScrapeRequest,
  buildStructureChangeWarning,
} = require('../../api/_scrapeLib');
const { launchStealthBrowser, discardStealthBrowser } = require('../../api/_stealthScrapeLib');

const RESULT_TABLE_SELECTOR = 'table.parcel-attributes';
// Nombre de pages traitées en parallèle dans le même navigateur (au lieu d'un seul numéro à la
// fois) : chaque page attend son propre chargement/tableau indépendamment, ce qui multiplie le
// débit par lot sans lancer davantage de fonctions Vercel en parallèle (voir
// MAX_CONCURRENT_SCRAPES côté client, assets/script.js) — donc sans aggraver le risque de
// détection anti-bot ou de saturation des exécutions concurrentes de la plateforme.
const PAGE_POOL_SIZE = 3;
// Marge sous les 60s de maxDuration (vercel.json) : le chargement des modules (puppeteer-extra +
// évasions stealth) au démarrage à froid se produit avant handler() et n'est donc pas compté dans
// startTime, ce qui rognerait la marge réelle avant la coupure sans cette marge de 15s.
const FUNCTION_BUDGET_MS = 45000;
// En dessous de cette marge restante, on renonce à démarrer un nouveau numéro plutôt que d'en
// entamer un qu'on ne pourra manifestement pas terminer à temps.
const MIN_TIME_TO_ATTEMPT_MS = 8000;

// Regroupe le calcul du temps restant avant la coupure — évite de répéter "DEADLINE_MS - Date.now()"
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

async function blockImages(page) {
  // Inutiles pour lire le tableau parcel-attributes — accélère chaque page.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.resourceType() === 'image') req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

async function preparePage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await blockImages(page);
  return page;
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

// Lance le navigateur "furtif" en le bornant par le temps restant : sans ça, un lancement qui
// traîne (extraction du binaire Chromium au démarrage à froid) fait tuer la fonction par Vercel à
// 60s (FUNCTION_INVOCATION_TIMEOUT, sans réponse) plutôt que de renvoyer une erreur exploitable.
async function launchBrowserWithinBudget(deadline) {
  const timeoutMs = Math.max(1000, deadline.remaining());
  return Promise.race([
    launchStealthBrowser(path.join(__dirname, '..', '..', 'api', 'chromium-bin')),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`Lancement du navigateur trop long (> ${timeoutMs}ms)`)),
      timeoutMs,
    )),
  ]);
}

// Scrape un seul numéro sur une page donnée, en respectant le budget de temps restant à chaque
// étape. N'écrit jamais dans `results`/`debug` directement : renvoie un résultat que l'appelant
// range là où il faut (résultat trouvé ou entrée de diagnostic).
async function scrapeOne(page, num, deadline, pageLoadWaitMs) {
  const url = `https://parcelsapp.com/en/tracking/${encodeURIComponent(num)}`;
  try {
    // 'load' plutôt que 'domcontentloaded' (demande explicite) : on attend que la page soit
    // entièrement chargée (styles, scripts, images) avant de commencer à chercher le tableau.
    const response = await page.goto(url, { waitUntil: 'load', timeout: Math.min(30000, deadline.remaining()) }).catch(() => null);

    // Le tableau n'apparaît qu'une fois les transporteurs interrogés en direct (peut prendre
    // plusieurs secondes) — on attend son apparition plutôt qu'une pause fixe trop courte.
    const selectorTimeout = Math.max(1000, Math.min(20000, deadline.remaining() - 2000));
    const tableFound = await page.waitForSelector(RESULT_TABLE_SELECTOR, { timeout: selectorTimeout }).then(() => true).catch(() => false);
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pageLoadWaitMs, deadline.remaining() - 1000))));

    let lastKm = await extractLastMile(page);
    if (!lastKm && deadline.hasAtLeast(4000)) {
      await new Promise((r) => setTimeout(r, 3000));
      lastKm = await extractLastMile(page);
    }

    if (lastKm) {
      return { found: true, trackingNumber: cleanNumSuivi(num), lastKm: cleanNumSuivi(lastKm) };
    }
    return {
      found: false,
      num,
      tableFound,
      httpStatus: response ? response.status() : null,
      finalUrl: page.url(),
    };
  } catch (e) {
    return { found: false, num, error: e && e.message };
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
    browser = await launchBrowserWithinBudget(deadline);

    const pages = [];
    for (let i = 0; i < Math.min(PAGE_POOL_SIZE, trackingNumbers.length); i++) {
      pages.push(await preparePage(browser));
    }

    const results = [];
    const perNumberDebug = [];
    let stoppedEarly = false;
    let nextIndex = 0;

    async function worker(page) {
      while (nextIndex < trackingNumbers.length) {
        if (!deadline.hasAtLeast(MIN_TIME_TO_ATTEMPT_MS)) { stoppedEarly = true; return; }
        const num = trackingNumbers[nextIndex++];
        const outcome = await scrapeOne(page, num, deadline, pageLoadWaitMs);
        if (outcome.found) results.push({ trackingNumber: outcome.trackingNumber, lastKm: outcome.lastKm });
        else perNumberDebug.push(outcome);
      }
    }

    await Promise.all(pages.map(worker));

    const debug = { requestedCount: trackingNumbers.length, resultCount: results.length, stoppedEarly };
    if (results.length === 0) {
      debug.perNumberDebug = perNumberDebug;
      const domDebug = await pages[0].evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
      }));
      Object.assign(debug, domDebug);
      debug.structureChangeWarning = buildStructureChangeWarning(domDebug);
    }

    await Promise.all(pages.map((p) => p.close().catch(() => {})));
    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    await discardStealthBrowser(browser);
    const message = e && e.message ? e.message : 'échec du scraping PARCELSAPP';
    res.status(502).json({ error: message });
  }
};
