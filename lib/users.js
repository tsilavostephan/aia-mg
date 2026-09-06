// Comptes utilisateurs (table `users`, voir scripts/schema.sql) — remplace le code d'accès unique
// partagé par de vrais comptes avec rôle (pending/mobile/pc/admin). Identifiant de connexion =
// trigramme (3 lettres, ex. initiales), normalisé en majuscules pour le stockage/la comparaison.
const crypto = require('node:crypto');
const { sql } = require('@vercel/postgres');

const SCRYPT_KEYLEN = 64;

// password_hash stocké sous la forme "sel_hex:hash_hex" — scrypt (node:crypto), aucune dépendance
// externe nécessaire. Sel aléatoire par utilisateur (16 octets).
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `${salt}:${derived.toString('hex')}`;
}

function verifyPasswordHash(password, storedHash) {
  const [salt, hashHex] = String(storedHash || '').split(':');
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function rowFromDb(r) {
  return {
    id: Number(r.id),
    username: r.username,
    role: r.role,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
  };
}

async function findUserByUsername(username) {
  const cleaned = String(username || '').trim().toUpperCase();
  if (!cleaned) return null;
  const { rows } = await sql`SELECT * FROM users WHERE upper(username) = ${cleaned} LIMIT 1`;
  return rows[0] || null; // password_hash inclus, nécessaire pour verifyPasswordHash côté appelant
}

async function findUserById(id) {
  const { rows } = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

// role optionnel : utilisé uniquement pour l'amorçage du premier admin
// (APP_BOOTSTRAP_ADMIN_TRIGRAM), sinon 'pending' par défaut (colonne DEFAULT).
async function createUser(username, password, role) {
  const cleaned = String(username || '').trim().toUpperCase();
  const passwordHash = hashPassword(password);
  const { rows } = role
    ? await sql`INSERT INTO users (username, password_hash, role, approved_at) VALUES (${cleaned}, ${passwordHash}, ${role}, now()) RETURNING *`
    : await sql`INSERT INTO users (username, password_hash) VALUES (${cleaned}, ${passwordHash}) RETURNING *`;
  return rows[0];
}

async function listUsers() {
  const { rows } = await sql`SELECT id, username, role, created_at, approved_at FROM users ORDER BY created_at DESC`;
  return rows.map(rowFromDb);
}

// Utilisé par la page de connexion (non authentifiée, voir api/usernames.js) pour proposer un
// menu déroulant de trigrammes existants plutôt qu'un champ texte libre — volontairement rien
// d'autre que le trigramme (ni rôle, ni date, ni a fortiori le hash de mot de passe).
async function listUsernames() {
  const { rows } = await sql`SELECT username FROM users ORDER BY username ASC`;
  return rows.map(r => r.username);
}

async function setUserRole(id, role) {
  // approved_at reflète la dernière fois qu'un rôle actif a été attribué (NULL tant que 'pending').
  const { rows } = await sql`
    UPDATE users SET role = ${role}, approved_at = CASE WHEN ${role} = 'pending' THEN NULL ELSE now() END
    WHERE id = ${id}
    RETURNING id, username, role, created_at, approved_at
  `;
  return rows[0] ? rowFromDb(rows[0]) : null;
}

async function setUserPassword(id, password) {
  const passwordHash = hashPassword(password);
  const { rows } = await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

module.exports = {
  hashPassword,
  verifyPasswordHash,
  findUserByUsername,
  findUserById,
  createUser,
  listUsers,
  listUsernames,
  setUserRole,
  setUserPassword,
};
