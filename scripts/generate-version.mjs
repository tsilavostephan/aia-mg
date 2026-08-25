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
//
// Ce script tamponne aussi ce même numéro de version dans sw.js (CACHE_NAME) : un navigateur ne
// revérifie/réinstalle un service worker QUE si les octets de son propre script changent — un
// déploiement qui ne touche que assets/script.js (ex. la plupart des correctifs) ne suffirait donc
// jamais à lui seul à faire recharger le cache des fichiers statiques (script.js, styles.css…).
// Constaté en pratique : le bouton "MAJ" ne pouvait jamais apparaître dans une PWA Chrome installée
// restée bloquée sur un sw.js jamais réinstallé depuis longtemps. sw.js reste un fichier suivi par
// Git (contrairement à assets/version.json) : ce script le modifie uniquement dans le conteneur de
// build (Vercel, ou un `npm install` local) — pensez à ne pas committer cette modification locale
// par erreur si vous lancez ce script sur votre machine (git checkout -- sw.js pour l'annuler).
import { writeFileSync, readFileSync } from 'node:fs';
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
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return { day: get('day'), month: get('month'), hour: get('hour'), minute: get('minute') };
}

function stampServiceWorker(version) {
  const swPath = join(projectRoot, 'sw.js');
  const original = readFileSync(swPath, 'utf8');
  const stamped = original.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'aia-app-${version}';`);
  if (stamped === original) {
    console.warn('[generate-version] Motif CACHE_NAME introuvable dans sw.js — non modifié.');
    return;
  }
  writeFileSync(swPath, stamped);
  console.log('[generate-version] sw.js tamponné avec', version);
}

function main() {
  try {
    const now = new Date();
    const { day, month, hour, minute } = buildTimestampParts(now);
    // Granularité à la minute (et pas seulement à l'heure) : deux déploiements dans la même heure
    // — fréquent en cas d'itérations rapides — produisaient auparavant le même numéro de version,
    // donc aucune mise à jour n'était détectée côté client tant que l'heure ne changeait pas.
    const version = `v1.2.${day}.${month}.${hour}${minute}`;

    const outputPath = join(projectRoot, 'assets', 'version.json');
    writeFileSync(outputPath, JSON.stringify({ version, generatedAt: now.toISOString() }, null, 2));
    console.log('[generate-version]', version, '->', outputPath);

    stampServiceWorker(version);
  } catch (error) {
    console.warn('[generate-version] Échec de la génération de version.json (non bloquant) :', error && error.message);
    process.exit(0); // ne fait jamais échouer l'installation
  }
}

main();
