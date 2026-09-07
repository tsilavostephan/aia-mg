// Configuration transporteur partagée entre tous les comptes admin (table `app_config`, voir
// scripts/schema.sql) — remplace le localStorage par navigateur pour : algorithmes de recherche,
// association manuelle transporteur -> valeur brute, case "inclure les colis non résolus des
// autres transporteurs", délais de scraping partagés (4PX/YANWEN/...).
const { sql } = require('@vercel/postgres');

const KEYS = ['search-algos', 'carrier-mapping', 'carrier-include-unresolved', 'scrape-config', 'dashboard-excluded-carriers'];

async function getAllConfig() {
  const { rows } = await sql`SELECT key, value FROM app_config WHERE key = ANY(${KEYS}::text[])`;
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}

async function setConfig(key, value) {
  await sql`
    INSERT INTO app_config (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

module.exports = { KEYS, getAllConfig, setConfig };
