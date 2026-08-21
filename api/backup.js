// Sauvegarde/récupération du fichier .aiae (déjà chiffré côté client, voir assets/script.js) sur
// Vercel Blob Storage — store configuré en accès **privé** (choix de l'utilisateur ; l'accès
// public aurait aussi été sûr puisque le contenu est déjà chiffré AES-256, mais le mode d'accès
// d'un store Vercel Blob ne peut plus être changé après sa création, donc le code s'adapte).
//
// Toute lecture/écriture d'un blob privé exige une autorisation (BLOB_READ_WRITE_TOKEN, lu
// automatiquement par le SDK) — impossible pour le navigateur de lire une URL de blob privé
// directement, contrairement à un store public. Cette fonction fait donc systématiquement le
// relais : elle authentifie la requête (cookie de session + code d'exportation), lit/écrit le blob
// via le SDK côté serveur, et relaie le flux au navigateur (streamé, jamais bufferisé en entier).
//
// Le fichier ne passe jamais en un seul bloc dans le corps d'une requête vers cette fonction : les
// fonctions serverless Vercel plafonnent une requête entrante à 4,5 Mo ("FUNCTION_PAYLOAD_TOO_LARGE"
// confirmé en pratique), largement insuffisant pour une base de plusieurs dizaines de Mo.
// - Export : le navigateur découpe le fichier chiffré en morceaux < 4,5 Mo et les envoie un par un
//   (POST action:'chunk'), stockés comme blobs temporaires ; une fois tous reçus, POST
//   action:'finalize' les relit (via get(), pas de limite de taille côté lecture serveur→serveur),
//   les recolle dans l'ordre, écrit le blob final et nettoie les morceaux temporaires.
// - Import : GET relit le blob final via get() et le retransmet en flux (streamé, pas de limite de
//   taille de réponse comme pour une requête entrante) — jamais chargé entièrement en mémoire.
//
// L'export exige un code dédié (variable d'environnement APP_EXPORT_CODE, distincte du code de
// connexion), vérifié à chaque morceau et à la finalisation. L'import reste automatique, sans code.
const { Readable } = require('node:stream');
const { put, get, del } = require('@vercel/blob');
const { setCorsHeaders } = require('./_scrapeLib');

const BLOB_PATHNAME = 'data-mg.aiae';
const TMP_PREFIX = 'tmp-export';

function tmpPartPathname(uploadId, chunkIndex) {
  return `${TMP_PREFIX}/${uploadId}/${chunkIndex}`;
}

// Lit un ReadableStream web (renvoyé par get()) jusqu'au bout et le décode en texte.
async function streamToText(webStream) {
  const chunks = [];
  for await (const chunk of Readable.fromWeb(webStream)) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
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
          access: 'private',
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
          const result = await get(pathname, { access: 'private' });
          if (!result) {
            res.status(400).json({ error: `Morceau ${i + 1}/${totalChunks} manquant — réessayez l'export.` });
            return;
          }
          parts.push(await streamToText(result.stream));
        }

        await put(BLOB_PATHNAME, parts.join(''), {
          access: 'private',
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
      const result = await get(BLOB_PATHNAME, { access: 'private' });
      if (!result) {
        res.status(404).json({ error: 'Aucune sauvegarde trouvée sur Vercel Blob — exportez au moins une fois avant de pouvoir importer.' });
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'private, no-store');
      if (result.blob.size) res.setHeader('Content-Length', String(result.blob.size));
      Readable.fromWeb(result.stream).pipe(res);
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : 'échec de la lecture depuis Vercel Blob.' });
    }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée' });
};
