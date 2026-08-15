// Efface le cookie "aia_auth" et renvoie vers la page de connexion.
module.exports = async function handler(req, res) {
  res.setHeader('Set-Cookie', 'aia_auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  res.writeHead(302, { Location: '/login.html' });
  res.end();
};
