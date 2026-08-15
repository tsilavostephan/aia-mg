// Exécuté automatiquement après `npm install` (y compris pendant le build Vercel).
//
// @sparticuz/chromium-min ne contient pas le binaire Chromium lui-même : il va le télécharger à
// l'exécution depuis une URL qu'on lui fournit. Ce script construit ce binaire (tar) une bonne
// fois pour toutes, à partir de @sparticuz/chromium (devDependency, qui embarque le binaire complet),
// et le place dans assets/chromium-pack.tar — servi en statique par l'app, donc accessible via
// https://<votre-domaine>/assets/chromium-pack.tar une fois déployé.
//
// Construire le binaire dans le même environnement Vercel qui l'exécutera ensuite évite les
// incompatibilités de bibliothèques partagées (ex. "libnss3.so: cannot open shared object file")
// qu'on peut rencontrer en embarquant directement @sparticuz/chromium dans la fonction serverless.
//
// Repris du template officiel Vercel : https://github.com/gabenunez/puppeteer-on-vercel

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

function main() {
  try {
    console.log('[postinstall] Construction de assets/chromium-pack.tar…');

    const chromiumPkgJsonPath = require.resolve('@sparticuz/chromium/package.json');
    const chromiumDir = dirname(chromiumPkgJsonPath);
    const binDir = join(chromiumDir, 'bin');

    if (!existsSync(binDir)) {
      console.log('[postinstall] Dossier "bin" de @sparticuz/chromium introuvable — étape ignorée (normal en dehors d\'un build Vercel).');
      return;
    }

    const outputDir = join(projectRoot, 'assets');
    const outputPath = join(outputDir, 'chromium-pack.tar');

    execSync(`mkdir -p "${outputDir}" && tar -cf "${outputPath}" -C "${binDir}" .`, {
      stdio: 'inherit',
      cwd: projectRoot,
    });

    console.log('[postinstall] chromium-pack.tar créé :', outputPath);
  } catch (error) {
    console.warn('[postinstall] Échec de la création de chromium-pack.tar (non bloquant) :', error && error.message);
    process.exit(0); // ne fait jamais échouer l'installation
  }
}

main();
