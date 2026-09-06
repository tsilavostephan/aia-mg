// Vérifie l'email/mot de passe soumis depuis login.html et, si corrects, pose le cookie de session
// ("aia_auth") que middleware.js contrôle ensuite sur toutes les autres pages/API. Remplace l'ancien
// api/auth.js (code d'accès unique partagé, sans notion de compte) — voir lib/auth.js pour le format
// du jeton de session et lib/users.js pour la vérification du mot de passe.
const { setCorsHeaders } = require('./_scrapeLib');
const { checkLockout, recordFailure, resetFailures, getClientIp } = require('./_rateLimit');
const { findUserByEmail, verifyPasswordHash } = require('../lib/users');
const { setSessionCookie } = require('../lib/auth');

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

  const { email, password } = req.body || {};
  const user = email ? await findUserByEmail(email).catch(() => null) : null;
  const valid = user && verifyPasswordHash(password || '', user.password_hash);

  if (!valid) {
    try { await recordFailure(ip); } catch (e) { /* dégradé : voir _rateLimit.js */ }
    res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    return;
  }

  try { await resetFailures(ip); } catch (e) { /* dégradé : voir _rateLimit.js */ }

  setSessionCookie(res, { uid: user.id, role: user.role });

  if (user.role === 'pending') {
    // Cookie posé quand même : middleware.js doit pouvoir identifier ce compte comme "pending" et
    // rediriger vers /pending.html plutôt que d'afficher un simple message ici sans jamais
    // permettre de revenir sur cette page une fois connecté.
    res.status(200).json({ ok: true, role: 'pending', message: 'Compte en attente de validation par un administrateur.' });
    return;
  }

  res.status(200).json({ ok: true, role: user.role });
};
