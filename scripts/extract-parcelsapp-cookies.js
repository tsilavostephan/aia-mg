// Extrait les cookies de consentement publicitaire de parcelsapp.com depuis un profil Chrome réel
// (voir PARCELSAPP_COOKIES_JSON dans .env.local-worker.example) et affiche le JSON prêt à coller.
//
// ⚠️ Ne JAMAIS pointer directement sur le profil Chrome en cours d'utilisation (verrouillé par le
// navigateur ouvert, risque de corruption) — copiez d'abord "Default" et "Local State" ailleurs
// (voir README, section "Scraping local") puis passez ce chemin en argument :
//   node scripts/extract-parcelsapp-cookies.js "C:\chemin\vers\la\copie\User Data"
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteerCore = require('puppeteer-core');
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const path = require('node:path');
const CHROME_PATH = process.env.CHROME_PATH || path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const PROFILE_COPY_DIR = process.argv[2];

if (!PROFILE_COPY_DIR) {
  console.error('Usage: node scripts/extract-parcelsapp-cookies.js "<chemin vers la copie de User Data>"');
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_COPY_DIR,
    args: ['--profile-directory=Default'],
  });
  const page = await browser.newPage();
  // Visite réelle nécessaire pour que les cookies existent déjà dans ce profil (sinon rien à
  // extraire) — si le profil n'a jamais visité parcelsapp.com avec son consentement accepté, ouvrez
  // d'abord la page normalement dans votre VRAI Chrome, acceptez le consentement, puis relancez ce
  // script sur une nouvelle copie du profil.
  await page.goto('https://parcelsapp.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const client = await page.target().createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  const filtered = cookies.filter((c) => /parcelsapp\.com$/i.test(c.domain.replace(/^\./, '')));
  await browser.close();

  if (filtered.length === 0) {
    console.error("Aucun cookie parcelsapp.com trouvé dans ce profil — visitez d'abord https://parcelsapp.com dans votre vrai Chrome (acceptez le consentement), puis recopiez le profil et réessayez.");
    process.exit(1);
  }

  console.log(`${filtered.length} cookie(s) trouvé(s). Collez la ligne suivante dans .env.local-worker :\n`);
  console.log(`PARCELSAPP_COOKIES_JSON=${JSON.stringify(filtered)}`);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
