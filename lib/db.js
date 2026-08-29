// Accès Postgres (Vercel Postgres / Neon) pour la table `colis` — remplace l'ancien modèle où
// toute la base vivait dans un tableau JS côté navigateur, synchronisé en un seul fichier CSV
// chiffré sur Vercel Blob (api/backup.js, supprimé). Voir scripts/schema.sql pour le schéma.
const { sql, db } = require('@vercel/postgres');

const COLS = ['numCommande', 'commandeAmazon', 'qteCommande', 'numSuivi', 'qteExpedie', 'nom', 'transporteur', 'numDernierKm'];

function rowFromDb(r) {
  return {
    numCommande: r.num_commande || '',
    commandeAmazon: r.commande_amazon || '',
    qteCommande: r.qte_commande || '',
    numSuivi: r.num_suivi || '',
    qteExpedie: r.qte_expediee || '',
    nom: r.nom || '',
    transporteur: r.transporteur || '',
    numDernierKm: r.num_dernier_km || '',
  };
}

// Un numéro de suivi exact existe-t-il déjà en base ? Utilisé pour désambiguïser les algorithmes
// d'extraction de numéro scanné/collé (voir computeBestTracking côté client) — une seule ligne
// suffit, inutile de charger quoi que ce soit d'autre.
async function trackingNumberExists(numSuivi) {
  const cleaned = cleanField(numSuivi).toLowerCase();
  if (!cleaned) return false;
  const { rows } = await sql`SELECT 1 FROM colis WHERE lower(num_suivi) = ${cleaned} LIMIT 1`;
  return rows.length > 0;
}

async function getStats() {
  const { rows } = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE num_dernier_km IS NOT NULL AND num_dernier_km <> '')::int AS resolved
    FROM colis
  `;
  return { total: rows[0].total, resolved: rows[0].resolved };
}

// Termes séparés par des virgules, combinés en OR — reproduit la recherche précédente
// (Object.values(r).some(v => v.includes(t))) via le index trigram sur search_text.
async function search(q, limit, offset) {
  const terms = String(q || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 500);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const { rows } = terms.length
    ? await sql`
        SELECT *, count(*) OVER() AS total_count
        FROM colis
        WHERE search_text ILIKE ANY (${terms.map(t => `%${t}%`)})
        ORDER BY id DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `
    : await sql`
        SELECT *, count(*) OVER() AS total_count
        FROM colis
        ORDER BY id DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { rows: rows.map(rowFromDb), total };
}

function cleanField(v) {
  return String(v || '').trim();
}

// Reproduit buildOrderKey/findMatchingIndex : ignore les lignes sans numCommande/commandeAmazon,
// sinon cherche une ligne existante avec la même clé de commande ET (même numSuivi OU même
// numDernierKm) ; sinon insère une nouvelle ligne. Protège numDernierKm (jamais écrasé une fois
// renseigné). Traité en une seule transaction par lot.
async function importBatch(rows) {
  let inserted = 0, updated = 0, skipped = 0;

  // Un client dédié (pas le pool `sql`) : BEGIN/COMMIT doivent porter sur la même connexion
  // pendant tout le lot, sinon chaque appel pourrait être routé vers une connexion différente du
  // pool et la transaction n'aurait aucun effet réel.
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;

    for (const rec of rows) {
      const numCommande = cleanField(rec.numCommande);
      const commandeAmazon = cleanField(rec.commandeAmazon);
      if (!numCommande || !commandeAmazon) { skipped++; continue; }

      const incomingNumSuivi = cleanField(rec.numSuivi).toLowerCase();

      const { rows: candidates } = await client.sql`
        SELECT id, num_suivi, num_dernier_km FROM colis
        WHERE lower(num_commande) = lower(${numCommande}) AND lower(commande_amazon) = lower(${commandeAmazon})
      `;

      let matchId = null;
      if (candidates.length) {
        if (!incomingNumSuivi) {
          matchId = candidates[0].id;
        } else {
          const match = candidates.find(c =>
            cleanField(c.num_suivi).toLowerCase() === incomingNumSuivi ||
            (cleanField(c.num_dernier_km) && cleanField(c.num_dernier_km).toLowerCase() === incomingNumSuivi)
          );
          if (match) matchId = match.id;
        }
      }

      if (matchId) {
        await client.sql`
          UPDATE colis SET
            qte_commande = ${cleanField(rec.qteCommande)},
            num_suivi = ${cleanField(rec.numSuivi)},
            qte_expediee = ${cleanField(rec.qteExpedie)},
            nom = ${cleanField(rec.nom)},
            transporteur = ${cleanField(rec.transporteur)},
            updated_at = now()
          WHERE id = ${matchId}
        `;
        updated++;
      } else {
        await client.sql`
          INSERT INTO colis (num_commande, commande_amazon, qte_commande, num_suivi, qte_expediee, nom, transporteur, num_dernier_km)
          VALUES (${numCommande}, ${commandeAmazon}, ${cleanField(rec.qteCommande)}, ${cleanField(rec.numSuivi)},
                  ${cleanField(rec.qteExpedie)}, ${cleanField(rec.nom)}, ${cleanField(rec.transporteur)}, '')
        `;
        inserted++;
      }
    }

    await client.sql`COMMIT`;
  } catch (e) {
    await client.sql`ROLLBACK`;
    throw e;
  } finally {
    client.release();
  }

  return { inserted, updated, skipped };
}

