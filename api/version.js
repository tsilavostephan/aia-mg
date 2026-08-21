// Renvoie le numéro de version généré au moment du build (voir scripts/generate-version.mjs,
// exécuté par "postinstall") : { version: "v1.2.DD.MM.HH", generatedAt: "<ISO>" }.
//
// assets/version.json n'est PAS servi directement comme fichier statique : sur Vercel, les
// fichiers statiques (/assets/...) sont servis depuis l'arborescence Git du projet, pas depuis le
// système de fichiers du conteneur de build après "npm install" — le fichier généré par
// postinstall (volontairement absent du dépôt, voir .gitignore) n'atteint donc jamais cette
// partie-là du déploiement (404). Les fonctions serverless, elles, sont construites APRÈS
// "npm install" dans ce même conteneur : passer par une fonction ici (comme api/chromium-bin pour
// le scraping) permet de bien récupérer le fichier généré.
const { setCorsHeaders } = require('./_scrapeLib');

let versionData;
try {
  versionData = require('../assets/version.json');
} catch (e) {
  // Généré uniquement par un vrai build Vercel (ou `npm install` en local) — absent sinon.
  versionData = { version: null, generatedAt: null };
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Jamais de cache : c'est justement le point de contrôle utilisé pour détecter un nouveau
  // déploiement pendant que la page est ouverte (voir assets/script.js).
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(versionData);
};
