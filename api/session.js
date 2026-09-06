// Renvoie le rôle/trigramme de la session en cours — utilisé par assets/script.js au chargement
// pour adapter l'interface au rôle (masquer import/scraping/nettoyage pour un compte "pc", etc.).
// Remplace api/login-code.js (devenu du code mort après la suppression de la couche de chiffrement
// AES des exports — plus aucun appelant côté client).
const { setCorsHeaders } = require('./_scrapeLib');
const { getSession } = require('../lib/auth');
const { findUserById } = require('../lib/users');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Non connecté.' });
    return;
  }

  const user = await findUserById(session.uid).catch(() => null);
  if (!user) {
    res.status(401).json({ error: 'Compte introuvable.' });
    return;
  }

  res.status(200).json({ role: user.role, username: user.username });
};