// Toutes les lignes non résolues (numSuivi + transporteur seulement) — le client répartit ensuite
// lui-même chaque ligne vers son/ses transporteur(s) via resolveCarrierKeysForRow/rowBelongsToCarrierGroup
// (logique de correspondance/mapping manuel qui reste côté client, voir assets/script.js), exactement
// comme avant la migration mais sur ce sous-ensemble non résolu au lieu de toute la base.
async function unresolvedRows(limit, offset) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 20000);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const { rows } = await sql`
    SELECT num_suivi, transporteur FROM colis
    WHERE (num_dernier_km IS NULL OR num_dernier_km = '')
      AND num_suivi IS NOT NULL AND num_suivi <> ''
    ORDER BY id ASC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;
  return rows.map(r => ({ numSuivi: r.num_suivi, transporteur: r.transporteur || '' }));
}

// Valeurs de transporteur distinctes présentes en base (avec leur nombre de colis) — utilisé par la
// fenêtre d'association manuelle transporteur, qui doit voir TOUTE la base (pas seulement les colis
// non résolus).
async function distinctTransporteurs() {
  const { rows } = await sql`
    SELECT transporteur, count(*)::int AS count FROM colis
    WHERE transporteur IS NOT NULL AND trim(transporteur) <> ''
    GROUP BY transporteur
    ORDER BY transporteur ASC
  `;
  return rows.map(r => ({ transporteur: r.transporteur, count: r.count }));
}

async function clearAll() {
  await sql`TRUNCATE colis`;
}

// results: [{numSuivi, numDernierKm}] — ne touche que les lignes non résolues (protection
// numDernierKm assurée par la clause WHERE elle-même, pas besoin de relire avant d'écrire).
async function applyScrapeResults(results) {
  const numSuivis = [];
  const numDerniersKm = [];
  for (const r of results) {
    const ns = cleanField(r.numSuivi);
    const km = cleanField(r.numDernierKm);
    if (!ns || !km) continue;
    numSuivis.push(ns.toLowerCase());
    numDerniersKm.push(km);
  }
  if (!numSuivis.length) return { updated: 0 };

  const { rows } = await sql`
    UPDATE colis SET num_dernier_km = u.km, updated_at = now()
    FROM (SELECT * FROM unnest(${numSuivis}::text[], ${numDerniersKm}::text[]) AS t(ns, km)) AS u
    WHERE lower(colis.num_suivi) = u.ns AND (colis.num_dernier_km IS NULL OR colis.num_dernier_km = '')
    RETURNING colis.id
  `;
  return { updated: rows.length };
}

async function cleanInvalid() {
  const { rows } = await sql`
    DELETE FROM colis WHERE trim(num_commande) = '' OR trim(commande_amazon) = ''
    RETURNING id
  `;
  return { removed: rows.length };
}

// Génère le CSV complet par lots (jamais toute la table en mémoire d'un coup).
async function* exportCsvRows(batchSize = 5000) {
  yield COLS.join(',') + '\r\n';
  let offset = 0;
  for (;;) {
    const { rows } = await sql`
      SELECT * FROM colis ORDER BY id ASC LIMIT ${batchSize} OFFSET ${offset}
    `;
    if (!rows.length) break;
    for (const r of rows.map(rowFromDb)) {
      yield COLS.map(k => csvEscapeField(r[k])).join(',') + '\r\n';
    }
    offset += rows.length;
    if (rows.length < batchSize) break;
  }
}

function csvEscapeField(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = {
  COLS,
  trackingNumberExists,
  getStats,
  search,
  importBatch,
  unresolvedRows,
  distinctTransporteurs,
  applyScrapeResults,
  cleanInvalid,
  clearAll,
  exportCsvRows,
};
