// Gestion des comptes (panneau "👥 Comptes", admin uniquement) : liste des comptes, attribution
// d'un rôle (approuve un compte "pending" ou change un rôle existant), réinitialisation de mot de
// passe (pas d'envoi d'email dans ce projet — l'admin communique le nouveau mot de passe lui-même).
const { setCorsHeaders } = require('./_scrapeLib');
const { getSession } = require('../lib/auth');
const { listUsers, setUserRole, setUserPassword, findUserById } = require('../lib/users');

const VALID_ROLES = ['pending', 'mobile', 'pc', 'admin'];

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const session = getSession(req);
  if (!session || session.role !== 'admin') {
    res.status(403).json({ error: "Réservé aux comptes administrateur." });
    return;
  }

  try {
    if (req.method === 'GET') {
      res.status(200).json({ users: await listUsers() });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      if (body.action === 'set-role') {
        const userId = Number(body.userId);
        if (!userId || !VALID_ROLES.includes(body.role)) {
          res.status(400).json({ error: 'Requête invalide (userId ou role manquant/invalide).' });
          return;
        }
        // Un admin ne peut pas se retirer lui-même son propre accès admin par erreur depuis ce
        // panneau — il faut qu'un autre admin le fasse (ou directement en base).
        if (userId === session.uid && body.role !== 'admin') {
          res.status(400).json({ error: 'Vous ne pouvez pas changer votre propre rôle.' });
          return;
        }
        const target = await findUserById(userId);
        if (!target) {
          res.status(404).json({ error: 'Compte introuvable.' });
          return;
        }
        const updated = await setUserRole(userId, body.role);
        res.status(200).json({ user: updated });
        return;
      }

      if (body.action === 'set-password') {
        const userId = Number(body.userId);
        if (!userId || !body.password || String(body.password).length < 8) {
          res.status(400).json({ error: 'Requête invalide (userId manquant ou mot de passe < 8 caractères).' });
          return;
        }
        const ok = await setUserPassword(userId, body.password);
        if (!ok) {
          res.status(404).json({ error: 'Compte introuvable.' });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: "Action inconnue pour POST (attendu : 'set-role' ou 'set-password')." });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : 'Erreur serveur.' });
  }
};
