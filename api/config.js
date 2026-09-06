// Configuration transporteur partagée (algorithmes de recherche, association manuelle
// transporteur, case "inclure les colis non résolus", délais de scraping) — réservé au rôle admin,
// seul rôle à voir la section transporteurs/scraping dans l'application (voir lib/config.js).
const { setCorsHeaders } = require('./_scrapeLib');
const { getSession } = require('../lib/auth');
const { KEYS, getAllConfig, setConfig } = require('../lib/config');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const session = getSession(req);
  if (!session || session.role !== 'admin') {
    res.status(403).json({ error: 'Réservé aux comptes administrateur.' });
    return;
  }

  try {
    if (req.method === 'GET') {
      res.status(200).json(await getAllConfig());
      return;
    }

    if (req.method === 'POST') {
      const { key, value } = req.body || {};
      if (!KEYS.includes(key)) {
        res.status(400).json({ error: 'Clé de configuration inconnue.' });
        return;
      }
      await setConfig(key, value === undefined ? null : value);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : 'Erreur serveur.' });
  }
};
