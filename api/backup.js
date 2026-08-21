// Sauvegarde/récupération du fichier .aiae (déjà chiffré côté client, voir assets/script.js) sur
// Vercel Blob Storage. Les fonctions serverless Vercel plafonnent le corps d'une requête à 4.5 Mo
// (confirmé par un vrai déploiement : "FUNCTION_PAYLOAD_TOO_LARGE") — largement insuffisant pour
// une base de plusieurs dizaines de Mo. Le fichier ne passe donc plus du tout par cette fonction :
//
// - Export : le navigateur envoie le fichier DIRECTEMENT à Vercel Blob (voir le protocole "client
//   upload" de @vercel/blob/client, chargé depuis un CDN côté client) ; cette fonction ne fait que
//   générer/valider un jeton de très courte durée (POST) — un échange de contrôle minuscule, jamais
//   le fichier lui-même.
// - Import : cette fonction renvoie juste l'URL publique du blob (GET) ; le navigateur va ensuite
//   chercher son contenu directement auprès de Vercel Blob, pas via cette fonction.
//
// Accès "public" : sûr malgré tout puisque le contenu est déjà chiffré (AES-256-GCM) avant d'être
// envoyé — sans le mot de passe, l'URL seule ne révèle rien de lisible.
const { list } = require('@vercel/blob');
const { handleUpload } = require('@vercel/blob/client');
const { setCorsHeaders } = require('./_scrapeLib');

const BLOB_PATHNAME = 'data-mg.aiae';

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'POST') {
    // Étape de contrôle du protocole "client upload" : génère le jeton de courte durée qui
    // autorise le navigateur à envoyer le fichier directement à Vercel Blob, puis (deuxième appel,
    // déclenché par Vercel Blob lui-même) confirme la fin de l'upload. Cette route est déjà
    // protégée par le cookie de session (voir middleware.js, qui ne l'exempte pas) — inutile de
    // ré-authentifier dans onBeforeGenerateToken.
    try {
      const jsonResponse = await handleUpload({
        body: req.body,
        request: req,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: ['application/json'],
          addRandomSuffix: false,
          allowOverwrite: true,
        }),
        onUploadCompleted: async () => { /* rien à faire de plus ici */ },
      });
      res.status(200).json(jsonResponse);
    } catch (e) {
      res.status(400).json({ error: e && e.message ? e.message : "échec de la génération du jeton d'upload." });
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
