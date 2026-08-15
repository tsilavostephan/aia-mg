// Exécuté automatiquement après `npm install` (y compris pendant le build Vercel).
//
// @sparticuz/chromium-min ne contient pas le binaire Chromium lui-même. On pourrait lui donner une
// URL à télécharger à l'exécution, mais sur ce projet les déploiements sont protégés par la
// "Vercel Authentication" (Deployment Protection) — un appel HTTP de la fonction vers son propre
// déploiement se heurte alors à la page de connexion Vercel au lieu du vrai fichier. On évite donc
// tout appel réseau : ce script copie simplement les fichiers Chromium (dossier "bin" fourni par la
// devDependency @sparticuz/chromium) dans api/chromium-bin, inclus directement dans le paquet de la
// fonction serverless (voir "includeFiles" dans vercel.json). chromium-min les lit alors comme un
// dossier local, sans aucune requête HTTP.
//
// Inspiré du template officiel Vercel (https://github.com/gabenunez/puppeteer-on-vercel), adapté
// pour lire les fichiers en local plutôt que de les auto-héberger.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

// require.resolve('@sparticuz/chromium/package.json') échoue : ce package restreint ses sous-chemins
// via son champ "exports" (qui n'autorise que son point d'entrée principal). On résout donc le point
// d'entrée (autorisé) puis on remonte les dossiers parents à la recherche du package.json du module
// (lu directement via fs, ce qui contourne la restriction "exports" — celle-ci ne s'applique qu'à la
// résolution de modules, pas à une simple lecture de fichier).
function findChromiumPackageDir() {
  let dir = dirname(require.resolve('@sparticuz/chromium'));
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name === '@sparticuz/chromium') return dir;
      } catch (_e) { /* package.json illisible à ce niveau, on continue de remonter */ }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // racine du système de fichiers atteinte
    dir = parent;
  }
  return null;
}

function main() {
  try {
    console.log('[postinstall] Copie des fichiers Chromium vers api/chromium-bin…');

    const chromiumDir = findChromiumPackageDir();
    if (!chromiumDir) {
      console.log('[postinstall] Dossier du package @sparticuz/chromium introuvable — étape ignorée.');
      return;
    }
    const binDir = join(chromiumDir, 'bin');

    if (!existsSync(binDir)) {
      console.log('[postinstall] Dossier "bin" de @sparticuz/chromium introuvable — étape ignorée (normal en dehors d\'un build Vercel).');
      return;
    }

    const outputDir = join(projectRoot, 'api', 'chromium-bin');
    rmSync(outputDir, { recursive: true, force: true }); // repart d'un dossier propre à chaque build
    mkdirSync(outputDir, { recursive: true });
    cpSync(binDir, outputDir, { recursive: true });

    console.log('[postinstall] Fichiers Chromium copiés dans', outputDir);
  } catch (error) {
    console.warn('[postinstall] Échec de la copie des fichiers Chromium (non bloquant) :', error && error.message);
    process.exit(0); // ne fait jamais échouer l'installation
  }
}

main();
