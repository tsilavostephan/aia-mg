// Fonction serverless Vercel : scraping headless de la page de suivi Sunyou (sypost.net).
//
// La page https://www.sypost.net/search?orderNo=NUM1,%20NUM2 affiche un résumé par colis. Deux
// icônes copier sont présentes côte à côte dans l'en-tête du tableau : Copy-1.png
// (copyTrackResult(1), "detailed") et Copy-2.png (copyTrackResult(2), "summary"). Avec la fenêtre
// headless par défaut (trop étroite), les deux boutons renvoyaient le même résumé tronqué (dernier
// événement seulement) — en forçant une fenêtre desktop large (1920×1080), copyTrackResult(2)
// renvoie bien le texte structuré complet attendu :
//
//   Number：SYZZ046744464
//   Package status： Delivered (7 Days)
//   ...
//   2026-08-04 23:00 Departed Sunyou Facility, Carrier Tracking Number:  DOFR9010189379715HD
//   ...
//   ====================================================
//   Number：SYZZ046624049
//   ...
//   Powered by www.sypost.net
//
// confirmé par l'utilisateur. Le numéro dernier kilométrique n'est pas sur une ligne dédiée mais
// mentionné dans l'un des événements ("Carrier Tracking Number: XXXX"), donc on analyse chaque bloc
// séparé par les lignes "====" plutôt que d'utiliser le découpage générique colonne 0/1.
const path = require('node:path');
const {
  launchBrowser,
  cleanNumSuivi,
  setCorsHeaders,
  parseScrapeRequest,
  readClipboardWithSentinelCheck,
} = require('./_scrapeLib');

function parseSunyouOverview(text) {
  const blocks = String(text || '').split(/=+/).map((b) => b.trim()).filter(Boolean);
  const results = [];
  for (const block of blocks) {
    if (/^powered by/i.test(block)) continue;
    const numMatch = block.match(/Number[:：]\s*(\S+)/i);
    if (!numMatch) continue;
    const kmMatch = block.match(/Carrier Tracking Number\s*[:：]\s*(\S+)/i);
    results.push({ trackingNumber: numMatch[1], lastKm: kmMatch ? kmMatch[1] : '' });
  }
  return results;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { trackingNumbers, pageLoadWaitMs, clickWaitMs } = parseScrapeRequest(req);

  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    res.status(400).json({ error: 'trackingNumbers manquant ou vide' });
    return;
  }

  const url = `https://www.sypost.net/search?orderNo=${encodeURIComponent(trackingNumbers.join(', '))}`;

  let browser;
  try {
    browser = await launchBrowser(path.join(__dirname, 'chromium-bin'));

    const page = await browser.newPage();
    // Cf. commentaire d'en-tête : une fenêtre desktop large est nécessaire pour que le bouton copier
    // renvoie le texte détaillé complet plutôt qu'un résumé tronqué.
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, pageLoadWaitMs));

    let overviewText = null;
    const clickDebug = { copyBtnFound: false, clipboardResult: null };
    try {
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://www.sypost.net', ['clipboard-read', 'clipboard-write']);

      await page.bringToFront();
      await page.evaluate(() => window.focus());

      const sentinel = await readClipboardWithSentinelCheck(page);

      const copyIconsDebug = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img[onclick*="copyTrackResult"], img.pointer')).map((img) => ({
          src: img.getAttribute('src') || '',
          onclick: img.getAttribute('onclick') || '',
          title: img.getAttribute('title') || '',
        }))
      );
      clickDebug.copyIconsFound = copyIconsDebug;

      // Cible explicitement Copy-2.png (copyTrackResult(2)) — avec la fenêtre desktop large ci-dessus,
      // ce bouton renvoie bien le texte détaillé complet (voir commentaire d'en-tête).
      const copyBtnHandle = (await page.evaluateHandle(() => {
        const exact = document.querySelector('img[onclick="copyTrackResult(2)"]');
        if (exact) return exact;
        const candidates = Array.from(document.querySelectorAll('img[onclick*="copyTrackResult"], img.pointer'));
        return candidates[0] || null;
      })).asElement();
      clickDebug.copyBtnFound = !!copyBtnHandle;
      clickDebug.copyBtnClicked = copyBtnHandle
        ? await copyBtnHandle.evaluate((el) => ({ src: el.getAttribute('src'), onclick: el.getAttribute('onclick') })).catch(() => null)
        : null;

      if (copyBtnHandle) {
        await copyBtnHandle.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
        await new Promise((r) => setTimeout(r, 200));
        // Les deux icônes copier sont côte à côte : un clic par coordonnées (hover + click) risque
        // de tomber légèrement à côté et d'atteindre l'autre icône. Un clic natif directement sur
        // l'élément (bypass des coordonnées écran) est plus fiable ici.
        await copyBtnHandle.evaluate((el) => el.click()).catch(() => {});
        await new Promise((r) => setTimeout(r, clickWaitMs));

        const rawClipboard = await page.evaluate(() =>
          navigator.clipboard.readText().then((t) => ({ ok: true, value: t })).catch((e) => ({ ok: false, error: e && e.message }))
        );
        clickDebug.clipboardResult = rawClipboard;
        clickDebug.clipboardUnchangedFromSentinel = rawClipboard.ok && rawClipboard.value === sentinel;
        overviewText = rawClipboard.ok ? rawClipboard.value : null;
      }
    } catch (e) {
      clickDebug.error = e && e.message;
      overviewText = null;
    }

    const results = overviewText
      ? parseSunyouOverview(overviewText)
        .map((r) => ({ trackingNumber: cleanNumSuivi(r.trackingNumber), lastKm: cleanNumSuivi(r.lastKm) }))
        .filter((r) => r.trackingNumber && r.lastKm)
      : [];

    const debug = { clickDebug, overviewTextPreview: overviewText ? overviewText.slice(0, 500) : null };

    if (results.length === 0) {
      const domDebug = await page.evaluate(() => ({
        pageTitle: document.title,
        bodyTextPreview: (document.body ? document.body.innerText : '').slice(0, 1000),
      }));
      Object.assign(debug, domDebug);
    }

    // ⚠️ rawText est volontairement laissé à null : le format Sunyou (blocs multi-lignes avec
    // "Carrier Tracking Number: ..." noyé dans les événements) n'est pas compatible avec le
    // découpage générique colonne 0/1 (parseTrackingPaste) utilisé côté client quand rawText est
    // fourni — results ci-dessus est déjà correctement analysé côté serveur via parseSunyouOverview.
    await browser.close();
    res.status(200).json({ results, rawText: null, usedOverviewButton: !!overviewText, debug });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch (_e) { /* déjà fermé */ } }
    const message = e && e.message ? e.message : 'échec du scraping Sunyou';
    res.status(502).json({ error: message });
  }
};
