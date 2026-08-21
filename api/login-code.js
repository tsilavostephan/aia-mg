// Renvoie le code d'accès (APP_ACCESS_CODE) à une session déjà authentifiée, pour que le client
// puisse en dériver localement le mot de passe de chiffrement des exports .aiae (voir
// assets/script.js, getEncryptionPassword()) sans que l'utilisateur ait à le ressaisir.
//
// ⚠️ Contrairement à api/auth.js (qui ne fait que VÉRIFIER le code sans jamais le renvoyer), cet
// endpoint expose le code en clair — c'est un compromis délibéré pour dériver automatiquement le
// mot de passe de chiffrement. Il reste protégé par le même cookie de session que le reste du site
// (voir middleware.js, qui ne l'exempte pas) : seule une session déjà connectée peut l'appeler.
const { setCorsHeaders } = require('./_scrapeLib');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const code = process.env.APP_ACCESS_CODE;
  if (!code) {
    res.status(500).json({ error: "Variable d'environnement APP_ACCESS_CODE manquante sur Vercel." });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ code });
};
