#!/usr/bin/env node
// Smoke-test de bout en bout contre la vraie base de test (Postgres/Neon) : rejoue les scénarios
// qu'il a fallu vérifier à la main, encore et encore, tout au long du développement de ce projet
// (login/session, recherche, tableau de bord, exclusion transporteur, compteur par utilisateur,
// changement de mot de passe en libre-service) — à lancer avant de déployer un changement qui
// touche à l'un de ces chemins.
//
// N'utilise QUE des comptes temporaires (créés puis supprimés) pour tout ce qui touche aux
// utilisateurs, et sauvegarde/restaure explicitement la config partagée qu'il touche
// (dashboard-excluded-carriers) — un script précédent avait accidentellement écrasé cette
// configuration en la remettant à [] sans restaurer sa vraie valeur d'avant test.
//
// Usage : node --env-file=.env scripts/smoke-test.mjs

import { sql } from '@vercel/postgres';

const results = [];
function check(label, condition, detail){
  results.push({ label, ok: !!condition, detail });
  console.log(`${condition ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`);
}

function mockReq(method, cookieToken, query, body){
  return {
    method,
    headers: cookieToken ? { cookie: 'aia_auth=' + cookieToken } : {},
    query: query || {},
    body: body || {},
  };
}
function mockRes(){
  return {
    _status: 200, _json: null,
    status(c){ this._status = c; return this; },
    setHeader(){ return this; },
    json(obj){ this._json = obj; return this; },
    end(){ return this; },
  };
}

async function main(){
  const { createUser, findUserByUsername } = await import('../lib/users.js');
  const { createSessionToken } = await import('../lib/auth.js');
  const { getAllConfig, setConfig } = await import('../lib/config.js');
  const dbHandler = (await import('../api/db.js')).default;
  const usersHandler = (await import('../api/users.js')).default;
  const configHandler = (await import('../api/config.js')).default;
  const loginHandler = (await import('../api/login.js')).default;
  const sessionHandler = (await import('../api/session.js')).default;

  // ---------- sauvegarde de la config partagée qu'on va toucher ----------
  const cfgBefore = await getAllConfig();
  const excludedBefore = Array.isArray(cfgBefore['dashboard-excluded-carriers'])
    ? cfgBefore['dashboard-excluded-carriers']
    : [];

  const tmpUsername = 'ST' + Math.floor(Math.random() * 10); // trigramme temporaire (3 lettres)
  let user = null;

  try{
    // ---------- comptes temporaires ----------
    user = await createUser(tmpUsername, 'smoketest123', 'admin');
    check('Création d\'un compte temporaire', !!user, `id=${user.id}, username=${user.username}`);

    // ---------- login (mot de passe correct / incorrect) ----------
    let res = mockRes();
    await loginHandler(mockReq('POST', null, {}, { username: tmpUsername, password: 'smoketest123' }), res);
    check('Login avec le bon mot de passe', res._status === 200, `status=${res._status}`);

    res = mockRes();
    await loginHandler(mockReq('POST', null, {}, { username: tmpUsername, password: 'mauvais-mdp' }), res);
    check('Login avec un mauvais mot de passe rejeté', res._status !== 200, `status=${res._status}`);

    const token = createSessionToken({ uid: user.id, role: user.role });

    // ---------- session ----------
    res = mockRes();
    await sessionHandler(mockReq('GET', token), res);
    check('/api/session renvoie le bon rôle/trigramme', res._json && res._json.role === 'admin' && res._json.username === tmpUsername, JSON.stringify(res._json));

    // ---------- recherche ----------
    res = mockRes();
    await dbHandler(mockReq('GET', token, { action: 'search', q: '', limit: 5, offset: 0 }), res);
    const searchOk = res._status === 200 && Array.isArray(res._json.rows) && typeof res._json.total === 'number';
    check('Recherche (listing) répond correctement', searchOk, `total=${res._json && res._json.total}`);

    // ---------- tableau de bord + exclusion transporteur (purement visuelle) ----------
    res = mockRes();
    await dbHandler(mockReq('GET', token, { action: 'resolution-stats' }), res);
    const before = res._json;
    check('resolution-stats répond', res._status === 200 && before && before.overall, JSON.stringify(before && before.overall));

    if(before && before.entries && before.entries.length){
      const target = before.entries[0].transporteur;
      res = mockRes();
      await configHandler(mockReq('POST', token, {}, { key: 'dashboard-excluded-carriers', value: [target] }), res);
      check('Exclusion d\'un transporteur enregistrée', res._status === 200);

      res = mockRes();
      await dbHandler(mockReq('GET', token, { action: 'resolution-stats' }), res);
      const after = res._json;
      const hidden = !after.entries.some(e => e.transporteur === target);
      const overallUnchanged = JSON.stringify(after.overall) === JSON.stringify(before.overall);
      check(`Transporteur "${target}" masqué après exclusion`, hidden);
      check('Le Total ne change PAS après exclusion (comportement voulu)', overallUnchanged, `avant=${JSON.stringify(before.overall)} après=${JSON.stringify(after.overall)}`);
    }else{
      console.log('(aucun transporteur avec >=100 colis à tester pour l\'exclusion)');
    }

    // ---------- compteur par utilisateur ----------
    res = mockRes();
    await dbHandler(mockReq('POST', token, {}, { action: 'record-search-stat', found: true }), res);
    check('record-search-stat accepté', res._status === 200);

    res = mockRes();
    await dbHandler(mockReq('GET', token, { action: 'user-search-stats' }), res);
    const entry = res._json && res._json.stats && res._json.stats.find(s => s.username === tmpUsername);
    check('Le compte temporaire apparaît dans user-search-stats', !!entry && entry.totalSearches >= 1, JSON.stringify(entry));

    // ---------- changement de mot de passe en libre-service ----------
    res = mockRes();
    await usersHandler(mockReq('POST', token, {}, { action: 'set-own-password', currentPassword: 'mauvais-mdp', newPassword: 'nouveau1234' }), res);
    check('Refuse le changement avec un mauvais mot de passe actuel', res._status !== 200, `status=${res._status}`);

    res = mockRes();
    await usersHandler(mockReq('POST', token, {}, { action: 'set-own-password', currentPassword: 'smoketest123', newPassword: 'nouveau1234' }), res);
    check('Change le mot de passe avec le bon mot de passe actuel', res._status === 200, `status=${res._status}`);

    res = mockRes();
    await loginHandler(mockReq('POST', null, {}, { username: tmpUsername, password: 'nouveau1234' }), res);
    check('Login avec le nouveau mot de passe', res._status === 200, `status=${res._status}`);
  } finally {
    // ---------- nettoyage : compte temporaire + restauration EXACTE de la config touchée ----------
    if(user){
      await sql`DELETE FROM users WHERE id = ${user.id}`;
      await sql`DELETE FROM user_search_stats WHERE user_id = ${user.id}`; // normalement déjà en cascade, ceinture-bretelles
    }
    await setConfig('dashboard-excluded-carriers', excludedBefore);
    console.log(`\nNettoyage effectué (compte temporaire supprimé, dashboard-excluded-carriers restauré à ${JSON.stringify(excludedBefore)}).`);
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
  if(failed.length){
    console.log('Échecs :', failed.map(f => f.label).join(', '));
    process.exit(1);
  }
}

main().catch(e => { console.error('ERREUR INATTENDUE', e); process.exit(1); });
