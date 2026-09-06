// Crée un nouveau compte (rôle "pending" par défaut — aucun accès à l'appli tant qu'un admin ne lui
// attribue pas explicitement un rôle, voir api/users.js). Exception : si l'email correspond à
// APP_BOOTSTRAP_ADMIN_EMAIL (variable d'environnement), le compte est créé directement en rôle
// "admin" et connecté immédiatement — sans ça, personne ne pourrait jamais approuver le tout
// premier compte.
const { setCorsHeaders } = require('./_scrapeLib');
const { checkLockout, recordFailure, resetFailures, getClientIp } = require('./_rateLimit');
const { findUserByEmail, createUser } = require('../lib/users');
const { setSessionCookie } = require('../lib/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  let lockout = { locked: false };
  try {
    lockout = await checkLockout(ip);
  } catch (e) { /* dégradé, voir api/login.js pour le même compromis */ }
  if (lockout.locked) {
    res.setHeader('Retry-After', String(lockout.retryAfterSeconds));
    res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${lockout.retryAfterSeconds} seconde(s).` });
    return;
  }

  const { email, password } = req.body || {};
  const cleanedEmail = String(email || '').trim();

  if (!EMAIL_RE.test(cleanedEmail)) {
    res.status(400).json({ error: 'Adresse email invalide.' });
    return;
  }
  if (!password || String(password).length < 8) {
    res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    return;
  }

  const existing = await findUserByEmail(cleanedEmail).catch(() => null);
  if (existing) {
    try { await recordFailure(ip); } catch (e) { /* évite l'énumération de comptes par force brute */ }
    res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    return;
  }

  const bootstrapEmail = (process.env.APP_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const isBootstrapAdmin = bootstrapEmail && cleanedEmail.toLowerCase() === bootstrapEmail;

  let user;
  try {
    user = await createUser(cleanedEmail, password, isBootstrapAdmin ? 'admin' : undefined);
  } catch (e) {
    res.status(500).json({ error: "Échec de la création du compte." });
    return;
  }

  try { await resetFailures(ip); } catch (e) { /* dégradé */ }

  if (isBootstrapAdmin) {
    setSessionCookie(res, { uid: user.id, role: 'admin' });
    res.status(200).json({ ok: true, role: 'admin' });
    return;
  }

  res.status(200).json({ ok: true, role: 'pending', message: 'Compte créé — en attente de validation par un administrateur.' });
};
