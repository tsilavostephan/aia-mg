// Point d'entrée unique pour toutes les opérations sur la base de colis (Vercel Postgres), routées
// par `action` — même approche que api/scrape.js (dispatch) et l'ancien api/backup.js, pour rester
// sous la limite de fonctions serverless du plan Hobby (voir commentaire dans api/scrape.js).
//
// L'authentification (cookie aia_auth) est déjà assurée par middleware.js pour toute cette route,
// mais celui-ci ne route que par CHEMIN (pending/mobile/pc/admin) — il ne lit pas le corps des
// requêtes. La restriction fine PAR ACTION (ex. un compte "pc" ne peut pas importer/scraper/nettoyer)
// est donc vérifiée ici, via le rôle du jeton de session (voir lib/auth.js).
const { setCorsHeaders } = require('./_scrapeLib');
const { getSession } = require('../lib/auth');
const { getAllConfig } = require('../lib/config');
const db = require('../lib/db');

// null = toutes les actions autorisées pour ce rôle.
const ROLE_ALLOWED_ACTIONS = {
  admin: null,
  pc: ['exists', 'stats', 'search', 'resolution-stats', 'export-csv', 'user-search-stats', 'record-search-stat'],
  mobile: ['exists', 'search', 'record-search-stat'],
};

function actionAllowedForRole(role, action) {
  const allowed = ROLE_ALLOWED_ACTIONS[role];
  if (allowed === undefined) return false; // rôle inconnu, ou 'pending' (jamais d'accès applicatif)
  return allowed === null || allowed.includes(action);
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const action = req.method === 'GET' ? req.query.action : (req.body || {}).action;
  const session = getSession(req);
  if (!actionAllowedForRole(session ? session.role : null, action)) {
    res.status(403).json({ error: "Action non autorisée pour ce rôle." });
    return;
  }

  try {
    if (req.method === 'GET') {
      if (action === 'exists') {
        res.status(200).json({ exists: await db.trackingNumberExists(req.query.numSuivi) });
        return;
      }

      if (action === 'stats') {
        res.status(200).json(await db.getStats());
        return;
      }

      if (action === 'search') {
        res.status(200).json(await db.search(req.query.q, req.query.limit, req.query.offset));
        return;
      }

      if (action === 'unresolved-rows') {
        const { limit, afterId } = req.query;
        res.status(200).json({ rows: await db.unresolvedRows(limit, afterId) });
        return;
      }

      if (action === 'distinct-transporteurs') {
        res.status(200).json({ transporteurs: await db.distinctTransporteurs() });
        return;
      }

      if (action === 'resolution-stats') {
        const cfg = await getAllConfig();
        const excluded = Array.isArray(cfg['dashboard-excluded-carriers']) ? cfg['dashboard-excluded-carriers'] : [];
        res.status(200).json(await db.resolutionStats(excluded));
        return;
      }

      if (action === 'user-search-stats') {
        res.status(200).json({ stats: await db.getUserSearchStats() });
        return;
      }

      if (action === 'export-csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="aia-mg-export.csv"');
        res.setHeader('Cache-Control', 'private, no-store');
        for await (const chunk of db.exportCsvRows()) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      res.status(400).json({ error: "Action inconnue pour GET (attendu : 'stats', 'search', 'unresolved-rows', 'distinct-transporteurs', 'resolution-stats', 'user-search-stats' ou 'export-csv')." });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      if (body.action === 'import-batch') {
        const rows = Array.isArray(body.rows) ? body.rows : null;
        if (!rows) {
          res.status(400).json({ error: 'Requête invalide (rows manquant ou invalide).' });
          return;
        }
        res.status(200).json(await db.importBatch(rows));
        return;
      }

      if (body.action === 'apply-scrape-results') {
        const results = Array.isArray(body.results) ? body.results : null;
        if (!results) {
          res.status(400).json({ error: 'Requête invalide (results manquant ou invalide).' });
          return;
        }
        res.status(200).json(await db.applyScrapeResults(results));
        return;
      }

      if (body.action === 'clean-invalid') {
        res.status(200).json(await db.cleanInvalid());
        return;
      }

      if (body.action === 'clean-invalid-km') {
        res.status(200).json(await db.cleanInvalidKm());
        return;
      }

      if (body.action === 'record-search-stat') {
        if (!session || !session.uid) {
          res.status(403).json({ error: 'Session invalide.' });
          return;
        }
        await db.recordSearchStat(session.uid, !!body.found);
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: "Action inconnue pour POST (attendu : 'import-batch', 'apply-scrape-results', 'clean-invalid', 'clean-invalid-km' ou 'record-search-stat')." });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : 'Erreur serveur.' });
  }
};
