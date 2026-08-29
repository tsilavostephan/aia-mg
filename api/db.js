// Point d'entrée unique pour toutes les opérations sur la base de colis (Vercel Postgres), routées
// par `action` — même approche que api/scrape.js (dispatch) et l'ancien api/backup.js, pour rester
// sous la limite de fonctions serverless du plan Hobby (voir commentaire dans api/scrape.js).
// L'authentification (cookie aia_auth) est déjà assurée par middleware.js pour toute cette route.
const { setCorsHeaders } = require('./_scrapeLib');
const db = require('../lib/db');

function checkExportCode(code) {
  const expected = process.env.APP_EXPORT_CODE;
  if (!expected) return "Variable d'environnement APP_EXPORT_CODE manquante sur Vercel.";
  if (code !== expected) return "Code d'exportation incorrect.";
  return null;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const action = req.query.action;

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
        const { limit, offset } = req.query;
        res.status(200).json({ rows: await db.unresolvedRows(limit, offset) });
        return;
      }

      if (action === 'distinct-transporteurs') {
        res.status(200).json({ transporteurs: await db.distinctTransporteurs() });
        return;
      }

      if (action === 'export-csv') {
        // Le code passe en en-tête (pas en query string) pour ne jamais apparaître dans l'URL —
        // voir le commentaire correspondant dans assets/script.js.
        const err = checkExportCode(req.headers['x-export-code']);
        if (err) {
          res.status(401).json({ error: err });
          return;
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="aia-mg-export.csv"');
        res.setHeader('Cache-Control', 'private, no-store');
        for await (const chunk of db.exportCsvRows()) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      res.status(400).json({ error: "Action inconnue pour GET (attendu : 'stats', 'search', 'unresolved-rows', 'distinct-transporteurs' ou 'export-csv')." });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      if (body.action === 'verify-code') {
        const err = checkExportCode(body.exportCode);
        if (err) {
          res.status(401).json({ error: err });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }

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
        const err = checkExportCode(body.exportCode);
        if (err) {
          res.status(401).json({ error: err });
          return;
        }
        res.status(200).json(await db.cleanInvalid());
        return;
      }

      if (body.action === 'clean-invalid-km') {
        const err = checkExportCode(body.exportCode);
        if (err) {
          res.status(401).json({ error: err });
          return;
        }
        res.status(200).json(await db.cleanInvalidKm());
        return;
      }

      if (body.action === 'clear-all') {
        const err = checkExportCode(body.exportCode);
        if (err) {
          res.status(401).json({ error: err });
          return;
        }
        await db.clearAll();
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: "Action inconnue pour POST (attendu : 'verify-code', 'import-batch', 'apply-scrape-results', 'clean-invalid', 'clean-invalid-km' ou 'clear-all')." });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : 'Erreur serveur.' });
  }
};
