// Exécute scripts/schema.sql une fois contre la base Postgres configurée (variables POSTGRES_URL*
// lues depuis l'environnement — utiliser `vercel env pull` avant de lancer ce script en local).
// Usage : node scripts/migrate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from '@vercel/postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// @vercel/postgres n'exécute qu'une seule instruction par appel ; on découpe naïvement sur les
// points-virgules en fin de ligne (suffisant ici, le schéma ne contient pas de point-virgule dans
// une chaîne ou un commentaire).
const statements = schema
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  console.log('Exécution :', statement.slice(0, 80).replace(/\s+/g, ' '), '...');
  await sql.query(statement);
}

console.log(`\n✅ Schéma appliqué (${statements.length} instructions).`);
