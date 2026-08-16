// Vérifie le code d'accès soumis depuis login.html et, s'il est correct, pose le cookie "aia_auth"
// que middleware.js contrôle ensuite sur toutes les autres pages/API.
//
// Nécessite les variables d'environnement Vercel :
// - APP_ACCESS_CODE : le code que l'utilisateur doit saisir.
// - APP_AUTH_SECRET : secret utilisé pour signer le cookie (optionnel, retombe sur APP_ACCESS_CODE
//   si absent — mais il est recommandé d'utiliser un secret distinct, plus long).
const crypto = require('node:crypto');
const { setCorsHeaders } = require('./_scrapeLib');
const { checkLockout, recordFailure, resetFailures, getClientIp } = require('./_rateLimit');

// Compare deux chaînes en temps constant (en passant par leur empreinte SHA-256, pour éviter à la
// fois la fuite de longueur et l'exigence de crypto.timingSafeEqual que les deux buffers comparés
// aient la même taille) : `a !== b` classique s'arrête au premier caractère différent, ce qui
// permet en théorie de deviner un code caractère par caractère par mesure de temps de réponse.
function timingSafeStringEqual(a, b) {
  const digestA = crypto.createHash('sha256').update(String(a)).digest();
  const digestB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

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

  const ip = getClientIp(req);

  // La limitation de tentatives ne doit jamais empêcher une vraie connexion si le service qui la
  // sous-tend (KV) est temporairement indisponible — en cas d'erreur, on se comporte comme si
  // l'IP n'était pas verrouillée plutôt que de bloquer l'accès légitime.
  let lockout = { locked: false };
  try {
    lockout = await checkLockout(ip);
  } catch (e) { /* dégradé : voir commentaire ci-dessus */ }

  if (lockout.locked) {
    res.setHeader('Retry-After', String(lockout.retryAfterSeconds));
    res.status(429).json({ error: `Trop de tentatives échouées. Réessayez dans ${lockout.retryAfterSeconds} seconde(s).` });
    return;
  }

  const { code } = req.body || {};
  if (!timingSafeStringEqual(code || '', expectedCode)) {
    try { await recordFailure(ip); } catch (e) { /* dégradé : voir _rateLimit.js */ }
    res.status(401).json({ error: 'Code incorrect.' });
    return;
  }

  try { await resetFailures(ip); } catch (e) { /* dégradé : voir _rateLimit.js */ }

  const secret = process.env.APP_AUTH_SECRET || expectedCode;
  const token = crypto.createHmac('sha256', secret).update('authenticated').digest('hex');

  const maxAgeSeconds = 60 * 60 * 24 * 30; // 30 jours
  res.setHeader('Set-Cookie', `aia_auth=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`);
  res.status(200).json({ ok: true });
};
