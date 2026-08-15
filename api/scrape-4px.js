// Fonction serverless Vercel : scraping headless de la page de suivi Cainiao (4PX).
//
// On avait d'abord essayé d'appeler l'endpoint interne https://global.cainiao.com/global/detail.json,
// mais sa réponse ne contient pas le numéro dernier kilométrique (le tableau "detailList" est vide) —
// cette donnée n'existe que dans la page rendue, via le bouton "Copy Overview".
//
// Cette fonction ouvre donc réellement la page https://track.cainiao.com/orderTrack?mailNoList=...
// dans un navigateur headless (Puppeteer + Chromium empaqueté pour environnement serverless),
// attend son chargement complet, clique sur "Copy Overview" et lit le texte ainsi copié dans le
// presse-papier du navigateur headless. Ce texte est ensuite découpé avec exactement la même règle
// que l'import manuel par collage de l'app (colonne 0 = numéro de suivi, colonne 1 = numéro dernier
// kilométrique, "(Unknown)"/vide => pas de numéro) — voir parseTrackingPaste dans assets/script.js.
//
// ⚠️ Non vérifié en conditions réelles (pas de navigateur disponible pour tester dans cet
// environnement) : le nom du bouton, le délai de rendu et le repli DOM ci-dessous sont une
// estimation raisonnable à ajuster une fois testés sur un vrai déploiement Vercel.
//
// Chromium : on utilise @sparticuz/chromium-min, dont les fichiers binaires sont lus depuis le
// dossier local api/chromium-bin (copié pendant le build par scripts/postinstall.mjs à partir de
// la devDependency @sparticuz/chromium, et inclus dans le paquet de la fonction via "includeFiles"
// dans vercel.json). On évite ainsi tout appel HTTP au démarrage — important ici car les
// déploiements de ce projet sont protégés par la Vercel Authentication, qui bloquerait un appel
// que la fonction ferait vers sa propre URL publique (chromium-min tenterait alors de décompresser
// la page de connexion Vercel comme si c'était un tar, d'où l'erreur "Invalid tar header").
// Cette approche évite aussi les incompatibilités de bibliothèques partagées du type
// "libnss3.so: cannot open shared object file" rencontrées avec le package @sparticuz/chromium complet.
const path = require('node:path');
const puppeteer = require('puppeteer-core');

let cachedExecutablePath = null;
let launchPromise = null;

// Résout (une seule fois par instance de fonction, puis mis en cache) le chemin de l'exécutable
// Chromium à partir du dossier local api/chromium-bin.
async function getChromiumExecutablePath() {
  if (cachedExecutablePath) return cachedExecutablePath;
  if (!launchPromise) {
    launchPromise = (async () => {
      const chromium = (await import('@sparticuz/chromium-min')).default;
      const binDir = path.join(__dirname, 'chromium-bin');
      const execPath = await chromium.executablePath(binDir);
      cachedExecutablePath = execPath;
      return execPath;
    })().catch((e) => { launchPromise = null; throw e; });
  }
  return launchPromise;
}

