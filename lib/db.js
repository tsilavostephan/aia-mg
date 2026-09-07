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

// Termes séparés par des virgules = groupes combinés en OU ; à l'intérieur d'un groupe, des
// termes séparés par "+" doivent TOUS correspondre (ET), ex. "Colissimo + RASOA" ne renvoie que
// les colis dont le texte de recherche contient à la fois "colissimo" et "rasoa", alors que
// "4PX, YANWEN" renvoie ceux qui contiennent l'un ou l'autre (comportement inchangé). Un groupe
// est traduit en `search_text ILIKE ALL(termes_du_groupe)`, les groupes assemblés par OR — la
// tagged template `sql` ne permettant pas de construire un nombre variable de clauses, on passe
// par `sql.query(text, params)` (méthode brute exposée par @vercel/postgres, équivalente à
// pg.Pool#query) pour ce cas précis.
// Colonnes utiles au client (voir rowFromDb) — évite de transférer search_text (généré, le plus
// gros champ de la ligne) et les autres colonnes internes pour rien sur chaque page de résultats.
const SEARCH_SELECT_COLS = 'num_commande, commande_amazon, qte_commande, num_suivi, qte_expediee, nom, transporteur, num_dernier_km';

async function search(q, limit, offset) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 500);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const groups = String(q || '')
    .split(',')
    .map(group => group.split('+').map(t => t.trim().toLowerCase()).filter(Boolean))
    .filter(group => group.length > 0);

  if (!groups.length) {
    // Pas de count(*) OVER() ici : sur une liste sans filtre, ce calcul obligerait Postgres à
    // matérialiser et trier TOUTE la table avant de garder les 25/50/100 lignes demandées (vérifié
    // via EXPLAIN ANALYZE : ~230ms et un tri sur disque à 245k lignes) plutôt que de se contenter
    // d'un simple parcours d'index sur id (limit/offset direct, <1ms). Le compte total est calculé
    // à part, en parallèle — plus lent isolément (~50ms, un décompte exact reste un parcours), mais
    // le total des deux reste bien plus rapide que l'ancienne requête unique.
    const [{ rows }, { rows: countRows }] = await Promise.all([
      sql.query(`SELECT ${SEARCH_SELECT_COLS} FROM colis ORDER BY id DESC LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]),
      sql`SELECT count(*)::int AS total FROM colis`,
    ]);
    return { rows: rows.map(rowFromDb), total: countRows[0].total };
  }

  // ILIKE ALL($1::text[]) (l'ancienne forme) n'est pas reconnu par le planificateur comme
  // accélérable par l'index GIN trigram (idx_colis_search_trgm) — vérifié via EXPLAIN ANALYZE : la
  // requête tombait systématiquement en Parallel Seq Scan sur toute la table. Un ILIKE direct par
  // terme, chaînés en AND (un groupe "+") et OR entre groupes ("," / virgule), est en revanche bien
  // reconnu et utilise un Bitmap Index Scan sur l'index trigram — mesuré ~150ms -> ~110ms sur cette
  // base, et l'écart se creuse largement à mesure que la table grossit (l'index scale, pas le scan).
  //
  // Chaque terme matche aussi si sa forme sans accents correspond au Nom sans accents (ex.
  // "stephanie" trouve "Stéphanie") — volontairement limité à cette seule colonne (voir
  // idx_colis_nom_unaccent_trgm/immutable_unaccent, scripts/schema.sql), le reste de la recherche
  // (transporteur, numéro de suivi...) reste sensible aux accents comme avant.
  const params = [];
  const clauses = groups.map(terms => {
    const termClauses = terms.map(t => {
      params.push(`%${t}%`);
      const p = params.length;
      return `(search_text ILIKE $${p} OR immutable_unaccent(lower(coalesce(nom, ''))) ILIKE immutable_unaccent($${p}))`;
    });
    return `(${termClauses.join(' AND ')})`;
  });
  const whereSql = clauses.join(' OR ');

  const rowParams = [...params, safeLimit, safeOffset];
  const limitIdx = rowParams.length - 1;
  const offsetIdx = rowParams.length;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    sql.query(
      `SELECT ${SEARCH_SELECT_COLS} FROM colis WHERE ${whereSql} ORDER BY id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      rowParams
    ),
    sql.query(`SELECT count(*)::int AS total FROM colis WHERE ${whereSql}`, params),
  ]);

  return { rows: rows.map(rowFromDb), total: countRows[0].total };
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
    SELECT id, num_commande, commande_amazon, num_suivi, num_dernier_km, nom
    FROM colis
    WHERE (lower(num_commande), lower(commande_amazon)) IN (
      SELECT * FROM unnest(${uniqueNumCommande}::text[], ${uniqueCommandeAmazon}::text[])
    )
  `;

  const candidatesByKey = new Map();
  existing.forEach(row => {
    const k = keyOf(row.num_commande, row.commande_amazon);
    if (!candidatesByKey.has(k)) candidatesByKey.set(k, []);
    candidatesByKey.get(k).push({ id: row.id, numSuivi: row.num_suivi, numDernierKm: row.num_dernier_km, nom: row.nom });
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
      const pending = inserts[match.pendingInsertIndex];
      Object.assign(pending, rec, { nom: rec.nom || pending.nom });
      updated++;
    } else if (match) {
      // Le Nom se met à jour avec la nouvelle valeur du CSV, mais n'est jamais effacé par une
      // extraction vide lors d'un ré-import (même protection que Num dernier km, qui n'est jamais
      // ré-écrasé par cette voie — voir plus haut).
      updates.push({ id: match.id, ...rec, nom: rec.nom || match.nom || '' });
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
//
// Pagination par curseur (id > afterId), PAS par OFFSET : sur une grosse base (ex. 229 776 colis),
// OFFSET oblige Postgres à parcourir et ignorer toutes les lignes précédentes à chaque page — de
// plus en plus lent à mesure qu'on avance, jusqu'à dépasser les 60s d'une fonction Vercel sur les
// dernières pages (FUNCTION_INVOCATION_TIMEOUT constaté en prod). Le curseur reste en O(limite) quel
// que soit la profondeur, puisqu'il s'appuie directement sur l'index (id).
async function unresolvedRows(limit, afterId) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 20000);
  const safeAfterId = Math.max(parseInt(afterId, 10) || 0, 0);
  const { rows } = await sql`
    SELECT id, num_suivi, transporteur FROM colis
    WHERE (num_dernier_km IS NULL OR num_dernier_km = '')
      AND num_suivi IS NOT NULL AND num_suivi <> ''
      AND id > ${safeAfterId}
    ORDER BY id ASC
    LIMIT ${safeLimit}
  `;
  return rows.map(r => ({ id: r.id, numSuivi: r.num_suivi, transporteur: r.transporteur || '' }));
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

  // La clause WHERE ne retient que des colis encore non résolus : chaque ligne touchée ici passe
  // donc pour la 1ère fois de non-résolu à résolu, resolved_at peut être posé sans condition
  // supplémentaire (alimente le tableau de bord de taux de résolution, voir 'resolution-stats').
  const { rows } = await sql`
    UPDATE colis SET num_dernier_km = u.km, updated_at = now(), resolved_at = now()
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
    UPDATE colis SET num_dernier_km = '', updated_at = now(), resolved_at = NULL
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

// Tableau de bord : volumes ajoutés/résolus par transporteur (valeur brute de la colonne, pas le
// regroupement CARRIERS/mapping manuel côté client), toutes périodes confondues — même logique que
// getStats() (num_dernier_km non vide = résolu), juste répartie par transporteur en plus du total.
// Les transporteurs avec moins de 100 colis sont exclus du détail (trop de valeurs anecdotiques
// sinon, souvent des variantes d'orthographe isolées). `excludedCarriers` (voir clé de config
// partagée 'dashboard-excluded-carriers', lib/config.js) est un filtre PUREMENT VISUEL : la ligne du
// transporteur disparaît du détail, mais `overall` (le Total/taux global) reste calculé sur TOUS les
// colis, exclusion ou pas — décision explicite de l'utilisateur (exclure un transporteur ne doit
// changer aucun calcul, juste masquer sa ligne).
async function resolutionStats(excludedCarriers = []) {
  const [{ rows: entries }, overall] = await Promise.all([
    // Regroupe par l'étiquette affichée (coalesce), pas par la colonne brute : NULL et '' brut
    // fusionnent alors correctement dans une seule ligne "(sans transporteur)" au lieu de deux
    // lignes distinctes portant la même étiquette. Le filtre d'exclusion (HAVING, comparé sur
    // cette même étiquette) doit aussi porter sur l'expression coalescée : un exclu comparé à la
    // colonne brute ne matcherait jamais "(sans transporteur)" (NULL/'' n'égalent jamais cette
    // chaîne littérale) — constaté via le script de smoke-test avant ce correctif.
    sql`
      SELECT coalesce(nullif(transporteur, ''), '(sans transporteur)') AS transporteur,
             count(*)::int AS total,
             count(*) FILTER (WHERE num_dernier_km IS NOT NULL AND num_dernier_km <> '')::int AS resolved
      FROM colis
      GROUP BY coalesce(nullif(transporteur, ''), '(sans transporteur)')
      HAVING count(*) >= 100
         AND NOT (coalesce(nullif(transporteur, ''), '(sans transporteur)') = ANY(${excludedCarriers}::text[]))
      ORDER BY total DESC
    `,
    getStats(),
  ]);
  return { entries, overall };
}

// Compteur par utilisateur (voir scripts/schema.sql, table user_search_stats) : n'est incrémenté
// que par les recherches qui aboutissent à exactement un colis via un scan ou un collage (voir les
// points d'appel côté client, assets/script.js et assets/scan.js) — pas par le filtrage au clavier,
// qui déclencherait un appel par frappe et ne refléterait pas un usage réel.
async function recordSearchStat(userId, found) {
  await sql`
    INSERT INTO user_search_stats (user_id, total_searches, found_km)
    VALUES (${userId}, 1, ${found ? 1 : 0})
    ON CONFLICT (user_id) DO UPDATE SET
      total_searches = user_search_stats.total_searches + 1,
      found_km = user_search_stats.found_km + ${found ? 1 : 0},
      updated_at = now()
  `;
}

async function getUserSearchStats() {
  const { rows } = await sql`
    SELECT u.username, s.total_searches, s.found_km
    FROM user_search_stats s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.found_km DESC
  `;
  return rows.map(r => ({ username: r.username, totalSearches: r.total_searches, foundKm: r.found_km }));
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
  exportCsvRows,
  resolutionStats,
  recordSearchStat,
  getUserSearchStats,
};
