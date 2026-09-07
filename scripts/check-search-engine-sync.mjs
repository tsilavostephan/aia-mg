#!/usr/bin/env node
// Le moteur de reconnaissance de numéro de suivi (DEFAULT_SEARCH_ALGORITHMS + les fonctions
// d'extraction qui l'exécutent) est dupliqué à l'identique entre assets/script.js (PC/Admin) et
// assets/scan.js (Mobile) — ce projet n'a pas de bundler, seulement des balises <script> classiques
// (voir le commentaire en tête de assets/scan.js). Les deux copies sont maintenues à la main et ont
// déjà failli diverger silencieusement plusieurs fois pendant le développement (une correction
// posée dans un seul des deux fichiers). Ce script :
//   1) extrait DEFAULT_SEARCH_ALGORITHMS + le moteur (contentTypeMatches/ruleConditionsMatch/
//      applyExtraction/iso7064Mod3736/runSearchAlgorithm) des deux fichiers via `vm`,
//   2) vérifie que les deux définissent exactement les mêmes ids d'algorithme, avec le même nombre
//      de règles chacun,
//   3) rejoue une batterie de cas connus (accumulés au fil des sessions de travail sur ce moteur)
//      contre les DEUX copies et échoue si un seul résultat diffère.
//
// Usage : node scripts/check-search-engine-sync.mjs
// Code de sortie non nul si une divergence est détectée (utilisable en CI/pré-déploiement).

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Cas de référence : {label, algoId, input, expected} — accumulés/vérifiés au fil de cette session
// contre la vraie base de données (voir l'historique des commits touchant ces algorithmes).
const CASES = [
  { label: 'Colissimo % (avec clé de contrôle)', algoId: 'colissimo', input: '%0094150116A0750391009801250', expected: '6A07503910096' },
  { label: 'DPD clé ISO 7064 (bloc avec lettre finale)', algoId: 'dpd', input: '009415010913008577590101902P', expected: '10913008577590U' },
  { label: "DPD '%' purement numérique", algoId: 'dpd', input: '%009415005438800036587327901', expected: '05438800036587' },
  { label: "DPD '%' purement numérique (variante)", algoId: 'dpd', input: '%009415001505417833052101902', expected: '01505417833052' },
  { label: 'La Poste SD (datamatrix Lettre Suivie)', algoId: 'laposte', input: '%000000087000635587726381250A18^BAA39F', expected: '87000635587726' },
];

function extractEngine(filePath){
  const src = readFileSync(filePath, 'utf8');

  // Un seul bloc contigu : cleanNumSuivi -> stripSpecialCharsEdges -> DEFAULT_SEARCH_ALGORITHMS ->
  // SEARCH_ALGORITHMS -> contentTypeMatches/ruleConditionsMatch/applyExtraction/iso7064Mod3736/
  // runSearchAlgorithm -> computeBestTracking, dans cet ordre dans les deux fichiers — pas besoin
  // d'extraire DEFAULT_SEARCH_ALGORITHMS séparément (ça le déclarerait deux fois une fois concaténé).
  const start = src.indexOf('function cleanNumSuivi');
  // Ancre de fin commune aux deux fichiers : la dernière ligne du corps de computeBestTracking.
  const endAnchor = 'return results[0] || stripped || null;';
  const endAnchorIdx = src.indexOf(endAnchor, start);
  if(start === -1 || endAnchorIdx === -1){
    throw new Error(`Impossible de repérer le moteur d'extraction dans ${filePath}`);
  }
  // Inclut jusqu'à l'accolade fermante qui suit l'ancre (fin de computeBestTracking).
  const closeIdx = src.indexOf('}', endAnchorIdx) + 1;
  const engineSrc = src.slice(start, closeIdx);

  // vm.runInContext ne reflète pas les `const`/`let` de premier niveau comme propriétés du contexte
  // (seul `var` le ferait) — on les expose donc explicitement via une affectation ajoutée à la fin.
  const context = { console };
  vm.createContext(context);
  vm.runInContext(
    `${engineSrc}\nglobalThis.__ENGINE__ = { DEFAULT_SEARCH_ALGORITHMS, runSearchAlgorithm };`,
    context,
    { filename: filePath }
  );
  return context.__ENGINE__;
}

function main(){
  const files = {
    'assets/script.js': path.join(ROOT, 'assets/script.js'),
    'assets/scan.js': path.join(ROOT, 'assets/scan.js'),
  };

  const engines = {};
  for(const [label, filePath] of Object.entries(files)){
    engines[label] = extractEngine(filePath);
  }

  let failures = 0;

  // 1) Mêmes ids d'algorithme, même nombre de règles chacun.
  const [labelA, labelB] = Object.keys(engines);
  const algosA = engines[labelA].DEFAULT_SEARCH_ALGORITHMS;
  const algosB = engines[labelB].DEFAULT_SEARCH_ALGORITHMS;
  const idsA = algosA.map(a => `${a.id}(${a.rules.length})`).sort();
  const idsB = algosB.map(a => `${a.id}(${a.rules.length})`).sort();
  if(JSON.stringify(idsA) !== JSON.stringify(idsB)){
    failures++;
    console.log('❌ Les algorithmes (id + nombre de règles) diffèrent entre les deux fichiers :');
    console.log(`   ${labelA} : ${idsA.join(', ')}`);
    console.log(`   ${labelB} : ${idsB.join(', ')}`);
  }else{
    console.log(`✅ Mêmes algorithmes des deux côtés : ${idsA.join(', ')}`);
  }

  // 2) Rejoue la batterie de cas connus contre les deux copies.
  for(const { label, algoId, input, expected } of CASES){
    const resultA = runFor(engines[labelA], algoId, input);
    const resultB = runFor(engines[labelB], algoId, input);
    const okA = resultA === expected;
    const okB = resultB === expected;
    const same = resultA === resultB;
    if(okA && okB && same){
      console.log(`✅ ${label} — ${labelA} et ${labelB} -> "${resultA}"`);
    }else{
      failures++;
      console.log(`❌ ${label}`);
      console.log(`   attendu : ${JSON.stringify(expected)}`);
      console.log(`   ${labelA} -> ${JSON.stringify(resultA)}${okA ? '' : '  (FAUX)'}`);
      console.log(`   ${labelB} -> ${JSON.stringify(resultB)}${okB ? '' : '  (FAUX)'}`);
    }
  }

  if(failures > 0){
    console.log(`\n${failures} divergence(s)/échec(s) détecté(s).`);
    process.exit(1);
  }
  console.log('\nLes deux copies du moteur sont synchronisées et correctes sur tous les cas connus.');
}

function runFor(engine, algoId, input){
  const algo = engine.DEFAULT_SEARCH_ALGORITHMS.find(a => a.id === algoId);
  if(!algo) return `(algorithme '${algoId}' introuvable)`;
  return engine.runSearchAlgorithm(algo, input);
}

main();
