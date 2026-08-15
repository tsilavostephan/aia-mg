// Vérifie le code d'accès soumis depuis login.html et, s'il est correct, pose le cookie "aia_auth"
// que middleware.js contrôle ensuite sur toutes les autres pages/API.
//
// Nécessite les variables d'environnement Vercel :
// - APP_ACCESS_CODE : le code que l'utilisateur doit saisir.
// - APP_AUTH_SECRET : secret utilisé pour signer le cookie (optionnel, retombe sur APP_ACCESS_CODE
//   si absent — mais il est recommandé d'utiliser un secret distinct, plus long).
const crypto = require('node:crypto');
const { setCorsHeaders } = require('./_scrapeLib');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  const expectedCode = process.env.APP_ACCESS_CODE;
  if (!expectedCode) {
    res.status(500).json({ error: "Variable d'environnement APP_ACCESS_CODE manquante sur Vercel." });
    return;
  }

  const { code } = req.body || {};
  if (String(code || '') !== String(expectedCode)) {
    res.status(401).json({ error: 'Code incorrect.' });
    return;
  }

  const secret = process.env.APP_AUTH_SECRET || expectedCode;
  const token = crypto.createHmac('sha256', secret).update('authenticated').digest('hex');

  const maxAgeSeconds = 60 * 60 * 24 * 30; // 30 jours
  res.setHeader('Set-Cookie', `aia_auth=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`);
  res.status(200).json({ ok: true });
};
