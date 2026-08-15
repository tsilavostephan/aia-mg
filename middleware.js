// Vercel Edge Middleware : protège l'ensemble du site (pages + API) derrière un code d'accès.
//
// Fonctionnement : /login.html, /api/auth (+ /api/logout) et les ressources publiques nécessaires
// à l'installation PWA (manifest.json + icônes + logo) restent accessibles sans être authentifié —
// tout le reste redirige vers /login.html si le cookie "aia_auth" n'est pas présent ou ne
// correspond pas au jeton attendu. Sans cette exemption, Chrome reçoit une redirection HTML au lieu
// du JSON/des images attendus lors de l'installation, ce qui casse l'icône et le manifeste PWA.
// Ce jeton est un HMAC-SHA256 signé avec APP_AUTH_SECRET (variable d'environnement Vercel) — il ne
// contient jamais le code d'accès lui-même, seulement la preuve qu'il a été saisi correctement une
// fois (voir api/auth.js pour la vérification du code et la pose du cookie).
export const config = {
  matcher: ['/((?!api/auth|api/logout|login\\.html|manifest\\.json|assets/(?:logo-aia|favicon|apple-touch-icon|icon-192|icon-512|icon-512-maskable)\\.png).*)'],
};

async function computeExpectedToken(secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('authenticated'));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function middleware(request) {
  const secret = process.env.APP_AUTH_SECRET || process.env.APP_ACCESS_CODE;
  if (!secret) {
    // Pas de code configuré côté serveur : on ne bloque pas l'accès (évite de verrouiller
    // définitivement l'app si la variable d'environnement n'a pas encore été renseignée).
    return;
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)aia_auth=([^;]*)/);
  const token = match ? decodeURIComponent(match[1]) : '';

  const expected = await computeExpectedToken(secret);
  if (token === expected) {
    return; // authentifié, on laisse passer
  }

  const url = new URL(request.url);
  url.pathname = '/login.html';
  return Response.redirect(url, 302);
}
