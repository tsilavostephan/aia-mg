// Liste des trigrammes existants — utilisé par login.html pour proposer un menu déroulant plutôt
// qu'un champ texte libre. Volontairement public (non authentifié, voir l'exemption dans
// middleware.js) : login.html en a besoin avant toute connexion. Ne renvoie QUE les trigrammes,
// jamais le rôle, la date de création ni a fortiori le hash de mot de passe.
const { setCorsHeaders } = require('./_scrapeLib');
const { listUsernames } = require('../lib/users');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    res.status(200).json({ usernames: await listUsernames() });
  } catch (e) {
    // DIAGNOSTIC TEMPORAIRE — à retirer une fois la cause de "relation users does not exist"
    // identifiée en prod/preview malgré une migration confirmée sur la base attendue. N'expose que
    // l'hôte (jamais les identifiants) pour vérifier si cette fonction se connecte bien à la même
    // base Postgres que celle migrée manuellement.
    const host = (() => {
      try { return new URL(process.env.POSTGRES_URL || '').host; } catch { return 'POSTGRES_URL absent/invalide'; }
    })();
    res.status(500).json({ error: e && e.message ? e.message : 'Erreur serveur.', debugHost: host });
  }
};
