// Fonction serverless Vercel : récupération du numéro dernier kilométrique via l'API officielle
// 17TRACK (v2.2), utilisée pour SF Express — remplace l'ancien scraping headless de
// t.17track.net, bloqué par la protection anti-bot Cloudflare du site.
//
// Nécessite la variable d'environnement Vercel TRACK17_API_KEY (clé API 17track, jamais exposée au
// navigateur). Flux standard de l'API v2.2 : /register (enregistre les numéros pour suivi) puis
// /gettrackinfo (récupère les données de suivi détaillées).
//
// ⚠️ Le champ exact contenant le numéro de suivi du transporteur "dernier kilométrique" (visible sur
// le site t.17track.net sous "Last-mile Tracking Number") n'est pas documenté avec certitude dans la
// réponse de l'API publique — un échantillon brut de track_info est donc toujours renvoyé en
// diagnostic pour ajuster l'extraction si besoin, une fois une vraie réponse observée.
const { cleanNumSuivi, setCorsHeaders, parseScrapeRequest } = require('./_scrapeLib');

const REGISTER_URL = 'https://api.17track.net/track/v2.2/register';
const GET_INFO_URL = 'https://api.17track.net/track/v2.2/gettrackinfo';

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const apiKey = process.env.TRACK17_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Variable d'environnement TRACK17_API_KEY manquante sur Vercel (clé API 17track)." });
    return;
  }

  const { trackingNumbers } = parseScrapeRequest(req);
  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    res.status(400).json({ error: 'trackingNumbers manquant ou vide' });
    return;
  }

  const headers = { '17token': apiKey, 'Content-Type': 'application/json' };
  const body = JSON.stringify(trackingNumbers.map((n) => ({ number: n })));

  try {
    const registerRes = await fetch(REGISTER_URL, { method: 'POST', headers, body });
    const registerJson = await registerRes.json().catch(() => null);

    // Laisse un peu de temps à 17track pour récupérer les données si l'un des numéros vient d'être
    // enregistré pour la première fois (les colis en question étant déjà suivis via le site, cette
    // marge devrait suffire dans la plupart des cas).
    await new Promise((r) => setTimeout(r, 3000));

    const infoRes = await fetch(GET_INFO_URL, { method: 'POST', headers, body });
    const infoJson = await infoRes.json().catch(() => null);

    if (!infoRes.ok || !infoJson) {
      res.status(502).json({ error: `réponse HTTP ${infoRes.status} de l'API 17track`, debug: { registerJson, infoJson } });
      return;
    }

    const accepted = (infoJson.data && Array.isArray(infoJson.data.accepted)) ? infoJson.data.accepted : [];

    const results = [];
    const rawTrackInfoSample = [];
    accepted.forEach((item) => {
      const trackingNumber = cleanNumSuivi(item.number);

      // Confirmé par une vraie réponse API : le numéro dernier kilométrique est exposé sous
      // track_info.misc_info.local_number (ex. "LP756776806FR"), pas dans tracking.providers.
      const localNumber = item.track_info && item.track_info.misc_info ? item.track_info.misc_info.local_number : '';
      const lastKm = (localNumber && cleanNumSuivi(localNumber) !== trackingNumber) ? cleanNumSuivi(localNumber) : '';

      results.push({ trackingNumber, lastKm });
      if (rawTrackInfoSample.length < 3) rawTrackInfoSample.push({ number: item.number, track_info: item.track_info });
    });

    const debug = {
      registerCode: registerJson && registerJson.code,
      infoCode: infoJson.code,
      acceptedCount: accepted.length,
      rejected: infoJson.data && infoJson.data.rejected,
      rawTrackInfoSample,
    };

    res.status(200).json({ results, rawText: null, usedOverviewButton: false, debug });
  } catch (e) {
    const message = e && e.message ? e.message : "échec de l'appel API 17track";
    res.status(502).json({ error: message });
  }
};
