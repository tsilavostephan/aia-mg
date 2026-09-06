// Crée un nouveau compte (rôle "pending" par défaut — aucun accès à l'appli tant qu'un admin ne lui
// attribue pas explicitement un rôle, voir api/users.js). Exception : si le trigramme correspond à
// APP_BOOTSTRAP_ADMIN_TRIGRAM (variable d'environnement), le compte est créé directement en rôle
// "admin" et connecté immédiatement — sans ça, personne ne pourrait jamais approuver le tout
// premier compte.
const { setCorsHeaders } = require('./_scrapeLib');
const { checkLockout, recordFailure, resetFailures, getClientIp } = require('./_rateLimit');
const { findUserByUsername, createUser } = require('../lib/users');
const { setSessionCookie } = require('../lib/auth');

// Trigramme = exactement 3 lettres (initiales) — pas de chiffres ni de caractères spéciaux.
const TRIGRAM_RE = /^[A-Za-z]{3}$/;

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

  const { username, password } = req.body || {};
  const cleanedUsername = String(username || '').trim();

  if (!TRIGRAM_RE.test(cleanedUsername)) {
    res.status(400).json({ error: 'Le trigramme doit contenir exactement 3 lettres.' });
    return;
  }
  if (!password || String(password).length < 8) {
    res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    return;
  }

  const existing = await findUserByUsername(cleanedUsername).catch(() => null);
  if (existing) {
    try { await recordFailure(ip); } catch (e) { /* évite l'énumération de comptes par force brute */ }
    res.status(409).json({ error: 'Un compte existe déjà avec ce trigramme.' });
    return;
  }

  const bootstrapTrigram = (process.env.APP_BOOTSTRAP_ADMIN_TRIGRAM || '').trim().toUpperCase();
  const isBootstrapAdmin = bootstrapTrigram && cleanedUsername.toUpperCase() === bootstrapTrigram;

  let user;
  try {
    user = await createUser(cleanedUsername, password, isBootstrapAdmin ? 'admin' : undefined);
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
