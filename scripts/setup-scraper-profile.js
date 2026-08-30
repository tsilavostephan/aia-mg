// Configuration unique d'un profil Chrome DÉDIÉ au scraping local (PARCELSAPP/WANBEXPRESS) — pas
// une copie de votre profil personnel (fragile, et touche des données sensibles inutilement) : un
// dossier neuf, que scripts/local-scrape-worker.js réutilise ensuite directement à chaque lancement
// (headless), en profitant des cookies qui s'y accumulent naturellement au fil des scrapes.
//
// Usage : node scripts/setup-scraper-profile.js
// Ouvre une fenêtre Chrome VISIBLE sur parcelsapp.com. Acceptez le bandeau de consentement
// publicitaire si affiché, puis revenez ici et appuyez sur Entrée pour fermer et enregistrer.
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteerCore = require('puppeteer-core');
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const CHROME_PATH = process.env.CHROME_PATH || path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const PROFILE_DIR = process.env.SCRAPER_PROFILE_DIR || path.join(os.homedir(), '.aia-scraper-chrome-profile');

function waitForEnter(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, () => { rl.close(); resolve(); }));
}

(async () => {
  console.log(`Profil dédié : ${PROFILE_DIR}`);
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_DIR,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.goto('https://parcelsapp.com/', { waitUntil: 'load', timeout: 30000 }).catch(() => {});

  await waitForEnter(
    '\nUne fenêtre Chrome vient de s\'ouvrir sur parcelsapp.com.\n' +
    'Acceptez le bandeau de consentement (bouton "Autoriser") s\'il apparaît, puis revenez ici et appuyez sur Entrée...\n'
  );

  // Vérifie tout de suite que le cookie attendu est bien là, AVANT de fermer — évite un aller-retour
  // inutile vers extract-parcelsapp-cookies.js pour découvrir l'échec après coup.
  const client = await page.target().createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  const hasConsent = cookies.some((c) => c.name === 'FCCDCF' && /parcelsapp\.com$/i.test(c.domain.replace(/^\./, '')));

  await browser.close();

  if (hasConsent) {
    console.log(`\n✅ Cookie de consentement (FCCDCF) trouvé — profil prêt (${PROFILE_DIR}).`);
    console.log('Lancez maintenant : node scripts/extract-parcelsapp-cookies.js "' + PROFILE_DIR + '"');
  } else {
    console.log(`\n⚠️ Cookie de consentement (FCCDCF) INTROUVABLE dans ce profil.`);
    console.log('Le bandeau de consentement n\'a probablement pas été accepté (pas affiché, ou clic manqué).');
    console.log('Relancez ce script et, cette fois, vérifiez bien qu\'un bandeau apparaît en bas/au centre de la page et cliquez explicitement sur "Autoriser" avant d\'appuyer sur Entrée ici.');
  }
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
