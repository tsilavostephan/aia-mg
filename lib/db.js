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
// renseigné).
//
// Traité en au plus 3 allers-retours SQL pour tout le lot (1 lecture des candidats existants + 1
// INSERT groupé + 1 UPDATE groupé), plutôt qu'un SELECT et un INSERT/UPDATE par ligne : la première
// version (1-2 requêtes par ligne) provoquait un timeout (HTTP 504) sur un lot de 500 lignes, la
// latence réseau vers Neon par requête individuelle s'additionnant largement au-delà du budget de
// la fonction serverless.
async function importBatch(rows) {
  const keyOf = (numCommande, commandeAmazon) => numCommande.toLowerCase() + '||' + commandeAmazon.toLowerCase();

  let skipped = 0;
  const valid = [];
  for (const rec of rows) {
    const numCommande = cleanField(rec.numCommande);
    const commandeAmazon = cleanField(rec.commandeAmazon);
    if (!numCommande || !commandeAmazon) { skipped++; continue; }
    valid.push({
      numCommande, commandeAmazon,
      qteCommande: cleanField(rec.qteCommande),
      numSuivi: cleanField(rec.numSuivi),
      qteExpedie: cleanField(rec.qteExpedie),
      nom: cleanField(rec.nom),
      transporteur: cleanField(rec.transporteur),
    });
  }
  if (!valid.length) return { inserted: 0, updated: 0, skipped };

  const seenKeys = new Set();
  const uniqueNumCommande = [];
  const uniqueCommandeAmazon = [];
  for (const rec of valid) {
    const k = keyOf(rec.numCommande, rec.commandeAmazon);
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      uniqueNumCommande.push(rec.numCommande.toLowerCase());
      uniqueCommandeAmazon.push(rec.commandeAmazon.toLowerCase());
    }
  }

  const { rows: existing } = await sql`
    SELECT id, num_commande, commande_amazon, num_suivi, num_dernier_km
    FROM colis
    WHERE (lower(num_commande), lower(commande_amazon)) IN (
      SELECT * FROM unnest(${uniqueNumCommande}::text[], ${uniqueCommandeAmazon}::text[])
    )
  `;

  const candidatesByKey = new Map();
  existing.forEach(row => {
    const k = keyOf(row.num_commande, row.commande_amazon);
    if (!candidatesByKey.has(k)) candidatesByKey.set(k, []);
    candidatesByKey.get(k).push({ id: row.id, numSuivi: row.num_suivi, numDernierKm: row.num_dernier_km });
  });

  const updates = [];
  const inserts = [];
  let inserted = 0, updated = 0;

  for (const rec of valid) {
    const k = keyOf(rec.numCommande, rec.commandeAmazon);
    const candidates = candidatesByKey.get(k) || [];
    const incoming = rec.numSuivi.toLowerCase();

    let match = null;
    if (candidates.length) {
      if (!incoming) match = candidates[0];
      else match = candidates.find(c =>
        cleanField(c.numSuivi).toLowerCase() === incoming ||
        (cleanField(c.numDernierKm) && cleanField(c.numDernierKm).toLowerCase() === incoming)
      ) || null;
    }

    if (match && match.id === null) {
      // Correspond à une ligne pas encore écrite, insérée plus tôt dans ce même lot (ex. deux
      // lignes identiques dans le CSV importé) : on fusionne dans cet insert en attente au lieu
      // d'un UPDATE (qui n'aurait pas encore d'id réel à cibler), mais ça compte bien comme une
      // mise à jour pour le rapport (comme dans l'ancien comportement en mémoire).
      Object.assign(inserts[match.pendingInsertIndex], rec);
      updated++;
    } else if (match) {
      updates.push({ id: match.id, ...rec });
      updated++;
    } else {
      inserts.push({ ...rec });
      inserted++;
      candidatesByKey.set(k, [...candidates, { id: null, numSuivi: rec.numSuivi, numDernierKm: '', pendingInsertIndex: inserts.length - 1 }]);
    }
  }

  const client = await db.connect();
  try {
    await client.sql`BEGIN`;

    if (inserts.length) {
      await client.sql`
        INSERT INTO colis (num_commande, commande_amazon, qte_commande, num_suivi, qte_expediee, nom, transporteur, num_dernier_km)
        SELECT *, '' FROM unnest(
          ${inserts.map(r => r.numCommande)}::text[],
          ${inserts.map(r => r.commandeAmazon)}::text[],
          ${inserts.map(r => r.qteCommande)}::text[],
          ${inserts.map(r => r.numSuivi)}::text[],
          ${inserts.map(r => r.qteExpedie)}::text[],
          ${inserts.map(r => r.nom)}::text[],
          ${inserts.map(r => r.transporteur)}::text[]
        )
      `;
    }

    if (updates.length) {
      await client.sql`
        UPDATE colis SET
          qte_commande = u.qte_commande,
          num_suivi = u.num_suivi,
          qte_expediee = u.qte_expediee,
          nom = u.nom,
          transporteur = u.transporteur,
          updated_at = now()
        FROM (
          SELECT * FROM unnest(
            ${updates.map(r => r.id)}::bigint[],
            ${updates.map(r => r.qteCommande)}::text[],
            ${updates.map(r => r.numSuivi)}::text[],
            ${updates.map(r => r.qteExpedie)}::text[],
            ${updates.map(r => r.nom)}::text[],
            ${updates.map(r => r.transporteur)}::text[]
          ) AS t(id, qte_commande, num_suivi, qte_expediee, nom, transporteur)
        ) AS u
        WHERE colis.id = u.id
      `;
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

// Même règle que côté client (voir isValidNumDernierKm dans assets/script.js) : uniquement
// alphanumérique, au moins un chiffre. Pas de contrainte sur le nombre de lettres — des formats
// réels à une seule lettre existent (ex. "S7650086988394310" chez 4PX). Appliquée aussi ici pour ne
// pas dépendre uniquement de la validation client (un autre appelant de cette même route pourrait
// l'omettre).
function isValidNumDernierKm(v) {
  const s = cleanField(v);
  if (!s) return false;
  if (!/^[A-Za-z0-9]+$/.test(s)) return false;
  return /\d/.test(s);
}

// results: [{numSuivi, numDernierKm}] — ne touche que les lignes non résolues (protection
// numDernierKm assurée par la clause WHERE elle-même, pas besoin de relire avant d'écrire).
async function applyScrapeResults(results) {
  const numSuivis = [];
  const numDerniersKm = [];
  for (const r of results) {
    const ns = cleanField(r.numSuivi);
    const km = cleanField(r.numDernierKm);
    if (!ns || !isValidNumDernierKm(km)) continue;
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

// Mots parasites courants (français/anglais) parfois copiés par erreur depuis une page de suivi à
// la place d'un vrai numéro dernier kilométrique (ex. "inconnu", "unknown", "en attente"...). Pas un
// dictionnaire complet (impraticable à embarquer ici) — une liste ciblée en complément de la règle
// alphanumérique/chiffres/lettres ci-dessous, qui élimine déjà la quasi-totalité des vrais mots (un
// mot du dictionnaire ne contient normalement aucun chiffre).
const NUM_DERNIER_KM_BLOCKLIST = [
  'inconnu', 'inconnue', 'aucun', 'aucune', 'vide', 'null', 'none', 'undefined', 'nil', 'na', 'n a',
  'unknown', 'empty', 'error', 'erreur', 'test', 'pending', 'processing', 'waiting', 'attente',
  'enattente', 'encours', 'termine', 'terminee', 'annule', 'annulee', 'cancelled', 'canceled',
];

// Retire (met à vide) tout numéro dernier kilométrique déjà en base qui échouerait la même règle
// qu'à l'écriture (isValidNumDernierKm : alphanumérique + au moins un chiffre), ou qui
// correspondrait à un mot parasite connu. Une version précédente exigeait en plus au moins 2
// chiffres ET 2 lettres — trop strict, ça vidait à tort des valeurs réelles à une seule lettre (ex.
// "S7650086988394310" chez 4PX). Ne supprime pas les lignes elles-mêmes, seulement la valeur
// invalide de ce champ.
async function cleanInvalidKm() {
  const { rows } = await sql`
    UPDATE colis SET num_dernier_km = '', updated_at = now()
    WHERE num_dernier_km IS NOT NULL AND num_dernier_km <> ''
      AND (
        num_dernier_km !~ '^[A-Za-z0-9]+$'
        OR num_dernier_km !~ '[0-9]'
        OR lower(num_dernier_km) = ANY(${NUM_DERNIER_KM_BLOCKLIST}::text[])
      )
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
  cleanInvalidKm,
  clearAll,
  exportCsvRows,
};
