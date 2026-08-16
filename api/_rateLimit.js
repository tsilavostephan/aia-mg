// Limite les tentatives de connexion (api/auth.js) par adresse IP, avec verrouillage progressif :
// 5 échecs -> 30s, 10 échecs -> 5 min, 20 échecs -> 30 min. Sans ça, l'endpoint accepte un nombre
// illimité d'essais par seconde (confirmé par un test réel : 30 tentatives consécutives, toutes
// traitées sans ralentissement).
//
// Utilise Vercel KV / Upstash Redis (variables KV_REST_API_URL + KV_REST_API_TOKEN, ajoutées
// automatiquement en connectant une base KV depuis l'onglet "Storage" du projet sur vercel.com)
// pour que le compteur soit partagé entre toutes les instances/régions de la fonction serverless.
// Sans ces variables, retombe sur un compteur en mémoire par instance (protège quand même contre
// un brute-force naïf mono-instance, mais se réinitialise à froid et n'est pas partagé entre
// régions) — voir le même compromis déjà utilisé pour cachedBrowser dans _scrapeLib.js.
const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const memoryStore = new Map(); // repli local : ip -> { count, lockedUntil }

async function redisCommand(...args) {
  const path = args.map((a) => encodeURIComponent(String(a))).join('/');
  const response = await fetch(`${REST_URL}/${path}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Commande KV échouée (HTTP ${response.status})`);
  const data = await response.json();
  return data.result;
}

function lockoutSecondsFor(failCount) {
  if (failCount >= 20) return 30 * 60;
  if (failCount >= 10) return 5 * 60;
  if (failCount >= 5) return 30;
  return 0;
}

// { locked: true, retryAfterSeconds } si l'IP est actuellement verrouillée, sinon { locked: false }.
async function checkLockout(ip) {
  if (REST_URL && REST_TOKEN) {
    const lockedUntil = await redisCommand('GET', `auth_lock:${ip}`);
    if (lockedUntil) {
      const remaining = Math.ceil((Number(lockedUntil) - Date.now()) / 1000);
      if (remaining > 0) return { locked: true, retryAfterSeconds: remaining };
    }
    return { locked: false };
  }

  const entry = memoryStore.get(ip);
  if (entry && entry.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false };
}

// Enregistre un échec de connexion et pose un verrou progressif si le seuil correspondant est atteint.
async function recordFailure(ip) {
  if (REST_URL && REST_TOKEN) {
    const count = await redisCommand('INCR', `auth_fail:${ip}`);
    await redisCommand('EXPIRE', `auth_fail:${ip}`, 60 * 60); // le compteur s'oublie après 1h sans échec
    const lockSeconds = lockoutSecondsFor(count);
    if (lockSeconds > 0) {
      await redisCommand('SET', `auth_lock:${ip}`, String(Date.now() + lockSeconds * 1000), 'EX', lockSeconds);
    }
    return;
  }

  const entry = memoryStore.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count++;
  const lockSeconds = lockoutSecondsFor(entry.count);
  if (lockSeconds > 0) entry.lockedUntil = Date.now() + lockSeconds * 1000;
  memoryStore.set(ip, entry);
}

// Réinitialise le compteur d'échecs après une connexion réussie.
async function resetFailures(ip) {
  if (REST_URL && REST_TOKEN) {
    await redisCommand('DEL', `auth_fail:${ip}`);
    await redisCommand('DEL', `auth_lock:${ip}`);
    return;
  }
  memoryStore.delete(ip);
}

// x-forwarded-for peut contenir plusieurs IP séparées par des virgules (client, proxys) — la
// première est celle du client d'origine, telle que transmise par le edge network de Vercel.
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { checkLockout, recordFailure, resetFailures, getClientIp };