// Nettoie une valeur comme cleanNumSuivi() dans assets/script.js (retire =, ", ', \, trim)
function cleanNumSuivi(v) {
  return String(v ?? '').replace(/[="'\\]/g, '').trim();
}

// Reprend exactement la règle de parseTrackingPaste(text, kmColIndex=1, skipHeader=false, matchColIndex=0)
// utilisée par l'import manuel 4PX dans assets/script.js, pour un résultat cohérent entre les deux voies.
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const trackingNumbers = req.method === 'POST'
    ? (req.body && req.body.trackingNumbers) || []
    : String(req.query.trackingNumbers || '').split(',').map(v => v.trim()).filter(Boolean);

  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    res.status(400).json({ error: 'trackingNumbers manquant ou vide' });
    return;
  }

  const url = `https://track.cainiao.com/orderTrack?mailNoList=${encodeURIComponent(trackingNumbers.join(','))}`;

  let browser;
  try {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    const executablePath = await getChromiumExecutablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    // Laisse le temps au rendu JS de la page (chargement asynchrone des statuts de suivi) de finir.
    await new Promise(r => setTimeout(r, 4000));

    let overviewText = null;
    const clickDebug = { iconFound: false, clipboardResult: null };
    try {
      // Autorise la lecture/écriture du presse-papier headless avant d'interagir (nécessaire pour
      // que navigator.clipboard.readText() fonctionne une fois le bouton actionné).
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://track.cainiao.com', ['clipboard-read', 'clipboard-write']);

      // Confirmé par capture DevTools de l'utilisateur : c'est bien le <span> portant la classe
      // "copySingle" (en plus de "iconWrapper") qui donne le bon résultat (tableau complet) quand on
      // clique dessus manuellement. On le cible donc explicitement, avec repli sur le 1er span
      // aria-haspopup du wrapper si jamais la classe changeait.
      await page.waitForSelector('[class*="copyWrapper"] span[aria-haspopup="true"]', { timeout: 15000 }).catch(() => {});

      // Vercel/headless Chrome : la page doit être au premier plan et avoir le focus pour que
      // l'API Clipboard fonctionne (navigator.clipboard.readText() échoue silencieusement sinon).
      await page.bringToFront();
      await page.evaluate(() => window.focus());

      // Marqueur écrit AVANT le clic : si on retrouve ce même marqueur après avoir cliqué, ça prouve
      // que le clic n'a rien copié du tout (plutôt que de deviner à partir du contenu lu).
      const sentinel = '__SENTINEL_BEFORE_CLICK__';
      await page.evaluate((s) => navigator.clipboard.writeText(s).catch(() => {}), sentinel);

      const iconHandle = (await page.evaluateHandle(() => {
        const wrapper = document.querySelector('[class*="copyWrapper"]');
        if (!wrapper) return null;
        const spans = Array.from(wrapper.querySelectorAll('span[aria-haspopup="true"]'));
        return spans.find(s => /copySingle/i.test(s.className)) || spans[0] || null;
      })).asElement();
      clickDebug.iconFound = !!iconHandle;
      if (iconHandle) {
        // Beaucoup de composants d'icône React n'affichent leur action qu'au survol réel
        // (onMouseEnter) — on simule donc un vrai survol souris avant de cliquer, plutôt qu'un
        // .click() synthétique via page.evaluate qui ne déclenche pas ces gestionnaires.
        await iconHandle.hover().catch(() => {});
        await new Promise(r => setTimeout(r, 400));
        await iconHandle.click().catch(() => {});
        await new Promise(r => setTimeout(r, 600));

        // Si un menu/popup contenant un libellé "Copy Overview" est apparu, on le clique aussi ;
        // sinon on suppose que le clic/survol précédent a déjà déclenché la copie directement.
        await page.evaluate(() => {
          const el = Array.from(document.querySelectorAll('button, a, span, div, li'))
            .find(e => /copy overview/i.test(e.textContent || '') && e.offsetParent !== null);
          if (el) el.click();
        });
        await new Promise(r => setTimeout(r, 500));

        const rawClipboard = await page.evaluate(() =>
          navigator.clipboard.readText().then(t => ({ ok: true, value: t })).catch(e => ({ ok: false, error: e && e.message }))
        );
        clickDebug.clipboardResult = rawClipboard;
        clickDebug.clipboardUnchangedFromSentinel = rawClipboard.ok && rawClipboard.value === sentinel;
        overviewText = rawClipboard.ok ? rawClipboard.value : null;
      }
    } catch (e) {
      clickDebug.error = e && e.message;
      overviewText = null;
    }

    let results;
    if (overviewText) {
      results = parseOverviewText(overviewText);
    } else {
      // Repli si le bouton "Copy Overview" ou le presse-papier headless n'est pas accessible :
      // lecture directe des lignes du tableau de résultats dans le DOM (mêmes colonnes 0/1).
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('table tr')).map(tr =>
          Array.from(tr.querySelectorAll('td, th')).map(td => (td.textContent || '').trim())
        )
      );
      results = rows
        .filter(cols => cols.length >= 1 && cols[0])
        .map(cols => {
          const trackingNumber = cleanNumSuivi(cols[0]);
          let lastKm = cols.length > 1 ? cols[1] : '';
          if (!lastKm || /^\(?unknown\)?$/i.test(lastKm)) lastKm = '';
          return { trackingNumber, lastKm };
        })
        .filter(r => r.trackingNumber);
    }

    // Diagnostic : toujours inclus (pas seulement si 0 résultat), pour voir précisément ce que le
    // clic a réellement copié — y compris quand ça "marche" mais donne le mauvais format.
    const debug = { clickDebug, overviewTextPreview: overviewText ? overviewText.slice(0, 500) : null };

    if (!results || results.length === 0) {
      const domDebug = await page.evaluate(() => {
        const describe = (el) => ({
          tag: el.tagName,
          className: typeof el.className === 'string' ? el.className : '',
          title: el.getAttribute('title') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text: (el.textContent || '').trim().slice(0, 80),
          outerHTML: (el.outerHTML || '').slice(0, 300),
        });

        const haspopupElements = Array.from(document.querySelectorAll('[aria-haspopup]')).map(describe);
        const copyWrapperEl = document.querySelector('[class*="copyWrapper"]');

        return {
          pageTitle: document.title,
          bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
          haspopupElements,
          copyWrapperHTML: copyWrapperEl ? copyWrapperEl.outerHTML : null,
        };
      });
      Object.assign(debug, domDebug);
    }

    await browser.close();
    res.status(200).json({ results, usedOverviewButton: !!overviewText, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping 4PX';
    res.status(502).json({ error: message });
  }
};
