// Exécuté automatiquement après `npm install` (y compris pendant le build Vercel), juste après
// postinstall.mjs. Génère assets/version.json avec un numéro de version horodaté au moment du
// build : v1.2.DD.MM.HH (jour, mois, heure du déploiement, toujours sur 2 chiffres).
//
// Le client (assets/script.js) affiche ce numéro dans l'en-tête et interroge périodiquement ce même
// fichier (sans cache HTTP) pour détecter qu'une nouvelle version a été déployée pendant que la page
// est ouverte, et proposer alors un bouton "MAJ" plutôt que de recharger silencieusement.
//
// Ce fichier est un artefact de build (voir .gitignore) : il n'existe pas tant que ce script n'a
// pas tourné une fois (ex. `npm install` en local, ou build Vercel). Sans lui, l'app affiche
// simplement sa version statique de repli et la détection de mise à jour reste inactive.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

// Heure de Paris explicitement (plutôt que l'heure du serveur de build, qui tourne en UTC sur
// Vercel) pour que le numéro de version corresponde à l'heure "ressentie" par l'utilisateur.
function buildTimestampParts(date) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return { day: get('day'), month: get('month'), hour: get('hour') };
}

function main() {
  try {
    const now = new Date();
    const { day, month, hour } = buildTimestampParts(now);
    const version = `v1.2.${day}.${month}.${hour}`;

    const outputPath = join(projectRoot, 'assets', 'version.json');
    writeFileSync(outputPath, JSON.stringify({ version, generatedAt: now.toISOString() }, null, 2));

    console.log('[generate-version]', version, '->', outputPath);
  } catch (error) {
    console.warn('[generate-version] Échec de la génération de version.json (non bloquant) :', error && error.message);
    process.exit(0); // ne fait jamais échouer l'installation
  }
}

main();
