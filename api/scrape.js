// Point d'entrée unique pour le scraping de tous les transporteurs pris en charge, qui dispatche
// vers le module du bon transporteur selon le champ "carrier" du corps de la requête (ou de la
// query string en GET). Les modules eux-mêmes vivent dans lib/scrapers/ (hors de /api, donc pas
// comptés comme fonctions serverless séparées) et gardent chacun leur logique exacte inchangée.
//
// Pourquoi ce regroupement : le plan Vercel Hobby limite à 12 fonctions serverless par déploiement
// — une fonction par transporteur (9 au total) faisait dépasser cette limite une fois combinée aux
// autres endpoints (auth, logout, login-code, version, backup). Voir vercel.json, qui ne déclare
// plus qu'une seule entrée "api/scrape.js" (maxDuration + includeFiles du binaire Chromium)
// s'appliquant à tous les transporteurs.
const { setCorsHeaders } = require('./_scrapeLib');

const SCRAPERS = {
  '4px': require('../lib/scrapers/4px'),
  cainiao: require('../lib/scrapers/cainiao'),
  cne: require('../lib/scrapers/cne'),
  landmark: require('../lib/scrapers/landmark'),
  parcelsapp: require('../lib/scrapers/parcelsapp'),
  sfc: require('../lib/scrapers/sfc'),
  sunyou: require('../lib/scrapers/sunyou'),
  topyou: require('../lib/scrapers/topyou'),
  wanbexpress: require('../lib/scrapers/wanbexpress'),
  yanwen: require('../lib/scrapers/yanwen'),
  yunexpress: require('../lib/scrapers/yunexpress'),
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.status(204).end();
    return;
  }

  const carrier = req.method === 'POST'
    ? (req.body && req.body.carrier)
    : req.query.carrier;

  const target = SCRAPERS[carrier];
  if (!target) {
    setCorsHeaders(res);
    res.status(400).json({ error: `Transporteur inconnu ou manquant : "${carrier || ''}".` });
    return;
  }

  return target(req, res);
};
