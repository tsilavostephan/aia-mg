// Fonction serverless Vercel : proxy vers l'endpoint interne utilisé par la page de suivi
// Cainiao (https://track.cainiao.com/orderTrack, transporteur 4PX) pour contourner le CORS —
// cet endpoint ne renvoie aucun header Access-Control-Allow-Origin, un appel direct depuis le
// navigateur est donc bloqué. Le format exact de sa réponse n'étant pas documenté publiquement,
// cette fonction renvoie le JSON de Cainiao tel quel : ajustez le mapping des champs dans la
// fenêtre "⚙ Config API 4PX" de l'app une fois qu'une réponse réelle aura été inspectée (l'app
// affiche un aperçu brut de la réponse si le mapping ne correspond pas).
//
// Déploiement : ce fichier doit se trouver dans un dossier /api à la racine du projet déployé
// sur Vercel (zero-config, aucune dépendance ni build supplémentaire nécessaire).

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

  const mailNos = trackingNumbers.join(',');
  const url = `https://global.cainiao.com/global/detail.json?mailNos=${encodeURIComponent(mailNos)}&lang=en-US&language=en-US`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Cainiao a renvoyé le statut ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e && e.message ? e.message : 'échec de la requête vers Cainiao' });
  }
};
