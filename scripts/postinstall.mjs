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
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

function main() {
  try {
    console.log('[postinstall] Copie des fichiers Chromium vers api/chromium-bin…');

    const chromiumPkgJsonPath = require.resolve('@sparticuz/chromium/package.json');
    const chromiumDir = dirname(chromiumPkgJsonPath);
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
