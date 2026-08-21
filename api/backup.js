// Sauvegarde/récupération du fichier .aiae (déjà chiffré côté client, voir assets/script.js) sur
// Vercel Blob Storage — pour pouvoir le réimporter automatiquement sans sélecteur de fichier local
// ni service tiers (Google Drive, etc.). Nécessite qu'un "Blob Store" soit connecté au projet
// Vercel (onglet Storage) : la variable BLOB_READ_WRITE_TOKEN est alors ajoutée automatiquement,
// aucune configuration supplémentaire nécessaire.
//
// Le contenu stocké est déjà chiffré (AES-256-GCM) avant d'arriver ici : le blob est donc créé en
// accès "public" (URL directe, sans jeton) sans exposer de donnée lisible — seul le mot de passe,
// jamais transmis ni stocké, permet de le déchiffrer.
const { put, list } = require('@vercel/blob');
const { setCorsHeaders } = require('./_scrapeLib');

const BLOB_PATHNAME = 'data-mg.aiae';

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'POST') {
    // req.body est déjà un objet si le client envoie Content-Type: application/json (cas normal
    // ici, puisque l'enveloppe chiffrée est elle-même du JSON) — on le re-sérialise tel quel.
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (!body || body === '{}') {
      res.status(400).json({ error: 'Corps de requête manquant.' });
      return;
    }
    try {
      const blob = await put(BLOB_PATHNAME, body, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      res.status(200).json({ ok: true, url: blob.url });
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : 'échec de la sauvegarde sur Vercel Blob.' });
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
      const blobRes = await fetch(blob.url);
      if (!blobRes.ok) {
        res.status(502).json({ error: `échec de la récupération depuis Vercel Blob (HTTP ${blobRes.status}).` });
        return;
      }
      const text = await blobRes.text();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(text);
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : 'échec de la lecture depuis Vercel Blob.' });
    }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée' });
};
