// Vercel Edge Middleware : protège l'ensemble du site (pages + API) et route selon le rôle du
// compte connecté (pending/mobile/pc/admin) — remplace l'ancien modèle à code d'accès unique
// partagé (un seul token global, sans notion d'utilisateur ni de rôle).
//
// Le jeton de session ("aia_auth") est un JWT maison signé HMAC-SHA256 :
//   base64url(JSON.stringify({ uid, role, exp })) + "." + base64url(HMAC_SHA256(secret, payload))
// Voir lib/auth.js (implémentation Node, utilisée par les fonctions serverless) pour le détail du
// format — celle-ci est la contrepartie Web Crypto (`crypto.subtle`), seule API disponible en Edge
// Runtime. Les deux DOIVENT rester en accord sur le format exact du jeton.
export const config = {
  matcher: ['/((?!api/login|api/register|api/logout|api/usernames|login\\.html|register\\.html|pending\\.html|manifest(?:-scan)?\\.json|assets/(?:logo-aia|favicon|apple-touch-icon|icon-192|icon-512|icon-512-maskable)\\.png).*)'],
};

// Chemins accessibles au rôle "mobile" (voir plus bas) sans être redirigé vers /scan.html.
// La restriction fine (seule l'action "search" de /api/db est autorisée pour ce rôle) se fait
// côté serveur dans api/db.js, pas ici : le middleware ne lit pas le corps des requêtes.
const MOBILE_ALLOWED_PREFIXES = ['/scan.html', '/assets/', '/sw.js', '/api/db', '/api/logout'];

function base64UrlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function computeSignature(payloadB64, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return bytesToBase64Url(sig);
}

// Comparaison en temps constant (chaînes de même origine attendue — signatures base64url) : une
// égalité `===` classique s'arrête au premier caractère différent, ce qui fournit en théorie un
// canal de timing (Edge Runtime n'expose pas crypto.timingSafeEqual comme Node).
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySessionToken(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = await computeSignature(payloadB64, secret);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.role !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

let missingSecretWarned = false;

export default async function middleware(request) {
  const secret = process.env.APP_AUTH_SECRET || process.env.APP_ACCESS_CODE;
  if (!secret) {
    // Pas de secret configuré côté serveur : on ne bloque pas l'accès (évite de verrouiller
    // définitivement l'app si la variable d'environnement n'a pas encore été renseignée). ⚠️ Ça
    // veut aussi dire qu'une variable d'environnement mal configurée rend tout le site public sans
    // avertissement visible — on journalise donc au moins une fois par instance de fonction.
    if (!missingSecretWarned) {
      missingSecretWarned = true;
      console.warn('[middleware] APP_AUTH_SECRET/APP_ACCESS_CODE absent(e) : le site reste accessible sans authentification.');
    }
    return;
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)aia_auth=([^;]*)/);
  const token = match ? decodeURIComponent(match[1]) : '';

  const session = await verifySessionToken(token, secret);
  const url = new URL(request.url);

  if (!session) {
    url.pathname = '/login.html';
    return Response.redirect(url, 302);
  }

  if (session.role === 'pending') {
    if (url.pathname === '/pending.html') return;
    url.pathname = '/pending.html';
    return Response.redirect(url, 302);
  }

  if (session.role === 'mobile') {
    const allowed = MOBILE_ALLOWED_PREFIXES.some(p => url.pathname === p || url.pathname.startsWith(p));
    if (allowed) return;
    url.pathname = '/scan.html';
    return Response.redirect(url, 302);
  }

  // 'pc' et 'admin' : accès à l'application principale, restrictions fines par action côté serveur
  // (voir lib/auth.js + les vérifications de rôle dans api/db.js et api/scrape.js).
  return;
}
