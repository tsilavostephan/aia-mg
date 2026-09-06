// Jeton de session par utilisateur (remplace l'ancien cookie "aia_auth" statique/global qui ne
// portait aucune information — juste la preuve qu'UN code d'accès partagé avait été saisi une
// fois). Format "JWT maison" minimal, signé HMAC-SHA256 :
//
//   base64url(JSON.stringify({ uid, role, exp })) + "." + base64url(HMAC_SHA256(secret, payload))
//
// Deux implémentations existent volontairement (même schéma que l'ancien couple
// middleware.js/api/auth.js) : celle-ci (Node, `node:crypto`) pour les fonctions serverless
// classiques (api/*.js), et une seconde en Web Crypto (`crypto.subtle`) dans middleware.js, qui
// tourne en Edge Runtime et n'a pas accès à `node:crypto`. Les deux doivent rester en accord sur le
// format exact du jeton — voir le commentaire équivalent dans middleware.js.
const crypto = require('node:crypto');

const COOKIE_NAME = 'aia_auth';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 jours

function getSessionSecret() {
  return process.env.APP_AUTH_SECRET || process.env.APP_ACCESS_CODE;
}

function sign(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function createSessionToken({ uid, role }) {
  const secret = getSessionSecret();
  if (!secret) throw new Error('APP_AUTH_SECRET/APP_ACCESS_CODE manquant(e) sur le serveur.');
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  // @vercel/postgres renvoie les colonnes BIGSERIAL/BIGINT sous forme de chaîne (id d'utilisateur
  // inclus) — toujours normaliser en number ici, sinon le payload embarque "uid":"4" (chaîne) et
  // verifySessionToken (qui exige typeof uid === 'number') rejette silencieusement un jeton pourtant
  // valide.
  const payloadB64 = Buffer.from(JSON.stringify({ uid: Number(uid), role, exp }), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

function verifySessionToken(token) {
  const secret = getSessionSecret();
  if (!secret || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = sign(payloadB64, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.uid !== 'number' || typeof payload.role !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// { uid, role } de la session en cours, ou null si absente/invalide/expirée — à utiliser dans
// chaque route qui doit restreindre une action par rôle (voir api/db.js, api/scrape.js, api/users.js).
function getSession(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, { uid, role }) {
  const token = createSessionToken({ uid, role });
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

module.exports = {
  COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
  getSession,
  setSessionCookie,
  clearSessionCookie,
};
