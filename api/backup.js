// Sauvegarde/récupération du fichier .aiae (déjà chiffré côté client, voir assets/script.js) sur
// Vercel Blob Storage.
//
// Le protocole "client upload" officiel de @vercel/blob/client (upload direct navigateur -> Vercel
// Blob) a été abandonné : chargé depuis un CDN dans cette app statique sans étape de build (ce SDK
// est conçu pour être empaqueté via Next.js/Webpack), il envoyait bien le fichier avec succès mais
// la requête PUT vers vercel.com/api/blob se heurtait systématiquement à un blocage CORS ("No
// 'Access-Control-Allow-Origin' header"), avec une nouvelle tentative complète à chaque échec
// (d'où la progression qui revenait sans cesse à 0 % avant de remonter à 100 %, en boucle).
//
// Nouveau protocole, entièrement maison, qui ne dépend plus que de notre propre fonction (jamais
// directement de vercel.com depuis le navigateur) :
// - POST { action:'chunk', exportCode, uploadId, chunkIndex, data } : stocke un morceau (< 4,5 Mo,
//   la limite d'une requête vers une fonction serverless) dans un blob temporaire.
// - POST { action:'finalize', exportCode, uploadId, totalChunks } : relit tous les morceaux
//   (chacun via une requête HTTP faite PAR le serveur, donc jamais soumise aux limites/CORS du
//   navigateur), les recolle dans l'ordre, écrit le blob final (data-mg.aiae) et nettoie les
//   morceaux temporaires.
// - GET : renvoie l'URL publique du blob final (data-mg.aiae) — l'import va ensuite la chercher
//   directement auprès de Vercel Blob (simple fetch(), fonctionne sans souci puisqu'aucun jeton ni
//   protocole spécial n'est nécessaire pour lire un blob "public").
//
// L'export exige un code dédié (variable d'environnement APP_EXPORT_CODE, distincte du code de
// connexion), vérifié à chaque morceau et à la finalisation. L'import reste automatique, sans code.
const { put, list, del } = require('@vercel/blob');
const { setCorsHeaders } = require('./_scrapeLib');

const BLOB_PATHNAME = 'data-mg.aiae';
const TMP_PREFIX = 'tmp-export';

function tmpPartPathname(uploadId, chunkIndex) {
  return `${TMP_PREFIX}/${uploadId}/${chunkIndex}`;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'POST') {
    const body = req.body || {};

    const expectedCode = process.env.APP_EXPORT_CODE;
    if (!expectedCode) {
      res.status(500).json({ error: "Variable d'environnement APP_EXPORT_CODE manquante sur Vercel." });
      return;
    }
    if (body.exportCode !== expectedCode) {
      res.status(401).json({ error: "Code d'exportation incorrect." });
      return;
    }

    try {
      if (body.action === 'chunk') {
        const { uploadId, chunkIndex, data } = body;
        if (!uploadId || typeof chunkIndex !== 'number' || typeof data !== 'string') {
          res.status(400).json({ error: 'Requête de morceau invalide (uploadId/chunkIndex/data manquant).' });
          return;
        }
        await put(tmpPartPathname(uploadId, chunkIndex), data, {
          access: 'public',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'text/plain',
        });
        res.status(200).json({ ok: true });
        return;
      }

      if (body.action === 'finalize') {
        const { uploadId, totalChunks } = body;
        if (!uploadId || !totalChunks) {
          res.status(400).json({ error: 'Requête de finalisation invalide (uploadId/totalChunks manquant).' });
          return;
        }

        const parts = [];
        for (let i = 0; i < totalChunks; i++) {
          const pathname = tmpPartPathname(uploadId, i);
          const { blobs } = await list({ prefix: pathname, limit: 1 });
          const partBlob = blobs.find((b) => b.pathname === pathname);
          if (!partBlob) {
            res.status(400).json({ error: `Morceau ${i + 1}/${totalChunks} manquant — réessayez l'export.` });
            return;
          }
          const partRes = await fetch(partBlob.url);
          if (!partRes.ok) {
            res.status(502).json({ error: `Échec de la relecture du morceau ${i + 1}/${totalChunks}.` });
            return;
          }
          parts.push(await partRes.text());
        }

        await put(BLOB_PATHNAME, parts.join(''), {
          access: 'public',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'application/json',
        });

        // Nettoyage des morceaux temporaires — best-effort, une erreur ici n'invalide pas l'export
        // qui vient de réussir (les morceaux resteront juste jusqu'au prochain export, sans gêner).
        for (let i = 0; i < totalChunks; i++) {
          try { await del(tmpPartPathname(uploadId, i)); } catch (e) { /* nettoyage best-effort */ }
        }

        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: "Action inconnue (attendu : 'chunk' ou 'finalize')." });
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : "échec du traitement de l'export." });
    }
    return;
  }

  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 10 });
      const blob = blobs.find((b) => b.pathname === BLOB_PATHNAME);
      if (!blob) {
        res.status(404).json({ error: 'Aucune sauvegarde trouvée sur Vercel Blob — exportez au moins une fois avant de pouvoir importer.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ url: blob.url });
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : 'échec de la lecture depuis Vercel Blob.' });
    }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée' });
};
