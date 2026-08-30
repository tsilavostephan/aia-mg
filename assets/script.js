(function(){
  // Colonnes source (index 1-based dans le fichier CSV) -> champ de la base
  const COLS = [
    { key:'numCommande',   label:'N° Commande',               col:3  },
    { key:'commandeAmazon',label:'Commande Amazon',           col:2  },
    { key:'qteCommande',   label:'QTE',                       col:4  },
    { key:'numSuivi',      label:'Num Suivi',                 col:5  },
    { key:'qteExpedie',    label:'QTE_EXPED',                 col:6  },
    { key:'nom',           label:'Nom',                       col:7  },
    { key:'transporteur',  label:'Transporteur',              col:8  },
    { key:'numDernierKm',  label:'Num dernier kilométrique',  col:null } // toujours vide
  ];
  const COLS_STORAGE_KEY = 'commandes-cols-config';

  const els = {
    appLoadingOverlay: document.getElementById('appLoadingOverlay'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    filelist: document.getElementById('filelist'),
    importBtn: document.getElementById('importBtn'),
    resetSelection: document.getElementById('resetSelection'),
    hasHeader: document.getElementById('hasHeader'),
    log: document.getElementById('log'),
    dbCards: document.getElementById('dbCards'),
    rowCount: document.getElementById('rowCount'),
    resolvedCount: document.getElementById('resolvedCount'),
    resolvedPercent: document.getElementById('resolvedPercent'),
    count: document.getElementById('count'),
    emptyState: document.getElementById('emptyState'),
    search: document.getElementById('search'),
    displayLimit: document.getElementById('displayLimit'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    pageInfo: document.getElementById('pageInfo'),
    exportJsonEncryptedBtn: document.getElementById('exportJsonEncryptedBtn'),
    importBackupBtn: document.getElementById('importBackupBtn'),
    backupProgressWrap: document.getElementById('backupProgressWrap'),
    backupProgressBar: document.getElementById('backupProgressBar'),
    backupProgressText: document.getElementById('backupProgressText'),
    exportCodeModalBg: document.getElementById('exportCodeModalBg'),
    exportCodeInput: document.getElementById('exportCodeInput'),
    exportCodeModalError: document.getElementById('exportCodeModalError'),
    exportCodeConfirmBtn: document.getElementById('exportCodeConfirmBtn'),
    exportCodeCancelBtn: document.getElementById('exportCodeCancelBtn'),
    dbLog: document.getElementById('dbLog'),
    cleanInvalidBtn: document.getElementById('cleanInvalidBtn'),
    cleanInvalidKmBtn: document.getElementById('cleanInvalidKmBtn'),
    carrierSection: document.getElementById('carrierSection'),
    carrierTabs: document.getElementById('carrierTabs'),
    carrierPanel: document.getElementById('carrierPanel'),
    carrierMappingBtn: document.getElementById('carrierMappingBtn'),
    carrierSectionUpdatedCount: document.getElementById('carrierSectionUpdatedCount'),
    carrierMappingModalBg: document.getElementById('carrierMappingModalBg'),
    carrierMappingList: document.getElementById('carrierMappingList'),
    carrierMappingSaveBtn: document.getElementById('carrierMappingSaveBtn'),
    carrierMappingCancelBtn: document.getElementById('carrierMappingCancelBtn'),
    scrapeAllBtn: document.getElementById('scrapeAllBtn'),
    scrapeAllLog: document.getElementById('scrapeAllLog'),
    scrapeAllProgressWrap: document.getElementById('scrapeAllProgressWrap'),
    scrapeAllProgressBar: document.getElementById('scrapeAllProgressBar'),
    fourPxApiConfigModalBg: document.getElementById('fourPxApiConfigModalBg'),
    fourPxPageLoadWaitMs: document.getElementById('fourPxPageLoadWaitMs'),
    fourPxClickWaitMs: document.getElementById('fourPxClickWaitMs'),
    fourPxApiConfigSaveBtn: document.getElementById('fourPxApiConfigSaveBtn'),
    fourPxApiConfigCancelBtn: document.getElementById('fourPxApiConfigCancelBtn'),
    trackingModalBg: document.getElementById('trackingModalBg'),
    trackingModalTitle: document.getElementById('trackingModalTitle'),
    trackingCount: document.getElementById('trackingCount'),
    trackingBoxLabel: document.getElementById('trackingBoxLabel'),
    trackingUrlBox: document.getElementById('trackingUrlBox'),
    copyUrlBtn: document.getElementById('copyUrlBtn'),
    modalCopyIconBtn: document.getElementById('modalCopyIconBtn'),
    openUrlBtn: document.getElementById('openUrlBtn'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    packageModalBg: document.getElementById('packageModalBg'),
    packageModalBody: document.getElementById('packageModalBody'),
    packageQrCode: document.getElementById('packageQrCode'),
    packageQrText: document.getElementById('packageQrText'),
    packageQrTextToggle: document.getElementById('packageQrTextToggle'),
    closePackageModalBtn: document.getElementById('closePackageModalBtn'),
    csvOptionsBtn: document.getElementById('csvOptionsBtn'),
    csvOptionsModalBg: document.getElementById('csvOptionsModalBg'),
    csvOptionsSubtext: document.getElementById('csvOptionsSubtext'),
    csvOptionsBody: document.getElementById('csvOptionsBody'),
    csvOptionsSaveBtn: document.getElementById('csvOptionsSaveBtn'),
    csvOptionsCancelBtn: document.getElementById('csvOptionsCancelBtn'),
    scanBtn: document.getElementById('scanBtn'),
    searchOptionsBtn: document.getElementById('searchOptionsBtn'),
    searchOptionsModalBg: document.getElementById('searchOptionsModalBg'),
    searchAlgoList: document.getElementById('searchAlgoList'),
    searchAlgoAddBtn: document.getElementById('searchAlgoAddBtn'),
    searchAlgoExportXmlBtn: document.getElementById('searchAlgoExportXmlBtn'),
    searchAlgoImportInput: document.getElementById('searchAlgoImportInput'),
    searchAlgoImportLog: document.getElementById('searchAlgoImportLog'),
    searchOptionsSaveBtn: document.getElementById('searchOptionsSaveBtn'),
    searchOptionsResetBtn: document.getElementById('searchOptionsResetBtn'),
    searchOptionsCancelBtn: document.getElementById('searchOptionsCancelBtn'),
    scannerModalBg: document.getElementById('scannerModalBg'),
    scannerReaderContainer: document.getElementById('scannerReaderContainer'),
    scannerError: document.getElementById('scannerError'),
    closeScannerBtn: document.getElementById('closeScannerBtn'),
    focusDbBtn: document.getElementById('focusDbBtn'),
    autoDetailsCheckbox: document.getElementById('autoDetailsCheckbox'),
    appVersion: document.getElementById('appVersion'),
    updateAvailableBtn: document.getElementById('updateAvailableBtn'),
    shortcutsOverlay: document.getElementById('shortcutsOverlay'),
  };

  let selectedFiles = [];

  // La base vit désormais dans Vercel Postgres (voir api/db.js / lib/db.js) — plus de tableau
  // complet en mémoire. `currentPageRows` ne contient que la page actuellement affichée (jusqu'à
  // displayLimit lignes), et `unresolvedRows` ne contient que les colis non résolus (numSuivi +
  // transporteur), utilisés par la section scraping/transporteurs (voir computeCarrierGroups plus
  // bas) — un sous-ensemble bien plus petit que la base entière dans le cas courant.
  let currentPageRows = [];
  let currentOffset = 0;
  let currentSearchTotal = 0;
  let unresolvedRows = [];

  // ---------- appels à /api/db (recherche/import/scraping/nettoyage — voir api/db.js) ----------
  async function dbGet(action, params){
    const qs = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/db?${qs.toString()}`, { cache: 'no-store' });
    if(!res.ok){
      const errData = await res.json().catch(() => null);
      throw new Error(errData && errData.error ? errData.error : `HTTP ${res.status}`);
    }
    return res.json();
  }
  async function dbPost(action, body){
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    if(!res.ok){
      const errData = await res.json().catch(() => null);
      throw new Error(errData && errData.error ? errData.error : `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ---------- parseur CSV maison (aucune librairie externe) ----------
  function parseCSV(text){
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for(let i=0; i<text.length; i++){
      const char = text[i];
      const next = text[i+1];
      if(inQuotes){
        if(char === '"'){
          if(next === '"'){ field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += char;
        }
      } else {
        if(char === '"'){
          inQuotes = true;
        } else if(char === ','){
          row.push(field); field = '';
        } else if(char === '\r'){
          // ignore
        } else if(char === '\n'){
          row.push(field); rows.push(row); row = []; field = '';
        } else {
          field += char;
        }
      }
    }
    if(field.length > 0 || row.length > 0){
      row.push(field);
      rows.push(row);
    }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }

  function readFileAsText(file){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = ()=> reject(reader.error);
      reader.readAsText(file, 'UTF-8');
    });
  }

  // ---------- configuration des numéros de colonne (personnalisable via "Options") ----------
  function loadColsConfig(){
    try{
      const raw = localStorage.getItem(COLS_STORAGE_KEY);
      if(!raw) return;
      const saved = JSON.parse(raw);
      COLS.forEach(c=>{
        if(c.col !== null && saved && typeof saved[c.key] === 'number' && saved[c.key] > 0){
          c.col = saved[c.key];
        }
      });
    }catch(e){ /* config invalide, on garde les colonnes par défaut */ }
  }

  function saveColsConfig(){
    const toSave = {};
    COLS.forEach(c=>{ if(c.col !== null) toSave[c.key] = c.col; });
    try{
      localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(toSave));
    }catch(e){ /* stockage indisponible, la config ne sera pas persistée */ }
  }

  loadColsConfig();

  // Nettoie la colonne Num Suivi : retire =, ", ', et les antislash d'échappement
  function cleanNumSuivi(v){
    return String(v ?? '').replace(/[="'\\]/g, '').trim();
  }

  // Extrait le Nom depuis la colonne 7 : le texte trouvé entre le premier "-" et la virgule qui
  // suit, puis on retire "CART'IN" s'il y est (apostrophe droite ou typographique acceptée) —
  // deux formats rencontrés dans ce champ :
  //   "RE2336077 - CART'IN Giovany Salomon, AEIC - ..." -> "Giovany Salomon"
  //   "RE1314927 - Gwenaelle Eleonore, AEIC - ..."       -> "Gwenaelle Eleonore"
  // Si le motif n'est pas trouvé, renvoie ''.
  function extractNomFromCol7(v){
    const str = String(v ?? '');
    const m = str.match(/-(.*?),/);
    if (!m) return '';
    return m[1].replace(/CART['’]IN\s*/i, '').trim();
  }

  // ---------- reconnaissance du numéro de suivi collé / scanné ----------

  // Retire les caractères spéciaux (non alphanumériques) uniquement en tout début et toute fin de
  // la chaîne scannée/collée, sans toucher aux caractères internes.
  function stripSpecialCharsEdges(str){
    return String(str || '').replace(/^[^0-9A-Za-z]+/, '').replace(/[^0-9A-Za-z]+$/, '');
  }

  // Un numéro de suivi calculé correspond-il à une commande déjà présente en base ? (requête
  // serveur — voir action 'exists' dans api/db.js — plus de tableau complet en mémoire à scanner)
  async function trackingExistsInDb(value){
    if(!value) return false;
    try{
      const { exists } = await dbGet('exists', { numSuivi: value });
      return exists;
    }catch(e){
      return false;
    }
  }

  // ---------- moteur générique d'algorithmes de recherche (configurable via "Options") ----------
  // Chaque algorithme (La Poste, Colissimo, GLS, ou un algorithme ajouté par l'utilisateur) est
  // une liste de règles testées dans l'ordre. La première règle dont les conditions correspondent
  // ET dont l'extraction produit un résultat non vide est retenue pour cet algorithme.
  const SEARCH_ALGOS_STORAGE_KEY = 'commandes-search-algos';

  const DEFAULT_SEARCH_ALGORITHMS = [
    {
      id: 'laposte', label: 'La Poste', enabled: true,
      rules: [
        // Code-barres de 32 caractères encadré par % ... ^ (ex. "%000000088000234424817600250A18^").
        // Certains scans ajoutent des caractères après le "^" de fin (ex.
        // "%000000087001431047100601250A10^26646bc") — runSearchAlgorithm() tronque automatiquement
        // à la première occurrence de endsWith avant d'appliquer les règles ci-dessous.
        // Découpage en 2 étapes : on garde les 22 premiers caractères, puis dans ce résultat on
        // garde à partir de la position 9 (14 caractères au final).
        { length: 32, startsWith: '%', endsWith: '^', contentType: 'any', extractType: 'twoStepCut', cut1: 22, cut2: 9 }
      ]
    },
    {
      id: 'colissimo', label: 'Colissimo', enabled: true,
      rules: [
        // Code-barres 1D "Geopost" de 28 caractères débutant par % (étiquette domestique) : digit 1
        // = '%', digits 2-8 = code postal destination, digits 9-10 fixes, digits 11-12 = code
        // produit, digits 13-22 = numéro de série, digits 23-25 = code service, digits 26-28 = code
        // pays. Le numéro de suivi utile occupe les digits 11 à 22 (12 caractères) — voir la note
        // technique GeoLabel de La Poste/Colissimo (ex. "%0010000116C0000148195802250" ->
        // "6C0000148195"). L'ancienne borne (19 au lieu de 22) coupait le numéro 3 caractères trop tôt.
        { length: 28, startsWith: '%', endsWith: '', contentType: 'any', extractType: 'slice', start: 11, end: 22 }
      ]
    },
    {
      // Chronopost et Colissimo partagent la même étiquette/infrastructure Geopost domestique — même
      // règle d'extraction que Colissimo, gardée comme algorithme séparé (plutôt que fusionnée sous
      // un seul id) pour pouvoir l'activer/désactiver ou l'ajuster indépendamment si besoin.
      id: 'chronopost', label: 'Chronopost', enabled: true,
      rules: [
        { length: 28, startsWith: '%', endsWith: '', contentType: 'any', extractType: 'slice', start: 11, end: 22 }
      ]
    },
    {
      id: 'dpd', label: 'DPD', enabled: true,
      rules: [
        // Format officiel DPD (DPD Parcel Label Specification 2.4.1) : texte imprimé sous le
        // code-barres Code 128, entièrement numérique, 28 caractères : "PPPP PPP TTTT TTTT TTTT TT
        // SSS CCC D" = code postal (7) + numéro de suivi (14) + code service (3) + code pays (3) +
        // clé de contrôle (1). Le numéro de suivi utile occupe les positions 8 à 21.
        { length: 28, startsWith: '', endsWith: '', contentType: 'digits', extractType: 'slice', start: 8, end: 21 }
      ]
    },
    {
      id: 'gls', label: 'GLS', enabled: true,
      rules: [
        // Formats GLS trouvés dans la documentation publique (pas de spécification officielle GLS
        // accessible, contrairement à DPD/Colissimo ci-dessus — confiance moindre) : France
        // numérique 11 chiffres (ex. scan à 13 chiffres avec 2 caractères de bruit en fin) et
        // international ~14 chiffres (scan à 16). On garde plusieurs longueurs explicites plutôt
        // qu'une règle sans contrainte, pour éviter de tronquer par erreur un code d'un autre
        // transporteur pas encore reconnu.
        { length: 13, startsWith: '', endsWith: '', contentType: 'digits', extractType: 'removeLast', count: 2 },
        { length: 16, startsWith: '', endsWith: '', contentType: 'digits', extractType: 'removeLast', count: 2 },
        // France alphanumérique 8 caractères (ex. "GL00L5UAZM" -> "00L5UAZM", scan à 10 caractères
        // avec un préfixe de 2 caractères) et format international ~11 caractères (2 lettres + 9
        // chiffres, scan à 13 caractères).
        { length: 10, startsWith: '', endsWith: '', contentType: 'alnum', extractType: 'removeFirst', count: 2 },
        { length: 13, startsWith: '', endsWith: '', contentType: 'alnum', extractType: 'removeFirst', count: 2 }
      ]
    }
  ];

  let SEARCH_ALGORITHMS = DEFAULT_SEARCH_ALGORITHMS.map(a => ({ ...a, rules: a.rules.map(r => ({ ...r })) }));

  function loadSearchAlgorithms(){
    try{
      const raw = localStorage.getItem(SEARCH_ALGOS_STORAGE_KEY);
      if(!raw) return;
      const saved = JSON.parse(raw);
      if(Array.isArray(saved) && saved.length > 0){
        SEARCH_ALGORITHMS = saved;
      }
    }catch(e){ /* config invalide, on garde les algorithmes par défaut */ }
  }

  function saveSearchAlgorithms(){
    try{
      localStorage.setItem(SEARCH_ALGOS_STORAGE_KEY, JSON.stringify(SEARCH_ALGORITHMS));
    }catch(e){ /* stockage indisponible, la config ne sera pas persistée */ }
  }

  loadSearchAlgorithms();

  function contentTypeMatches(str, type){
    if(type === 'digits') return /^[0-9]+$/.test(str);
    if(type === 'alnum') return /^[A-Za-z0-9]+$/.test(str);
    return true; // 'any'
  }

  function ruleConditionsMatch(clean, rule){
    if(rule.length && clean.length !== Number(rule.length)) return false;
    if(rule.startsWith && !clean.startsWith(rule.startsWith)) return false;
    if(rule.endsWith && !clean.endsWith(rule.endsWith)) return false;
    if(rule.contentType && !contentTypeMatches(clean, rule.contentType)) return false;
    return true;
  }

  function applyExtraction(clean, rule){
    switch(rule.extractType){
      case 'slice': {
        const start = Number(rule.start), end = Number(rule.end);
        if(!start || !end || end < start || clean.length < end) return null;
        return clean.slice(start - 1, end);
      }
      case 'removeFirst': {
        const n = Number(rule.count) || 0;
        if(n <= 0 || clean.length <= n) return null;
        return clean.slice(n);
      }
      case 'removeLast': {
        const n = Number(rule.count) || 0;
        if(n <= 0 || clean.length <= n) return null;
        return clean.slice(0, clean.length - n);
      }
      case 'twoStepCut': {
        const cut1 = Number(rule.cut1), cut2 = Number(rule.cut2);
        if(!cut1 || !cut2 || clean.length < cut1) return null;
        const firstPart = clean.slice(0, cut1);
        if(firstPart.length < cut2) return null;
        return firstPart.slice(cut2 - 1);
      }
      default: return null;
    }
  }

  // Exécute un algorithme (liste de règles) sur une valeur brute et renvoie le premier résultat
  // exploitable, ou null si aucune règle ne s'applique / n'aboutit.
  function runSearchAlgorithm(algo, raw){
    if(!algo.enabled) return null;
    const clean = String(raw || '').replace(/\s+/g, '');
    for(const rule of (algo.rules || [])){
      // Certains scans ajoutent des caractères parasites après le marqueur de fin attendu (ex. La
      // Poste : "...250A10^26646bc" au lieu de "...250A10^") — si la règle précise un endsWith, on
      // tronque d'abord à sa première occurrence avant de vérifier la longueur/le contenu.
      let candidate = clean;
      if(rule.endsWith){
        const idx = candidate.indexOf(rule.endsWith);
        if(idx !== -1) candidate = candidate.slice(0, idx + rule.endsWith.length);
      }
      if(!ruleConditionsMatch(candidate, rule)) continue;
      const result = applyExtraction(candidate, rule);
      if(result) return result;
    }
    return null;
  }

  // Détermine le meilleur numéro de suivi à partir d'une valeur scannée/collée : on commence par
  // retirer les caractères spéciaux en tout début/fin et on vérifie si le résultat correspond déjà
  // à une commande en base. Si non, on essaie chaque algorithme configuré (dans l'ordre) et on
  // retient le premier résultat qui correspond à une commande en base. Si aucun ne correspond, on
  // garde un ordre de repli par défaut (strip, puis premier algorithme calculable).
  async function computeBestTracking(raw){
    const stripped = stripSpecialCharsEdges(raw);
    if(stripped && await trackingExistsInDb(stripped)) return stripped;

    const results = SEARCH_ALGORITHMS
      .map(algo => runSearchAlgorithm(algo, raw))
      .filter(v => v);

    for(const v of results){
      if(await trackingExistsInDb(v)) return v;
    }

    return stripped || results[0] || null;
  }

  // Applique la transformation ci-dessus sur le champ de recherche
  async function applyTrackingTransformIfNeeded(){
    const transformed = await computeBestTracking(els.search.value);
    if(transformed){
      els.search.value = transformed;
      render();
      return true;
    }
    return false;
  }

  // ---------- fenêtre "Options" des algorithmes de recherche ----------
  // Copie de travail modifiée librement pendant que la fenêtre est ouverte ; seul un clic sur
  // "Enregistrer" applique les changements à SEARCH_ALGORITHMS et les persiste.
  let draftSearchAlgorithms = [];

  const EXTRACT_TYPE_LABELS = {
    slice: 'Extraire une plage de positions',
    removeFirst: 'Retirer les N premiers caractères',
    removeLast: 'Retirer les N derniers caractères',
    twoStepCut: 'Découpage en 2 étapes',
  };

  function cloneAlgorithms(list){
    return list.map(a => ({ ...a, rules: a.rules.map(r => ({ ...r })) }));
  }

  function newBlankRule(){
    return { length: null, startsWith: '', endsWith: '', contentType: 'any', extractType: 'slice', start: 1, end: 1 };
  }

  function renderSearchAlgoList(){
    els.searchAlgoList.innerHTML = '';

    draftSearchAlgorithms.forEach((algo, algoIdx)=>{
      const card = document.createElement('div');
      card.className = 'search-algo-card';

      const header = document.createElement('div');
      header.className = 'search-algo-header';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'search-algo-name';
      nameInput.value = algo.label;
      nameInput.addEventListener('input', ()=>{ algo.label = nameInput.value; });
      header.appendChild(nameInput);

      const enabledLabel = document.createElement('label');
      const enabledCheckbox = document.createElement('input');
      enabledCheckbox.type = 'checkbox';
      enabledCheckbox.checked = algo.enabled;
      enabledCheckbox.addEventListener('change', ()=>{ algo.enabled = enabledCheckbox.checked; });
      enabledLabel.appendChild(enabledCheckbox);
      enabledLabel.appendChild(document.createTextNode(' Actif'));
      header.appendChild(enabledLabel);

      const removeAlgoBtn = document.createElement('button');
      removeAlgoBtn.type = 'button';
      removeAlgoBtn.className = 'danger search-algo-remove';
      removeAlgoBtn.textContent = '🗑️ Supprimer l\'algorithme';
      removeAlgoBtn.addEventListener('click', ()=>{
        draftSearchAlgorithms.splice(algoIdx, 1);
        renderSearchAlgoList();
      });
      header.appendChild(removeAlgoBtn);

      card.appendChild(header);

      algo.rules.forEach((rule, ruleIdx)=>{
        card.appendChild(buildRuleRow(algo, rule, ruleIdx));
      });

      const addRuleBtn = document.createElement('button');
      addRuleBtn.type = 'button';
      addRuleBtn.className = 'secondary';
      addRuleBtn.textContent = '➕ Ajouter une condition';
      addRuleBtn.addEventListener('click', ()=>{
        algo.rules.push(newBlankRule());
        renderSearchAlgoList();
      });
      card.appendChild(addRuleBtn);

      els.searchAlgoList.appendChild(card);
    });
  }

  function buildRuleRow(algo, rule, ruleIdx){
    const row = document.createElement('div');
    row.className = 'search-rule-row';

    function field(labelText, inputEl){
      const wrap = document.createElement('div');
      wrap.className = 'search-rule-field';
      const label = document.createElement('label');
      label.textContent = labelText;
      wrap.appendChild(label);
      wrap.appendChild(inputEl);
      return wrap;
    }

    const lengthInput = document.createElement('input');
    lengthInput.type = 'number';
    lengthInput.min = '1';
    lengthInput.placeholder = 'Peu importe';
    lengthInput.value = rule.length || '';
    lengthInput.addEventListener('input', ()=>{ rule.length = lengthInput.value ? parseInt(lengthInput.value, 10) : null; });
    row.appendChild(field('Longueur exacte', lengthInput));

    const startsWithInput = document.createElement('input');
    startsWithInput.type = 'text';
    startsWithInput.maxLength = 5;
    startsWithInput.value = rule.startsWith || '';
    startsWithInput.addEventListener('input', ()=>{ rule.startsWith = startsWithInput.value; });
    row.appendChild(field('Commence par', startsWithInput));

    const endsWithInput = document.createElement('input');
    endsWithInput.type = 'text';
    endsWithInput.maxLength = 5;
    endsWithInput.value = rule.endsWith || '';
    endsWithInput.addEventListener('input', ()=>{ rule.endsWith = endsWithInput.value; });
    row.appendChild(field('Termine par', endsWithInput));

    const contentSelect = document.createElement('select');
    [['any','Peu importe'], ['digits','Chiffres uniquement'], ['alnum','Alphanumérique']].forEach(([val, txt])=>{
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = txt;
      if(rule.contentType === val) opt.selected = true;
      contentSelect.appendChild(opt);
    });
    contentSelect.addEventListener('change', ()=>{ rule.contentType = contentSelect.value; });
    row.appendChild(field('Contenu', contentSelect));

    const extractSelect = document.createElement('select');
    Object.entries(EXTRACT_TYPE_LABELS).forEach(([val, txt])=>{
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = txt;
      if(rule.extractType === val) opt.selected = true;
      extractSelect.appendChild(opt);
    });

    const paramsWrap = document.createElement('div');
    paramsWrap.className = 'search-rule-params';

    function renderParams(){
      paramsWrap.innerHTML = '';
      if(rule.extractType === 'slice'){
        const start = document.createElement('input');
        start.type = 'number'; start.min = '1'; start.placeholder = 'Début'; start.value = rule.start || '';
        start.addEventListener('input', ()=>{ rule.start = parseInt(start.value, 10) || null; });
        const end = document.createElement('input');
        end.type = 'number'; end.min = '1'; end.placeholder = 'Fin'; end.value = rule.end || '';
        end.addEventListener('input', ()=>{ rule.end = parseInt(end.value, 10) || null; });
        paramsWrap.appendChild(field('Début', start));
        paramsWrap.appendChild(field('Fin', end));
      }else if(rule.extractType === 'removeFirst' || rule.extractType === 'removeLast'){
        const count = document.createElement('input');
        count.type = 'number'; count.min = '1'; count.placeholder = 'N'; count.value = rule.count || '';
        count.addEventListener('input', ()=>{ rule.count = parseInt(count.value, 10) || null; });
        paramsWrap.appendChild(field('Nombre de caractères', count));
      }else if(rule.extractType === 'twoStepCut'){
        const cut1 = document.createElement('input');
        cut1.type = 'number'; cut1.min = '1'; cut1.placeholder = 'Coupe 1'; cut1.value = rule.cut1 || '';
        cut1.addEventListener('input', ()=>{ rule.cut1 = parseInt(cut1.value, 10) || null; });
        const cut2 = document.createElement('input');
        cut2.type = 'number'; cut2.min = '1'; cut2.placeholder = 'Coupe 2'; cut2.value = rule.cut2 || '';
        cut2.addEventListener('input', ()=>{ rule.cut2 = parseInt(cut2.value, 10) || null; });
        paramsWrap.appendChild(field('Position de coupe 1', cut1));
        paramsWrap.appendChild(field('Position de coupe 2', cut2));
      }
    }
    renderParams();
    extractSelect.addEventListener('change', ()=>{ rule.extractType = extractSelect.value; renderParams(); });

    row.appendChild(field('Extraction', extractSelect));
    row.appendChild(paramsWrap);

    const removeRuleBtn = document.createElement('button');
    removeRuleBtn.type = 'button';
    removeRuleBtn.className = 'secondary search-rule-remove';
    removeRuleBtn.textContent = '✕';
    removeRuleBtn.title = 'Supprimer cette condition';
    removeRuleBtn.addEventListener('click', ()=>{
      algo.rules.splice(ruleIdx, 1);
      renderSearchAlgoList();
    });
    row.appendChild(removeRuleBtn);

    return row;
  }

  function openSearchOptionsModal(){
    draftSearchAlgorithms = cloneAlgorithms(SEARCH_ALGORITHMS);
    renderSearchAlgoList();
    els.searchAlgoImportLog.textContent = '';
    els.searchOptionsModalBg.style.display = 'block';
  }

  function closeSearchOptionsModal(){
    els.searchOptionsModalBg.style.display = 'none';
  }

  els.searchOptionsBtn.addEventListener('click', openSearchOptionsModal);
  els.searchOptionsCancelBtn.addEventListener('click', closeSearchOptionsModal);
  els.searchOptionsModalBg.addEventListener('click', (e)=>{
    if(e.target === els.searchOptionsModalBg) closeSearchOptionsModal();
  });

  // Échappe les caractères spéciaux pour une utilisation en attribut XML
  function escapeXmlAttr(v){
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Construit un document XML représentant la configuration des algorithmes de recherche
  function buildSearchAlgorithmsXml(algorithms){
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<searchAlgorithms>'];
    algorithms.forEach(algo=>{
      lines.push(`  <algorithm id="${escapeXmlAttr(algo.id)}" label="${escapeXmlAttr(algo.label)}" enabled="${algo.enabled ? 'true' : 'false'}">`);
      (algo.rules || []).forEach(rule=>{
        const attrs = [
          `length="${rule.length ?? ''}"`,
          `startsWith="${escapeXmlAttr(rule.startsWith)}"`,
          `endsWith="${escapeXmlAttr(rule.endsWith)}"`,
          `contentType="${escapeXmlAttr(rule.contentType)}"`,
          `extractType="${escapeXmlAttr(rule.extractType)}"`,
          `start="${rule.start ?? ''}"`,
          `end="${rule.end ?? ''}"`,
          `count="${rule.count ?? ''}"`,
          `cut1="${rule.cut1 ?? ''}"`,
          `cut2="${rule.cut2 ?? ''}"`,
        ].join(' ');
        lines.push(`    <rule ${attrs} />`);
      });
      lines.push('  </algorithm>');
    });
    lines.push('</searchAlgorithms>');
    return lines.join('\n');
  }

  function downloadTextFile(filename, content, mime){
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  els.searchAlgoExportXmlBtn.addEventListener('click', ()=>{
    const xml = buildSearchAlgorithmsXml(draftSearchAlgorithms);
    downloadTextFile('algorithmes-recherche-' + new Date().toISOString().slice(0, 10) + '.xml', xml, 'application/xml;charset=utf-8;');
  });

  // Lit un document XML (généré par "Exporter en XML") et reconstruit la liste d'algorithmes
  function parseSearchAlgorithmsXml(text){
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if(doc.querySelector('parsererror')) throw new Error('le fichier XML est mal formé');

    const algoEls = Array.from(doc.querySelectorAll('searchAlgorithms > algorithm'));
    if(algoEls.length === 0) throw new Error('aucun algorithme trouvé dans le fichier');

    return algoEls.map((algoEl, idx)=>{
      const numAttr = (el, name)=>{
        const v = el.getAttribute(name);
        return (v !== null && v !== '') ? Number(v) : null;
      };
      const rules = Array.from(algoEl.querySelectorAll('rule')).map(ruleEl => ({
        length: numAttr(ruleEl, 'length'),
        startsWith: ruleEl.getAttribute('startsWith') || '',
        endsWith: ruleEl.getAttribute('endsWith') || '',
        contentType: ruleEl.getAttribute('contentType') || 'any',
        extractType: ruleEl.getAttribute('extractType') || 'slice',
        start: numAttr(ruleEl, 'start'),
        end: numAttr(ruleEl, 'end'),
        count: numAttr(ruleEl, 'count'),
        cut1: numAttr(ruleEl, 'cut1'),
        cut2: numAttr(ruleEl, 'cut2'),
      }));
      return {
        id: algoEl.getAttribute('id') || ('algo-importe-' + idx),
        label: algoEl.getAttribute('label') || 'Algorithme importé',
        enabled: algoEl.getAttribute('enabled') !== 'false',
        rules,
      };
    });
  }

  els.searchAlgoImportInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;

    els.searchAlgoImportLog.textContent = '';
    try{
      const text = await readFileAsText(file);
      const imported = parseSearchAlgorithmsXml(text);
      draftSearchAlgorithms = imported;
      renderSearchAlgoList();
      els.searchAlgoImportLog.style.color = 'var(--success)';
      els.searchAlgoImportLog.textContent = `${file.name} — ${imported.length} algorithme(s) importé(s). Cliquez sur "Enregistrer" pour appliquer.`;
    }catch(err){
      els.searchAlgoImportLog.style.color = 'var(--danger)';
      els.searchAlgoImportLog.textContent = `${file.name} — échec de l'import (${err && err.message ? err.message : 'fichier invalide'}).`;
    }
    e.target.value = '';
  });

  els.searchAlgoAddBtn.addEventListener('click', ()=>{
    draftSearchAlgorithms.push({
      id: 'algo-' + Date.now(),
      label: 'Nouvel algorithme',
      enabled: true,
      rules: [newBlankRule()],
    });
    renderSearchAlgoList();
  });

  els.searchOptionsSaveBtn.addEventListener('click', ()=>{
    SEARCH_ALGORITHMS = cloneAlgorithms(draftSearchAlgorithms);
    saveSearchAlgorithms();
    closeSearchOptionsModal();
  });

  els.searchOptionsResetBtn.addEventListener('click', ()=>{
    draftSearchAlgorithms = cloneAlgorithms(DEFAULT_SEARCH_ALGORITHMS);
    renderSearchAlgoList();
  });

  // ---------- base de commandes : en mémoire uniquement, aucune sauvegarde automatique ----------
  // À la demande explicite de l'utilisateur, sur tous les appareils (mobile compris) : ni
  // IndexedDB ni localStorage pour la base de commandes elle-même — elle ne vit qu'en mémoire
  // pendant que l'onglet est ouvert, et se reconstitue en réimportant le JSON exporté (boutons
  // Chaque import CSV, résultat de scraping ou nettoyage écrit désormais directement dans Postgres
  // (voir api/db.js) — il n'y a plus de "base en mémoire" à recharger/sauvegarder au sens propre.
  // refreshStats() récupère juste les compteurs globaux (total/résolus), indépendamment de la
  // recherche en cours.
  async function refreshStats(){
    try{
      const { total, resolved } = await dbGet('stats', {});
      els.rowCount.textContent = total;
      els.resolvedCount.textContent = resolved;
      els.resolvedPercent.textContent = total > 0 ? ` (${((resolved / total) * 100).toFixed(2)}%)` : '';
    }catch(e){
      // Échec silencieux : les compteurs restent simplement à leur dernière valeur connue.
    }
  }

  // ---------- gestion des fichiers sélectionnés ----------
  function renderFileList(){
    els.filelist.innerHTML = '';
    selectedFiles.forEach(f=>{
      const li = document.createElement('li');
      li.textContent = f.name;
      els.filelist.appendChild(li);
    });
    els.importBtn.disabled = selectedFiles.length === 0;
  }

  els.fileInput.addEventListener('change', e=>{
    selectedFiles = Array.from(e.target.files);
    renderFileList();
  });
  els.resetSelection.addEventListener('click', ()=>{
    selectedFiles = [];
    els.fileInput.value = '';
    renderFileList();
  });

  // ---------- glisser-déposer ----------
  els.dropzone.addEventListener('click', ()=> els.fileInput.click());

  ['dragenter','dragover'].forEach(evt=>{
    els.dropzone.addEventListener(evt, e=>{
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.add('drag');
    });
  });
  ['dragleave','drop'].forEach(evt=>{
    els.dropzone.addEventListener(evt, e=>{
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.remove('drag');
    });
  });
  els.dropzone.addEventListener('drop', e=>{
    const dropped = Array.from(e.dataTransfer.files || []);
    const csvFiles = dropped.filter(f => f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv');
    if(dropped.length > 0 && csvFiles.length === 0){
      logLine('Aucun fichier .csv valide détecté parmi les fichiers déposés.', true);
      return;
    }
    if(dropped.length > csvFiles.length){
      logLine(`${dropped.length - csvFiles.length} fichier(s) ignoré(s) car non reconnu(s) comme CSV.`, true);
    }
    selectedFiles = csvFiles;
    renderFileList();
  });

  // empêche le navigateur d'ouvrir le fichier s'il est déposé hors de la zone dédiée
  window.addEventListener('dragover', e=> e.preventDefault());
  window.addEventListener('drop', e=> e.preventDefault());

  function logLine(text, isErr){
    const div = document.createElement('div');
    div.textContent = (isErr ? '✕ ' : '✓ ') + text;
    div.className = isErr ? 'err' : 'ok';
    els.log.prepend(div);
    // Le message disparaît tout seul au bout d'1 minute
    setTimeout(()=>{ div.remove(); }, 60000);
  }

  function rowToRecord(row){
    const rec = {};
    COLS.forEach(c=>{
      if(c.col === null){
        rec[c.key] = '';
      }else{
        const raw = row[c.col - 1];
        const v = (raw === undefined || raw === null) ? '' : String(raw).trim();
        if(c.key === 'numSuivi'){
          rec[c.key] = cleanNumSuivi(v);
        }else if(c.key === 'nom'){
          rec[c.key] = extractNomFromCol7(v);
        }else{
          rec[c.key] = v;
        }
      }
    });
    return rec;
  }

  // ---------- fenêtre "Options" : numéro de colonne + aperçu ----------
  // L'aperçu est construit à partir des 100 premières lignes du fichier sélectionné le moins
  // lourd (le plus rapide à lire), pour donner un aperçu représentatif sans ralentir l'ouverture
  // de la fenêtre si plusieurs gros fichiers sont sélectionnés.
  let csvPreviewRows = [];

  function pickLightestSelectedFile(){
    if(selectedFiles.length === 0) return null;
    return selectedFiles.reduce((min, f) => (!min || f.size < min.size) ? f : min, null);
  }

  async function buildCsvPreview(){
    const file = pickLightestSelectedFile();
    if(!file) return null;

    let text;
    try{
      text = await readFileAsText(file);
    }catch(e){
      return null;
    }

    const first100Lines = text.split(/\r\n|\r|\n/).slice(0, 100).join('\n');
    let rows;
    try{
      rows = parseCSV(first100Lines);
    }catch(e){
      rows = [];
    }
    if(els.hasHeader.checked) rows = rows.slice(1);

    return { file, rows };
  }

  function sampleValuesForCol(col){
    if(!col || col < 1) return '—';
    const values = csvPreviewRows
      .map(r => r[col - 1])
      .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
      .slice(0, 5);
    return values.length > 0 ? values.join(' · ') : '—';
  }

  function renderCsvOptionsBody(){
    els.csvOptionsBody.innerHTML = '';
    COLS.forEach(c=>{
      const row = document.createElement('div');
      row.className = 'csv-option-row';

      const label = document.createElement('span');
      label.className = 'csv-option-label';
      label.textContent = c.label;
      row.appendChild(label);

      if(c.col === null){
        const fixed = document.createElement('span');
        fixed.className = 'csv-option-fixed';
        fixed.textContent = 'Champ toujours vide (non importé depuis le CSV)';
        row.appendChild(fixed);
      }else{
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.className = 'csv-option-col-input';
        input.value = c.col;
        input.dataset.key = c.key;
        row.appendChild(input);

        const preview = document.createElement('span');
        preview.className = 'csv-option-preview';
        preview.textContent = sampleValuesForCol(c.col);
        row.appendChild(preview);

        input.addEventListener('input', ()=>{
          const n = parseInt(input.value, 10);
          preview.textContent = sampleValuesForCol(n);
        });
      }

      els.csvOptionsBody.appendChild(row);
    });
  }

  async function openCsvOptionsModal(){
    els.csvOptionsModalBg.style.display = 'block';
    els.csvOptionsSubtext.textContent = 'Chargement de l’aperçu…';
    els.csvOptionsBody.innerHTML = '';

    const preview = await buildCsvPreview();
    csvPreviewRows = preview ? preview.rows : [];

    els.csvOptionsSubtext.textContent = preview
      ? `Aperçu basé sur les ${csvPreviewRows.length} première(s) ligne(s) de « ${preview.file.name} » (fichier sélectionné le moins lourd).`
      : 'Sélectionnez au moins un fichier CSV ci-dessus pour afficher un aperçu des colonnes.';

    renderCsvOptionsBody();
  }

  function closeCsvOptionsModal(){
    els.csvOptionsModalBg.style.display = 'none';
  }

  els.csvOptionsBtn.addEventListener('click', openCsvOptionsModal);
  els.csvOptionsCancelBtn.addEventListener('click', closeCsvOptionsModal);
  els.csvOptionsModalBg.addEventListener('click', (e)=>{
    if(e.target === els.csvOptionsModalBg) closeCsvOptionsModal();
  });
  els.csvOptionsSaveBtn.addEventListener('click', ()=>{
    els.csvOptionsBody.querySelectorAll('input[data-key]').forEach(input=>{
      const n = parseInt(input.value, 10);
      if(n > 0){
        const c = COLS.find(col => col.key === input.dataset.key);
        if(c) c.col = n;
      }
    });
    saveColsConfig();
    closeCsvOptionsModal();
  });

  // Nombre de lignes envoyées par requête à /api/db (action=import-batch) — un compromis entre
  // trop peu de requêtes (gros lots plus longs à traiter dans une seule transaction serverless) et
  // trop de requêtes (surcoût réseau) ; assez petit pour rester largement sous la limite de 4,5 Mo
  // d'une requête entrante Vercel même avec des champs longs.
  const IMPORT_BATCH_SIZE = 500;

  els.importBtn.addEventListener('click', async ()=>{
    if(selectedFiles.length === 0) return;
    els.importBtn.disabled = true;
    let totalAdded = 0;
    let totalUpdated = 0;

    // Première passe : parsing (rapide, local) de tous les fichiers, pour connaître le nombre total
    // de lots à envoyer avant de commencer — la barre de progression peut ainsi refléter l'avancement
    // réel de l'enregistrement en base plutôt que juste "en cours" sans indication.
    const maxColNeeded = Math.max(...COLS.filter(c=>c.col !== null).map(c=>c.col));
    const parsedFiles = [];
    for(const file of selectedFiles){
      let text;
      try{
        text = await readFileAsText(file);
      }catch(e){
        logLine(`${file.name} — échec de la lecture du fichier (${e && e.message ? e.message : 'erreur inconnue'}).`, true);
        continue;
      }

      if(!text || text.trim().length === 0){
        logLine(`${file.name} — le fichier est vide.`, true);
        continue;
      }

      let rows;
      try{
        rows = parseCSV(text);
      }catch(e){
        logLine(`${file.name} — échec de l'analyse du CSV (${e && e.message ? e.message : 'format invalide'}).`, true);
        continue;
      }

      if(!rows || rows.length === 0){
        logLine(`${file.name} — aucune ligne détectée dans le fichier (vérifiez qu'il s'agit bien d'un CSV séparé par des virgules).`, true);
        continue;
      }

      if(els.hasHeader.checked){
        rows = rows.slice(1);
      }

      if(rows.length === 0){
        logLine(`${file.name} — le fichier ne contient que la ligne d'en-tête, aucune donnée à importer.`, true);
        continue;
      }

      let shortRows = 0;
      const recs = [];
      rows.forEach(row=>{
        if(!row || row.every(c => c === '' || c === undefined)) return;
        if(row.length < maxColNeeded) shortRows++;
        recs.push(rowToRecord(row));
      });

      if(recs.length === 0){
        logLine(`${file.name} — 0 ligne ajoutée (toutes les lignes lues étaient vides).`, true);
        continue;
      }

      parsedFiles.push({ file, recs, shortRows });
    }

    const totalBatches = parsedFiles.reduce((sum, f) => sum + Math.ceil(f.recs.length / IMPORT_BATCH_SIZE), 0);
    let batchesDone = 0;

    if(totalBatches > 0){
      showBackupProgress(0, `Enregistrement en base… 0 / ${totalBatches} lot(s)`);
    }

    // Le dédoublonnage (clé N° Commande + Commande Amazon, protection du numéro dernier
    // kilométrique déjà renseigné) est désormais fait côté serveur — voir importBatch dans
    // lib/db.js — pour ne jamais avoir à recharger toute la base en mémoire ici.
    for(const { file, recs, shortRows } of parsedFiles){
      let added = 0, updated = 0, skippedNoKey = 0;
      try{
        for(let i=0; i<recs.length; i+=IMPORT_BATCH_SIZE){
          const batch = recs.slice(i, i + IMPORT_BATCH_SIZE);
          const result = await dbPost('import-batch', { rows: batch });
          added += result.inserted;
          updated += result.updated;
          skippedNoKey += result.skipped;
          batchesDone++;
          showBackupProgress((batchesDone / totalBatches) * 100, `Enregistrement en base… ${batchesDone} / ${totalBatches} lot(s) (${file.name})`);
        }
      }catch(e){
        logLine(`${file.name} — échec de l'enregistrement en base (${e && e.message ? e.message : 'erreur inconnue'}).`, true);
        continue;
      }

      totalAdded += added;
      totalUpdated += updated;
      const parts = [];
      if(added > 0) parts.push(`${added} ajoutée(s)`);
      if(updated > 0) parts.push(`${updated} mise(s) à jour`);
      if(skippedNoKey > 0) parts.push(`${skippedNoKey} ignorée(s) (N° Commande ou Commande Amazon manquant)`);
      logLine(`${file.name} — ${parts.join(', ')}.`, skippedNoKey > 0 && added === 0 && updated === 0);
      if(shortRows > 0){
        logLine(`${file.name} — attention : ${shortRows} ligne(s) ont moins de ${maxColNeeded} colonnes, certains champs ont été laissés vides.`, true);
      }
    }

    if(totalBatches > 0) showBackupProgress(100, 'Mise à jour de l\'affichage…');
    currentOffset = 0;
    await Promise.all([fetchAndRenderPage(), refreshStats(), refreshUnresolvedRows().then(updateCarrierTracking)]);
    hideBackupProgress();

    selectedFiles = [];
    els.fileInput.value = '';
    renderFileList();
    els.importBtn.disabled = false;
    const summaryParts = [];
    if(totalAdded > 0) summaryParts.push(`${totalAdded} ajoutée(s)`);
    if(totalUpdated > 0) summaryParts.push(`${totalUpdated} mise(s) à jour`);
    logLine(`Import terminé — ${summaryParts.join(', ') || '0 commande'} au total.`);

    // Lance automatiquement le scraping AUTO juste après l'import, sans attendre un clic manuel sur
    // "Récupérer AUTO" — carrierGroups vient d'être recalculé juste au-dessus (updateCarrierTracking),
    // scrapeAllCarriers() se contente de ne rien faire s'il n'y a aucun colis non résolu à traiter.
    if(totalBatches > 0) scrapeAllCarriers();
  });

  // ---------- transporteurs pris en charge et gabarits d'URL de suivi ----------
  const CARRIERS = [
    { key:'cainiao',    label:'CAINIAO',    match:['CAINIAO'],                 baseUrl:'https://track.cainiao.com/orderTrack?mailNoList=', kmColIndex:1, mode:'url',
      pasteHint: 'Sur la page de suivi ouverte via « Ouvrir », cliquez sur le bouton « Copy Overview » puis collez le texte copié ci-dessous.',
      scrapeEndpoint: '/api/scrape' },
    { key:'4px',        label:'4PX',        match:['4PX'],                     baseUrl:'https://track.4px.com/#/result/0/',                 kmColIndex:1, mode:'url',
      pasteHint: 'Sur la page de suivi ouverte via « Ouvrir », copiez le numéro de suivi affiché sous « Numéro de suivi » pour chaque colis, puis collez-les ci-dessous au format « numéro de colis<TAB>numéro dernier kilométrique ».',
      scrapeEndpoint: '/api/scrape' },
    { key:'yanwen',     label:'YANWEN',     match:['YANWEN'],                  baseUrl:'https://track.yw56.com.cn/en/querydel?nums=',      kmColIndex:1, mode:'url',
      pasteHint: 'Sur la page de suivi ouverte via « Ouvrir », appuyez sur Entrée puis cliquez sur le bouton de copie des résultats, et collez le texte copié ci-dessous.',
      scrapeEndpoint: '/api/scrape' },
    { key:'yunexpress', label:'Yun Express',match:['YUN EXPRESS','YUNEXPRESS'],baseUrl:'https://www.yuntrack.com/parcelTracking?id=',       kmColIndex:2, mode:'url',
      pasteHint: 'Sur la page de suivi ouverte via « Ouvrir », survolez le bouton « Copy & Export » puis cliquez sur « Copy Summary » dans le menu, et collez le texte copié ci-dessous.',
      scrapeEndpoint: '/api/scrape' },
    { key:'sfc',        label:'SFC',        match:['SFC'],                     baseUrl:'https://www.sendfromchina.com/track',                kmColIndex:2, mode:'clipboard', pasteHasHeader:true, matchColIndex:1,
      scrapeEndpoint: '/api/scrape' },
    { key:'landmark',   label:'LANDMARK',   match:['LANDMARK'],                baseUrl:'https://track.landmarkglobal.com/?search=',          kmColIndex:1, mode:'url', numsSeparator:', ', urlEncodeNums:true, chunkSize:25,
      pasteHint: 'Sur la page de suivi ouverte via « Ouvrir », copiez le résumé des résultats puis collez-le ci-dessous.',
      scrapeEndpoint: '/api/scrape' },
    { key:'topyou',     label:'TopYou',     match:['TOPYOU'],                  baseUrl:'https://track.szty56.com/',                          kmColIndex:1, mode:'clipboard', chunkSize:20,
      pasteHint: 'Collez les numéros copiés dans la zone de recherche de la page (un par ligne), cliquez sur le bouton de recherche, puis copiez les résultats affichés et collez-les ci-dessous.',
      scrapeEndpoint: '/api/scrape' },
    // chunkSize:1 reste nécessaire pour les liens manuels "Ouvrir" (le site n'accepte qu'un seul
    // numéro par lien) ; scrapeChunkSize regroupe en revanche plusieurs numéros par appel de
    // fonction Vercel pour le scraping automatique (lib/scrapers/cne.js boucle en interne sur chaque
    // numéro dans le même navigateur déjà lancé), pour éviter un lancement de navigateur par colis.
    { key:'cne',        label:'CNE',        match:['CNE'],                     baseUrl:'https://www.cne.com/en/track?no=',                   kmColIndex:1, mode:'url', chunkSize:1, scrapeChunkSize:10,
      pasteHint: 'Ce site n\'affiche qu\'un seul colis par lien — ouvrez chaque lien un par un, copiez le numéro dernier kilométrique affiché, puis collez-le ci-dessous.',
      scrapeEndpoint: '/api/scrape' },
    { key:'sunyou',     label:'Sunyou',     match:['SUNYOU'],                  baseUrl:'https://www.sypost.net/search?orderNo=',             kmColIndex:1, mode:'url', numsSeparator:', ', urlEncodeNums:true,
      pasteHint: 'Sur la page de suivi ouverte via « Ouvrir », cliquez sur l\'icône de copie des résultats puis collez le texte copié ci-dessous.',
      scrapeEndpoint: '/api/scrape' },
    // Un seul numéro par lien (chunkSize:1), scrapeChunkSize regroupe malgré tout plusieurs
    // numéros par appel de fonction Vercel (voir lib/scrapers/wanbexpress.js). match:['WANBEXPRESS']
    // : uniquement ce transporteur précis (pas 'WANB' — contrairement à l'ancien OrderTracker,
    // retiré). maxConcurrentScrapes à 4 par prudence plutôt que 6 par défaut — PAGE_POOL_SIZE reste
    // à 1 (lib/scrapers/wanbexpress.js).
    { key:'wanbexpress', label:'WanbExpress', match:['WANBEXPRESS'],           baseUrl:'https://packageradar.com/courier/wanbexpress/tracking/', kmColIndex:1, mode:'url', chunkSize:1, scrapeChunkSize:10,
      maxConcurrentScrapes: 4,
      disableManualImport: true,
      compactLinks: true,
      scrapeEndpoint: '/api/scrape' },
  ];
  const CHUNK_SIZE = 99;

  let carrierGroups = [];   // groupes actuellement présents dans la base (avec numéros + chunks)
  let activeCarrierKey = null;
  let pastedTextByCarrier = {};   // key -> texte collé (conservé lors du changement d'onglet)
  let importLogByCarrier = {};    // key -> { text, err }
  let scrapeProgressByCarrier = {}; // key -> { done, total } pendant un scraping 4PX en cours, sinon absent
  let modalOpenUrl = '';          // URL à ouvrir via le bouton "Ouvrir" de la fenêtre modale

  function normCarrierName(v){
    return String(v || '').trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---------- association manuelle valeur brute de transporteur -> transporteur connu ----------
  // Par défaut, une commande est rattachée à un transporteur connu (CARRIERS) si sa valeur brute de
  // colonne "transporteur" correspond exactement (après normalisation) à l'une des entrées de
  // c.match. Cette association manuelle permet de forcer le rattachement pour des valeurs brutes qui
  // ne correspondent à aucune entrée exacte (variantes d'orthographe, etc.), sans toucher au code.
  const CARRIER_MAPPING_KEY = 'commandes-carrier-mapping';

  // GOFO a été retiré de l'application (plus d'onglet ni de rôle de vérification finale) — plus
  // aucune association par défaut n'est donc nécessaire ici. Reste vide pour compatibilité avec
  // resolveCarrierKeysForRow ; la fenêtre "⚙ Transporteurs" permet toujours une association
  // manuelle vers n'importe quel autre transporteur si besoin.
  const DEFAULT_CARRIER_MAPPING = {};

  function loadCarrierMapping(){
    try{
      const raw = localStorage.getItem(CARRIER_MAPPING_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch(e){
      return {};
    }
  }

  function saveCarrierMapping(mapping){
    carrierMapping = mapping;
    try{ localStorage.setItem(CARRIER_MAPPING_KEY, JSON.stringify(mapping)); }catch(e){ /* stockage indisponible */ }
  }

  let carrierMapping = loadCarrierMapping();

  // Une commande peut appartenir à PLUSIEURS transporteurs à la fois : par exemple une valeur brute
  // "LANDMARK" est à la fois suivie par son propre transporteur dédié (correspondance automatique
  // par nom) ET par GOFO (liste par défaut ci-dessus) — le colis est alors scrappé deux fois,
  // volontairement, GOFO servant d'étape de vérification finale en plus du suivi spécifique.
  // Une association manuelle enregistrée via la fenêtre "⚙ Transporteurs" remplace entièrement ce
  // calcul automatique pour la valeur brute concernée (tableau vide = exclue de tout transporteur).
  function resolveCarrierKeysForRow(r){
    const raw = String(r.transporteur || '').trim();
    if(!raw) return [];
    const rawKey = raw.toUpperCase();

    if(Object.prototype.hasOwnProperty.call(carrierMapping, rawKey)){
      const v = carrierMapping[rawKey];
      return Array.isArray(v) ? v : (v ? [v] : []);
    }

    const keys = new Set();
    const normalized = normCarrierName(raw);
    const found = CARRIERS.find(c => c.match.includes(normalized));
    if(found) keys.add(found.key);
    if(DEFAULT_CARRIER_MAPPING[rawKey]) keys.add(DEFAULT_CARRIER_MAPPING[rawKey]);
    return Array.from(keys);
  }

  function chunkArray(arr, size){
    const out = [];
    for(let i=0; i<arr.length; i+=size) out.push(arr.slice(i, i+size));
    return out;
  }

  // Construit l'URL de suivi groupé pour un transporteur en mode 'url'. Par défaut les numéros sont
  // simplement joints par une virgule (4PX/YANWEN/Yun Express). LANDMARK attend en revanche
  // "numéro1, numéro2" encodé en URL (%2C+) — voir g.numsSeparator / g.urlEncodeNums dans CARRIERS.
  function buildCarrierTrackingUrl(g, nums){
    const joined = nums.join(g.numsSeparator || ',');
    return g.baseUrl + (g.urlEncodeNums ? encodeURIComponent(joined) : joined);
  }

  // ---------- inclusion des colis "non scannés" (sans numéro dernier kilométrique) ----------
  // GOFO sert de dernière étape de vérification pour tout colis dont le numéro dernier kilométrique
  // n'a pas encore été trouvé, quel que soit le transporteur auquel il est normalement rattaché — ce
  // comportement est activé par défaut pour GOFO, mais peut aussi être activé pour n'importe quel
  // autre transporteur (YANWEN, etc.) via la case à cocher dans son onglet.
  const CARRIER_INCLUDE_UNRESOLVED_KEY = 'commandes-carrier-include-unresolved';

  function loadCarrierIncludeUnresolved(){
    try{
      const raw = localStorage.getItem(CARRIER_INCLUDE_UNRESOLVED_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch(e){
      return {};
    }
  }

  function saveCarrierIncludeUnresolved(map){
    carrierIncludeUnresolved = map;
    try{ localStorage.setItem(CARRIER_INCLUDE_UNRESOLVED_KEY, JSON.stringify(map)); }catch(e){ /* stockage indisponible */ }
  }

  let carrierIncludeUnresolved = loadCarrierIncludeUnresolved();

  function carrierIncludesUnresolved(key){
    return !!carrierIncludeUnresolved[key]; // décoché par défaut pour tous les transporteurs, y compris GOFO
  }

  // Prédicat unique décidant si une commande appartient au groupe d'un transporteur donné —
  // partagé entre le calcul des groupes (computeCarrierGroups) et le rattachement des résultats
  // scrapés/collés (applyScrapedResultsToDb / handleImportPaste), pour rester cohérent : sinon les
  // colis "non résolus" inclus dans un groupe (ex. GOFO) ne seraient jamais retrouvés au moment
  // d'enregistrer le résultat du scraping.
  function rowBelongsToCarrierGroup(r, c){
    if(resolveCarrierKeysForRow(r).includes(c.key)) return true;
    if(carrierIncludesUnresolved(c.key) && !String(r.numDernierKm || '').trim()) return true;
    return false;
  }

  // unresolvedRows ne contient QUE les colis non résolus (numSuivi + transporteur, voir
  // refreshUnresolvedRows) — remplace le scan complet de la base, la seule chose dont le
  // scraping/import manuel a besoin de toute façon (une commande déjà résolue n'a rien à faire ici).
  function computeCarrierGroups(){
    return CARRIERS.map(c=>{
      const nums = Array.from(new Set(
        unresolvedRows
          .filter(r => rowBelongsToCarrierGroup(r, c))
          .map(r => cleanNumSuivi(r.numSuivi)).filter(v => v.length > 0)
      ));
      return { ...c, nums, chunks: chunkArray(nums, c.chunkSize || CHUNK_SIZE) };
    }).filter(g => g.nums.length > 0)
      .sort((a, b) => b.nums.length - a.nums.length); // le plus de colis d'abord
  }

  // Récupère TOUS les colis non résolus (par lots, voir action 'unresolved-rows' dans api/db.js) —
  // appelé au chargement puis après tout import/scraping/nettoyage qui peut faire évoluer ce
  // sous-ensemble, PAS à chaque frappe de recherche (contrairement à l'ancien computeCarrierGroups
  // qui rescannait toute la base à chaque render()).
  async function refreshUnresolvedRows(){
    // Pagination par curseur (id > afterId), pas par offset — reste rapide même très loin dans une
    // grosse base (voir le même principe côté serveur dans lib/db.js, unresolvedRows).
    const rows = [];
    let afterId = 0;
    for(;;){
      const page = await dbGet('unresolved-rows', { limit: 5000, afterId });
      if(!page.rows || page.rows.length === 0) break;
      rows.push(...page.rows);
      afterId = page.rows[page.rows.length - 1].id;
      if(page.rows.length < 5000) break;
    }
    unresolvedRows = rows;
  }

  // ---------- fenêtre d'association manuelle transporteur ----------
  let draftCarrierMapping = {};
  let transporteurCounts = []; // [{transporteur, count}] — chargé à l'ouverture de la fenêtre (voir openCarrierMappingModal)

  function renderCarrierMappingList(){
    const rawValues = transporteurCounts.map(t => t.transporteur).sort((a, b) => a.localeCompare(b));

    if(rawValues.length === 0){
      els.carrierMappingList.innerHTML = '<p style="font-size:13px; color:var(--muted);">Aucune valeur de transporteur trouvée en base.</p>';
      return;
    }

    els.carrierMappingList.innerHTML = rawValues.map(raw=>{
      const rawKey = raw.toUpperCase();
      const count = (transporteurCounts.find(t => t.transporteur === raw) || {}).count || 0;

      // Une valeur brute peut être cochée pour plusieurs transporteurs à la fois (ex. "LANDMARK" est
      // suivi à la fois par son transporteur dédié ET par GOFO, volontairement) — reflète soit une
      // association manuelle déjà enregistrée pour cette ligne, soit la détection automatique
      // (correspondance de nom + éventuelle liste GOFO par défaut).
      let currentKeys;
      if(Object.prototype.hasOwnProperty.call(draftCarrierMapping, rawKey)){
        const v = draftCarrierMapping[rawKey];
        currentKeys = Array.isArray(v) ? v : (v ? [v] : []);
      }else{
        const keys = new Set();
        const found = (CARRIERS.find(c => c.match.includes(normCarrierName(raw))) || {}).key;
        if(found) keys.add(found);
        if(DEFAULT_CARRIER_MAPPING[rawKey]) keys.add(DEFAULT_CARRIER_MAPPING[rawKey]);
        currentKeys = Array.from(keys);
      }

      const checkboxesHtml = CARRIERS.map(c=>
        `<label style="font-size:12px; display:flex; align-items:center; gap:4px; white-space:nowrap;">
          <input type="checkbox" class="carrierMapCheckbox" data-raw="${escapeHtmlAttr(rawKey)}" data-carrier="${c.key}" ${currentKeys.includes(c.key) ? 'checked' : ''}>
          ${c.label}
        </label>`
      ).join('');

      return `<div class="row carrierMapRow" style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border); flex-wrap:wrap;">
        <span style="flex:1; min-width:160px; font-size:13px;">${raw} <span style="color:var(--muted);">(${count})</span></span>
        <span style="display:flex; gap:10px; flex-wrap:wrap;">${checkboxesHtml}</span>
      </div>`;
    }).join('');

    els.carrierMappingList.querySelectorAll('.carrierMapCheckbox').forEach(cb=>{
      cb.addEventListener('change', ()=>{
        const rawKey = cb.dataset.raw;
        // Cases indépendantes (pas un choix exclusif) : dès qu'on touche une case de la ligne, on
        // enregistre explicitement la liste actuelle de cases cochées comme association manuelle
        // pour cette valeur brute (un tableau vide = exclue de tout transporteur).
        const row = cb.closest('.carrierMapRow');
        const checkedKeys = Array.from(row.querySelectorAll('.carrierMapCheckbox'))
          .filter(other => other.checked)
          .map(other => other.dataset.carrier);
        draftCarrierMapping[rawKey] = checkedKeys;
      });
    });
  }

  function escapeHtmlAttr(v){
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  async function openCarrierMappingModal(){
    draftCarrierMapping = { ...carrierMapping };
    els.carrierMappingList.innerHTML = '<p style="font-size:13px; color:var(--muted);">Chargement…</p>';
    els.carrierMappingModalBg.style.display = 'block';
    try{
      const { transporteurs } = await dbGet('distinct-transporteurs', {});
      transporteurCounts = transporteurs;
    }catch(e){
      transporteurCounts = [];
    }
    renderCarrierMappingList();
  }

  function closeCarrierMappingModal(){
    els.carrierMappingModalBg.style.display = 'none';
  }

  els.carrierMappingBtn.addEventListener('click', openCarrierMappingModal);
  els.carrierMappingCancelBtn.addEventListener('click', closeCarrierMappingModal);
  els.carrierMappingModalBg.addEventListener('click', (e)=>{
    if(e.target === els.carrierMappingModalBg) closeCarrierMappingModal();
  });
  els.carrierMappingSaveBtn.addEventListener('click', ()=>{
    saveCarrierMapping({ ...draftCarrierMapping });
    updateCarrierTracking();
    closeCarrierMappingModal();
  });

  function getActiveGroup(){
    return carrierGroups.find(g => g.key === activeCarrierKey) || carrierGroups[0] || null;
  }

  // Favicons officiels récupérés depuis le site de chaque transporteur (assets/carrier-logos/).
  const CARRIER_LOGO_FILES = {
    'cainiao': 'cainiao.png', '4px': '4px.png', 'yanwen': 'yanwen.ico', 'yunexpress': 'yunexpress.ico',
    'sfc': 'sfc.png', 'landmark': 'landmark.png', 'topyou': 'topyou.ico', 'cne': 'cne.png', 'sunyou': 'sunyou.png',
  };

  function renderCarrierTabs(){
    els.carrierTabs.innerHTML = '';
    carrierGroups.forEach(g=>{
      const btn = document.createElement('button');
      const logoFile = CARRIER_LOGO_FILES[g.key];
      const logoHtml = logoFile ? `<img src="assets/carrier-logos/${logoFile}" alt="" class="carrier-tab-logo">` : '';
      btn.innerHTML = `${logoHtml}${g.label} (${g.nums.length})`;
      if(g.key === activeCarrierKey) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        activeCarrierKey = g.key;
        renderCarrierTabs();
        renderCarrierPanel();
      });
      els.carrierTabs.appendChild(btn);
    });
  }

  // Analyse générique du texte collé : colonne matchColIndex (0-based) = numéro de suivi (clé de correspondance),
  // colonne kmColIndex (0-based) = numéro dernier kilométrique.
  // 4PX / YANWEN -> correspondance colonne 1, valeur colonne 2. Yun Express -> valeur colonne 3.
  // SFC -> correspondance colonne 2 (AE Order No.), valeur colonne 3 (Tracking No.).
  function parseTrackingPaste(text, kmColIndex, skipHeader, matchColIndex){
    matchColIndex = matchColIndex || 0;
    let lines = text.split('\n').map(l => l.replace(/\r$/, ''));

    if(skipHeader){
      const firstNonEmpty = lines.findIndex(l => l.trim().length > 0);
      if(firstNonEmpty !== -1) lines.splice(firstNonEmpty, 1); // retire la ligne d'en-tête
    }

    const updates = [];
    lines.forEach(line=>{
      const trimmed = line.trim();
      if(trimmed.length === 0) return;
      if(/^=+$/.test(trimmed)) return;                 // ligne séparatrice ======
      if(/^Powered by/i.test(trimmed)) return;          // pied de page Cainiao

      let parts = line.split('\t');
      if(parts.length < 2){
        parts = line.trim().split(/\s{2,}/);            // repli : séparation par espaces multiples
      }
      const trackingNumber = parts.length > matchColIndex ? cleanNumSuivi(parts[matchColIndex]) : '';
      if(!trackingNumber) return;

      let lastKm = parts.length > kmColIndex ? String(parts[kmColIndex]) : '';
      lastKm = lastKm.replace(/^'+/, '');                // retire l'apostrophe de tête (YANWEN)
      lastKm = lastKm.replace(/["=\\]/g, '').trim();     // retire = " ' \

      if(!lastKm || /^\(?unknown\)?$/i.test(lastKm)){
        lastKm = '';
      }
      updates.push({ trackingNumber, lastKm });
    });
    return updates;
  }

  // Avant d'enregistrer un numéro dernier kilométrique (scraping automatique ou import manuel) :
  // uniquement alphanumérique, doit contenir au moins un chiffre. Pas de contrainte sur le nombre
  // de lettres — des formats réels à une seule lettre existent (ex. "S7650086988394310" chez 4PX),
  // rejetés à tort par une version précédente de cette règle qui exigeait au moins 2 lettres. Même
  // règle appliquée côté serveur (voir applyScrapeResults dans lib/db.js).
  function isValidNumDernierKm(v){
    const s = String(v || '').trim();
    if(!s) return false;
    if(!/^[A-Za-z0-9]+$/.test(s)) return false;
    return /\d/.test(s);
  }

  // Partagé entre l'import manuel (handleImportPaste) et le scraping automatique
  // (scrapeCarrierViaVercel, appelé lot par lot) : ne retient que les numéros appartenant à ce
  // transporteur parmi les colis non résolus connus côté client (unresolvedRows), valides (voir
  // isValidNumDernierKm), puis les enregistre en base (protection numDernierKm assurée
  // côté serveur, qui ne touche que les colis encore non résolus) et met à jour l'état local.
  async function applyUpdatesToUnresolved(g, updates){
    const updateMap = new Map();
    updates.forEach(u => { if(u.trackingNumber) updateMap.set(cleanNumSuivi(u.trackingNumber), u.lastKm); });

    const results = [];
    unresolvedRows.forEach(r=>{
      if(!rowBelongsToCarrierGroup(r, g)) return;
      const key = cleanNumSuivi(r.numSuivi);
      if(updateMap.has(key) && isValidNumDernierKm(updateMap.get(key))){
        results.push({ numSuivi: key, numDernierKm: updateMap.get(key) });
      }
    });

    let matched = 0;
    if(results.length > 0){
      const res = await dbPost('apply-scrape-results', { results });
      matched = res.updated;
      const matchedKeys = new Set(results.map(r => r.numSuivi));
      unresolvedRows = unresolvedRows.filter(r => !matchedKeys.has(cleanNumSuivi(r.numSuivi)));
    }
    return matched;
  }

  async function handleImportPaste(g){
    const pasteArea = document.getElementById('pasteArea');
    const text = pasteArea ? pasteArea.value : '';

    if(!text.trim()){
      importLogByCarrier[g.key] = { text: "Collez des données avant d'importer.", err: true };
      renderCarrierPanel();
      return;
    }

    const updates = parseTrackingPaste(text, g.kmColIndex, g.pasteHasHeader, g.matchColIndex);
    if(updates.length === 0){
      importLogByCarrier[g.key] = { text: 'Aucune ligne exploitable trouvée dans le texte collé.', err: true };
      renderCarrierPanel();
      return;
    }

    let matched = 0;
    try{
      matched = await applyUpdatesToUnresolved(g, updates);
    }catch(e){
      importLogByCarrier[g.key] = { text: `Échec de l'enregistrement en base (${e && e.message ? e.message : 'erreur inconnue'}).`, err: true };
      renderCarrierPanel();
      return;
    }

    const notFound = Math.max(0, updates.length - matched);

    pastedTextByCarrier[g.key] = ''; // vide le champ après un import terminé avec succès

    importLogByCarrier[g.key] = {
      text: `${matched} commande(s) mise(s) à jour dans la base.` + (notFound > 0 ? ` ${notFound} numéro(s) collé(s) sans correspondance dans la base pour ${g.label}.` : ''),
      err: false
    };
    updateCarrierTracking();
    refreshStats();
    render();
  }

  // ---------- import du numéro dernier kilométrique via l'API 4PX ----------
  // Réglages de scraping partagés par tous les transporteurs pris en charge (4PX, YANWEN, ...) :
  // seuls les délais d'attente sont configurables ici — l'URL de la fonction de scraping est fixe
  // par transporteur (champ "scrapeEndpoint" dans CARRIERS), une fonction backend étant dédiée à
  // chacun (logique de clic différente selon le site de suivi).
  const SCRAPE_CONFIG_KEY = 'scrape-config';

  function loadScrapeConfig(){
    try{
      const raw = localStorage.getItem(SCRAPE_CONFIG_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch(e){
      return {};
    }
  }

  function saveScrapeConfig(config){
    try{
      localStorage.setItem(SCRAPE_CONFIG_KEY, JSON.stringify(config));
    }catch(e){ /* stockage indisponible, la config ne sera pas persistée */ }
  }

  function openScrapeConfigModal(){
    const config = loadScrapeConfig();
    els.fourPxPageLoadWaitMs.value = config.pageLoadWaitMs || 4000;
    els.fourPxClickWaitMs.value = config.clickWaitMs || 600;
    els.fourPxApiConfigModalBg.style.display = 'block';
  }

  function closeScrapeConfigModal(){
    els.fourPxApiConfigModalBg.style.display = 'none';
  }

  els.fourPxApiConfigCancelBtn.addEventListener('click', closeScrapeConfigModal);
  els.fourPxApiConfigModalBg.addEventListener('click', (e)=>{
    if(e.target === els.fourPxApiConfigModalBg) closeScrapeConfigModal();
  });
  els.fourPxApiConfigSaveBtn.addEventListener('click', ()=>{
    saveScrapeConfig({
      pageLoadWaitMs: parseInt(els.fourPxPageLoadWaitMs.value, 10) || 4000,
      clickWaitMs: parseInt(els.fourPxClickWaitMs.value, 10) || 600,
    });
    closeScrapeConfigModal();
  });

  // ---------- scraping via une fonction backend Vercel (4PX, YANWEN, ...) ----------
  // Un unique endpoint /api/scrape (voir g.scrapeEndpoint dans CARRIERS) dispatche vers le module
  // du bon transporteur selon le champ "carrier" du corps de la requête (voir api/scrape.js et
  // lib/scrapers/*.js) — regroupé ainsi plutôt qu'une fonction par transporteur pour rester sous la
  // limite de fonctions serverless du plan Vercel Hobby (12 max). Chaque module ouvre réellement sa
  // page de suivi dans un navigateur headless, clique sur le bon bouton de copie et
  // lit le texte copié dans le presse-papier du navigateur headless. Toutes renvoient le même
  // format, déjà découpé selon la règle de l'import manuel : { results: [{ trackingNumber, lastKm }, ...] }.
  //
  // Comme pour les liens "Ouvrir" (voir g.chunks / CHUNK_SIZE), on scrape par lots de 99 colis
  // maximum plutôt qu'un seul très gros lot : le site de suivi peut limiter/tronquer le nombre de
  // numéros pris en compte par requête, et une URL avec des centaines de numéros peut poser
  // problème. Les lots sont scrapés en parallèle (un appel de fonction Vercel par lien), puis fusionnés.
  // Limite le nombre de requêtes de scraping en vol simultanément. Avec des transporteurs à des
  // milliers de lots (WANBEXPRESS : un lien par colis, regroupés seulement par 10 — voir
  // scrapeChunkSize), envoyer toutes les requêtes d'une seule salve dépasse largement la limite de
  // connexions simultanées par origine du navigateur (~6) et sature les fonctions Vercel, faisant
  // échouer une grande partie en timeout au lieu de les traiter par vagues.
  // Valeur volontairement agressive (au prix d'un risque plus élevé de timeout/plantage si Vercel
  // ou le site cible sature — accepté explicitement pour privilégier la vitesse).
  const MAX_CONCURRENT_SCRAPES = 6;

  async function runWithConcurrencyLimit(items, limit, worker){
    const results = new Array(items.length);
    let nextIndex = 0;
    async function runNext(){
      while(nextIndex < items.length){
        const idx = nextIndex++;
        results[idx] = await worker(items[idx], idx).then(
          value => ({ status: 'fulfilled', value }),
          reason => ({ status: 'rejected', reason })
        );
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
    return results;
  }

  async function scrapeCarrierViaVercel(g){
    const config = loadScrapeConfig();
    const scrapeEndpoint = g.scrapeEndpoint;
    // scrapeChunkSize permet de regrouper différemment pour le scraping automatique que pour les
    // liens manuels "Ouvrir" (voir g.chunks / chunkSize) — utilisé par CNE, dont le site n'accepte
    // qu'un seul numéro par lien manuel mais dont la fonction Vercel peut traiter plusieurs numéros
    // dans le même navigateur déjà lancé.
    const chunks = g.scrapeChunkSize
      ? chunkArray(g.nums, g.scrapeChunkSize)
      : ((g.chunks && g.chunks.length > 0) ? g.chunks : [g.nums]);

    scrapeProgressByCarrier[g.key] = { done: 0, total: chunks.length };
    // g.maxConcurrentScrapes permet à un transporteur de réduire cette limite par défaut (voir
    // l'entrée 'wanbexpress' dans CARRIERS) quand trop d'invocations Vercel simultanées finissent
    // par saturer le CPU partagé de la fonction (plusieurs onglets Chromium lents à charger en
    // même temps) ou par déclencher un ralentissement du site cible face à trop de requêtes
    // concurrentes depuis la même origine.
    const concurrencyLimit = g.maxConcurrentScrapes || MAX_CONCURRENT_SCRAPES;
    importLogByCarrier[g.key] = {
      text: `Scraping ${g.label} (via Vercel) en cours` + (chunks.length > 1 ? ` — ${chunks.length} liens traités par vagues de ${concurrencyLimit}` : '') + ` (peut prendre du temps pour un grand nombre de colis)…`,
      err: false
    };
    renderCarrierPanel();

    // Chaque lot est appliqué et enregistré en base DÈS qu'il termine (au lieu d'accumuler tous les
    // résultats et de tout écrire une seule fois à la toute fin) : sur un transporteur avec des
    // milliers de lots, attendre la fin complète avant la moindre écriture retardait beaucoup trop
    // les compteurs (#rowCount/#resolvedCount restaient à 0% pendant des heures) et risquait de
    // perdre tout le travail déjà scrapé si l'onglet était fermé avant la fin.
    let totalMatched = 0;
    const chunkErrors = [];

    const chunkOutcomes = await runWithConcurrencyLimit(chunks, concurrencyLimit, async (chunk) => {
      try{
        const res = await fetch(scrapeEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            carrier: g.key,
            trackingNumbers: chunk,
            pageLoadWaitMs: config.pageLoadWaitMs || 4000,
            clickWaitMs: config.clickWaitMs || 600,
          }),
        });
        const json = await res.json();
        if(!res.ok) throw new Error(json && json.error ? json.error : `réponse HTTP ${res.status}`);

        // On réanalyse le texte brut copié avec exactement le même algorithme que le bouton
        // "Importer" (parseTrackingPaste + le kmColIndex/matchColIndex propre à ce transporteur),
        // plutôt que de faire confiance au découpage générique (colonne 0/1) fait côté serveur —
        // qui ne correspond pas forcément à la mise en page réelle du texte copié (ex. Yun Express).
        const updates = (typeof json.rawText === 'string' && json.rawText.trim())
          ? parseTrackingPaste(json.rawText, g.kmColIndex, g.pasteHasHeader, g.matchColIndex)
          : (Array.isArray(json.results) ? json.results : []);

        if(updates.length === 0){
          // Ordre de priorité : un vrai problème (blocage anti-bot ou changement de structure)
          // prime sur un état légitime et temporaire (noDataInfo, stillProcessingInfo) — voir
          // lib/scrapers/wanbexpress.js, qui distingue ces cas
          // selon le contenu réel de la page/réponse API.
          const debug = json.debug || {};
          const debugText = json.debug ? JSON.stringify(json.debug).slice(0, 300) : '(pas de diagnostic disponible)';
          if(debug.antiBotBlockWarning) throw new Error(`⚠️ ${debug.antiBotBlockWarning}`);
          if(debug.structureChangeWarning) throw new Error(`⚠️ ${debug.structureChangeWarning}`);
          if(debug.noDataInfo) throw new Error(`ℹ️ ${debug.noDataInfo}`);
          if(debug.stillProcessingInfo) throw new Error(`ℹ️ ${debug.stillProcessingInfo}`);
          throw new Error(`aucun résultat exploitable (${debugText})`);
        }

        const matched = await applyUpdatesToUnresolved(g, updates);
        totalMatched += matched;
        return matched;
      }finally{
        // Un lot vient de se terminer (succès ou échec) : on avance la barre de progression et on
        // rafraîchit les compteurs globaux + la liste des transporteurs restants, en direct.
        const progress = scrapeProgressByCarrier[g.key];
        if(progress){
          progress.done++;
          importLogByCarrier[g.key] = {
            text: `Scraping ${g.label} (via Vercel) en cours — ${progress.done} / ${progress.total} lien(s) traité(s), ${totalMatched} colis mis à jour jusqu'ici…`,
            err: false
          };
          renderCarrierPanel();
          refreshStats();
        }
      }
    });

    scrapeProgressByCarrier[g.key] = null;
    updateCarrierTracking();
    render();

    chunkOutcomes.forEach((outcome, idx)=>{
      if(outcome.status === 'rejected'){
        const reason = outcome.reason && outcome.reason.message ? outcome.reason.message : 'échec inconnu';
        chunkErrors.push(`lien ${idx + 1}/${chunks.length} : ${reason}`);
      }
    });

    if(totalMatched === 0 && chunkErrors.length === chunks.length){
      importLogByCarrier[g.key] = {
        text: `Le scraping n'a renvoyé aucun résultat exploitable.` + (chunkErrors.length > 0 ? ` ${chunkErrors.join(' | ')}` : ''),
        err: true
      };
      renderCarrierPanel();
      return 0;
    }

    importLogByCarrier[g.key] = {
      text: `${totalMatched} commande(s) mise(s) à jour via ${g.sourceLabel || 'le scraping Vercel'}${chunks.length > 1 ? ` (${chunks.length} liens)` : ''}.`
        + (chunkErrors.length > 0 ? ` ⚠️ ${chunkErrors.length} lien(s) en échec : ${chunkErrors.join(' | ')}` : ''),
      err: false
    };
    renderCarrierPanel();

    return totalMatched;
  }

  // Lance scrapeCarrierViaVercel() pour tous les transporteurs pris en charge (ceux ayant des colis
  // en base et une fonction de scraping dédiée), en parallèle — plutôt que de cliquer un par un sur
  // chaque onglet.
  async function scrapeAllCarriers(){
    const eligible = carrierGroups.filter(g => g.scrapeEndpoint && g.nums && g.nums.length > 0);

    if(eligible.length === 0){
      els.scrapeAllLog.textContent = 'Aucun transporteur avec scraping disponible et des colis en base pour le moment.';
      return;
    }

    els.scrapeAllBtn.disabled = true;
    els.scrapeAllBtn.classList.remove('scrape-all-success', 'scrape-all-error');
    els.scrapeAllProgressWrap.style.display = 'block';
    els.scrapeAllProgressBar.style.width = '0%';
    els.scrapeAllLog.textContent = `Scraping en cours pour ${eligible.length} transporteur(s) : ${eligible.map(g => g.label).join(', ')}…`;

    let done = 0;
    const outcomes = await Promise.allSettled(eligible.map(async g => {
      const matched = await scrapeCarrierViaVercel(g);
      done++;
      els.scrapeAllProgressBar.style.width = `${Math.round((done / eligible.length) * 100)}%`;
      return matched || 0;
    }));

    els.scrapeAllBtn.disabled = false;
    const anyFailure = outcomes.some(o => o.status === 'rejected')
      || eligible.some(g => importLogByCarrier[g.key] && importLogByCarrier[g.key].err);
    els.scrapeAllBtn.classList.add(anyFailure ? 'scrape-all-error' : 'scrape-all-success');
    els.scrapeAllLog.textContent = `Scraping terminé pour : ${eligible.map(g => g.label).join(', ')}. Voir le détail dans l'onglet de chaque transporteur.`;

    const totalUpdated = outcomes.reduce((sum, o) => sum + (o.status === 'fulfilled' ? o.value : 0), 0);
    els.carrierSectionUpdatedCount.textContent = ` (${totalUpdated} colis mis à jour)`;

    renderCarrierPanel();
  }

  els.scrapeAllBtn.addEventListener('click', scrapeAllCarriers);

  async function copyTextToClipboard(text){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    }catch(e){
      try{
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      }catch(e2){
        return false;
      }
    }
  }

  function renderCarrierPanel(){
    const g = getActiveGroup();
    if(!g){ els.carrierPanel.innerHTML = ''; return; }
    activeCarrierKey = g.key;

    const openLabel = g.mode === 'clipboard' ? '📋🔗 Copier + Ouvrir' : '🔗 Ouvrir';
    // compactLinks : certains sites n'acceptent qu'un seul numéro par lien (chunkSize:1), ce qui
    // donnerait jusqu'à plusieurs centaines de lignes complètes — on affiche alors une simple grille
    // de petits boutons numérotés (10 par rangée), un par lien, plutôt qu'une ligne par lien.
    const linksHtml = g.compactLinks
      ? `<div class="carrier-compact-links" style="display:grid; grid-template-columns:repeat(10, minmax(0, 1fr)); gap:4px; max-width:420px; margin:8px 0;">
          ${g.chunks.map((chunk, idx)=>
            `<button class="linkOpenBtn" data-idx="${idx}" title="Colis ${idx+1} : ${chunk[0]}" style="font-size:11px; padding:2px 0; min-width:0;">${idx+1}</button>`
          ).join('')}
        </div>`
      : g.chunks.map((chunk, idx)=>
          `<div class="carrier-link-row">
            <span class="carrier-link-label">Lien ${idx+1} — ${chunk.length} colis</span>
            <button class="linkOpenBtn" data-idx="${idx}">${openLabel}</button>
            <button class="linkShowBtn" data-idx="${idx}">👁️ Afficher</button>
          </div>`
        ).join('');

    const log = importLogByCarrier[g.key];
    const logHtml = log ? `<div style="font-size:12px; margin-top:6px; color:${log.err ? 'var(--danger)' : 'var(--success)'};">${log.text}</div>` : '';

    const noteHtml = g.mode === 'clipboard'
      ? `<p style="font-size:12px; color:var(--muted); margin-top:4px;">Le bouton « ${openLabel} » copie les numéros de colis dans le presse-papier puis ouvre la page de suivi ${g.label} — collez-les directement sur le site.</p>`
      : '';

    const pasteHintHtml = g.pasteHint
      ? `<p style="font-size:12px; color:var(--muted); margin-top:4px;">${g.pasteHint}</p>`
      : '';

    const scrapeProgress = g.scrapeEndpoint ? scrapeProgressByCarrier[g.key] : null;
    const scrapeProgressHtml = scrapeProgress
      ? `<div style="margin-top:10px;">
          <div style="height:8px; background:var(--border); border-radius:4px; overflow:hidden;">
            <div style="height:100%; width:${Math.round((scrapeProgress.done / scrapeProgress.total) * 100)}%; background:var(--primary); transition:width .3s ease;"></div>
          </div>
          <div style="font-size:12px; color:var(--muted); margin-top:4px;">${scrapeProgress.done} / ${scrapeProgress.total} lien(s) traité(s)</div>
        </div>`
      : '';

    const scrapeSectionHtml = g.scrapeEndpoint
      ? `<div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
          <label style="font-size:13px;">Ou importer directement le numéro dernier kilométrique par scraping automatique</label>
          <div class="actions">
            <button id="carrierScrapeBtn" type="button" ${scrapeProgress ? 'disabled' : ''}>${scrapeProgress ? '⏳ Récupération en cours…' : '🤖 ' + (g.scrapeButtonLabel || 'Scrapping (Vercel)')}</button>
            <button id="carrierScrapeConfigBtn" type="button" class="secondary" ${scrapeProgress ? 'disabled' : ''}>⚙️ Config Scraping</button>
          </div>
          ${scrapeProgressHtml}
        </div>`
      : '';

    const manualImportHtml = g.disableManualImport ? '' : `
      <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
        <label style="font-size:13px;">Coller les données de suivi ${g.label} (max 10000 caractères) puis cliquer sur Importer</label>
        ${pasteHintHtml}
        <div class="row">
          <textarea id="pasteArea" maxlength="10000" rows="5" style="width:100%; font-size:12px; padding:8px;" placeholder="Collez ici les données copiées depuis la page de suivi ${g.label}…"></textarea>
        </div>
        <div class="actions"><button id="importPasteBtn">📋 Importer</button></div>
      </div>`;

    const includeUnresolvedHtml = `
      <label style="font-size:12px; display:flex; align-items:center; gap:6px; margin:4px 0 8px;">
        <input type="checkbox" id="includeUnresolvedCheckbox" ${carrierIncludesUnresolved(g.key) ? 'checked' : ''}>
        Inclure aussi les colis sans numéro dernier kilométrique des autres transporteurs (${g.label} comme étape de vérification finale)
      </label>`;

    els.carrierPanel.innerHTML = `
      <p style="font-size:13px; color:var(--muted);">
        ${g.nums.length} numéro(s) de suivi trouvé(s) pour ${g.label}${g.chunks.length > 1 ? `, répartis en ${g.chunks.length} liens (max ${CHUNK_SIZE} par lien)` : ''}.
      </p>
      ${includeUnresolvedHtml}
      ${linksHtml}
      ${noteHtml}
      ${manualImportHtml}
      ${scrapeSectionHtml}
      ${logHtml}
    `;

    const pasteArea = document.getElementById('pasteArea');
    if(pasteArea){
      pasteArea.value = pastedTextByCarrier[g.key] || '';
      pasteArea.addEventListener('input', ()=>{ pastedTextByCarrier[g.key] = pasteArea.value; });
    }

    document.getElementById('includeUnresolvedCheckbox').addEventListener('change', (e)=>{
      saveCarrierIncludeUnresolved({ ...carrierIncludeUnresolved, [g.key]: e.target.checked });
      updateCarrierTracking();
    });

    els.carrierPanel.querySelectorAll('.linkOpenBtn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const idx = parseInt(btn.dataset.idx, 10);
        if(g.mode === 'clipboard'){
          const ok = await copyTextToClipboard(g.chunks[idx].join('\n'));
          btn.textContent = ok ? 'Copié !' : 'Échec de la copie';
          window.open(g.baseUrl, '_blank');
          setTimeout(()=>{ btn.textContent = openLabel; }, 1500);
        }else{
          window.open(buildCarrierTrackingUrl(g, g.chunks[idx]), '_blank');
        }
      });
    });
    els.carrierPanel.querySelectorAll('.linkShowBtn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const idx = parseInt(btn.dataset.idx, 10);
        const chunkInfo = g.chunks.length > 1 ? ` (lien ${idx+1}/${g.chunks.length})` : '';
        els.trackingModalTitle.textContent = `Suivi groupé — ${g.label}${chunkInfo}`;

        if(g.mode === 'clipboard'){
          els.trackingBoxLabel.textContent = 'Numéros de colis (un par ligne)';
          els.trackingCount.textContent = `${g.chunks[idx].length} numéro(s) de colis ${g.label} — copiez-les puis collez-les sur la page de suivi.`;
          els.trackingUrlBox.value = g.chunks[idx].join('\n');
          modalOpenUrl = g.baseUrl;
        }else{
          els.trackingBoxLabel.textContent = 'URL de suivi';
          els.trackingCount.textContent = `${g.chunks[idx].length} numéro(s) de suivi groupé(s) dans ce lien.`;
          const url = buildCarrierTrackingUrl(g, g.chunks[idx]);
          els.trackingUrlBox.value = url;
          modalOpenUrl = url;
        }
        els.trackingModalBg.style.display = 'block';
      });
    });

    const importPasteBtn = document.getElementById('importPasteBtn');
    if(importPasteBtn) importPasteBtn.addEventListener('click', ()=> handleImportPaste(g));

    if(g.scrapeEndpoint){
      document.getElementById('carrierScrapeBtn').addEventListener('click', ()=> scrapeCarrierViaVercel(g));
      document.getElementById('carrierScrapeConfigBtn').addEventListener('click', openScrapeConfigModal);
    }
  }

  function updateCarrierTracking(){
    carrierGroups = computeCarrierGroups();

    if(carrierGroups.length === 0){
      els.carrierSection.style.display = 'none';
      activeCarrierKey = null;
      return;
    }

    if(!carrierGroups.some(g => g.key === activeCarrierKey)){
      activeCarrierKey = carrierGroups[0].key;
    }

    els.carrierSection.style.display = 'block';
    renderCarrierTabs();
    renderCarrierPanel();
  }

  els.closeModalBtn.addEventListener('click', ()=>{
    els.trackingModalBg.style.display = 'none';
  });
  els.trackingModalBg.addEventListener('click', (e)=>{
    if(e.target === els.trackingModalBg) els.trackingModalBg.style.display = 'none';
  });

  function closePackageModal(){
    els.packageModalBg.style.display = 'none';
    els.search.focus();
  }

  els.closePackageModalBtn.addEventListener('click', closePackageModal);
  els.packageModalBg.addEventListener('click', (e)=>{
    if(e.target === els.packageModalBg) closePackageModal();
  });

  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape') return;
    if(els.packageModalBg.style.display === 'block'){
      closePackageModal();
      // Spécifique à la fermeture par Échap (contrairement au bouton "✕ Fermer" ou au clic en
      // dehors) : on vide aussi la recherche, pour repartir d'un champ propre pour le colis suivant.
      els.search.value = '';
      render();
    }else if(els.trackingModalBg.style.display === 'block'){
      els.trackingModalBg.style.display = 'none';
    }else if(els.csvOptionsModalBg.style.display === 'block'){
      closeCsvOptionsModal();
    }else if(els.searchOptionsModalBg.style.display === 'block'){
      closeSearchOptionsModal();
    }else if(els.fourPxApiConfigModalBg.style.display === 'block'){
      closeScrapeConfigModal();
    }else if(els.exportCodeModalBg.style.display === 'block'){
      closeExportCodeModal();
    }else if(els.scannerModalBg && els.scannerModalBg.style.display === 'block'){
      stopScanner();
    }else if(els.search.value){
      // Aucune fenêtre ouverte : Échap vide le champ de recherche
      els.search.value = '';
      render();
    }
  });

  // Raccourci dédié "²" (position physique Backquote, quel que soit l'agencement du clavier — même
  // logique que e.code plus bas) pour actionner le switch QR code / texte sans avoir à cliquer,
  // pratique quand on scanne colis après colis. Actif uniquement fiche colis ouverte.
  document.addEventListener('keydown', (e)=>{
    if(e.code !== 'Backquote') return;
    if(els.packageModalBg.style.display !== 'block') return;
    e.preventDefault();
    els.packageQrTextToggle.checked = !els.packageQrTextToggle.checked;
    applyPackageQrDisplayMode();
  });

  // Raccourcis clavier ALT+<lettre>, actifs où qu'on soit sur la page. On utilise e.code (position
  // physique de la touche) plutôt que e.key pour que ça marche quel que soit l'agencement du
  // clavier (AZERTY, QWERTY…). Chaque raccourci réutilise le bouton déjà câblé correspondant
  // (.click()) plutôt que de dupliquer sa logique — s'il est désactivé/masqué, le clic ne fait
  // simplement rien.
  const KEYBOARD_SHORTCUTS = [
    { code:'KeyO', label:'Ouvrir le sélecteur de fichiers CSV', run: () => els.dropzone.click() },
    { code:'KeyA', label:'Ajouter à la base de données',        run: () => els.importBtn.click() },
    { code:'KeyR', label:'Tout récupérer (scraping)',           run: () => els.scrapeAllBtn.click() },
    { code:'KeyQ', label:'Rechercher (curseur dans le champ)',  run: () => { els.search.focus(); els.search.select(); } },
    { code:'KeyS', label:'Scanner un code-barres / QR code',    run: () => els.scanBtn.click() },
    { code:'KeyE', label:'Exporter la base (.aiae)',            run: () => els.exportJsonEncryptedBtn.click() },
    { code:'KeyJ', label:'Actualiser depuis la base',           run: () => els.importBackupBtn.click() },
    { code:'KeyT', label:'Verrouiller / déverrouiller',         run: () => els.focusDbBtn.click() },
  ];

  // Étiquette affichée par défaut (position QWERTY de la touche, ex. "KeyQ" -> "Q") — mise à jour
  // ci-dessous dès qu'on connaît la vraie disposition, pour éviter d'afficher "Alt+Q" à un
  // utilisateur AZERTY dont cette touche physique porte en réalité la lettre "A" (et inversement).
  const shortcutDisplayKeys = {};
  KEYBOARD_SHORTCUTS.forEach(s => { shortcutDisplayKeys[s.code] = s.code.replace('Key', ''); });

  // Affiche un rappel des raccourcis disponibles tant que la touche Alt est maintenue seule —
  // comme les indices de touche d'accès de Windows — pour qu'ils restent découvrables sans avoir
  // à les mémoriser à l'avance.
  function renderShortcutsOverlay(){
    els.shortcutsOverlay.innerHTML = `
      <div class="shortcuts-overlay-title">Raccourcis clavier (maintenez Alt)</div>
      <div class="shortcuts-overlay-list">
        ${KEYBOARD_SHORTCUTS.map(s => `
          <div class="shortcuts-overlay-item">
            <span class="shortcuts-kbd"><kbd class="shortcut-key">Alt</kbd>+<kbd class="shortcut-key">${shortcutDisplayKeys[s.code]}</kbd></span>
            <span>${s.label}</span>
          </div>
        `).join('')}
      </div>
    `;
  }
  renderShortcutsOverlay();

  // Les raccourcis restent liés à la position physique de la touche (e.code) pour fonctionner
  // quelle que soit la disposition, mais la LETTRE AFFICHÉE doit correspondre à ce qui est
  // réellement imprimé dessus. Chrome/Edge exposent la vraie disposition active via
  // KeyboardLayoutMap : on l'utilise dès qu'elle est disponible pour corriger l'affichage.
  if(navigator.keyboard && navigator.keyboard.getLayoutMap){
    navigator.keyboard.getLayoutMap()
      .then(layoutMap => {
        let changed = false;
        KEYBOARD_SHORTCUTS.forEach(s => {
          const real = layoutMap.get(s.code);
          if(real && real.toUpperCase() !== shortcutDisplayKeys[s.code]){
            shortcutDisplayKeys[s.code] = real.toUpperCase();
            changed = true;
          }
        });
        if(changed) renderShortcutsOverlay();
      })
      .catch(() => { /* API indisponible/refusée : on garde les lettres QWERTY par défaut */ });
  }

  let shortcutsOverlayVisible = false;
  function showShortcutsOverlay(){
    if(shortcutsOverlayVisible) return;
    shortcutsOverlayVisible = true;
    els.shortcutsOverlay.classList.add('visible');
    els.shortcutsOverlay.setAttribute('aria-hidden', 'false');
  }
  function hideShortcutsOverlay(){
    if(!shortcutsOverlayVisible) return;
    shortcutsOverlayVisible = false;
    els.shortcutsOverlay.classList.remove('visible');
    els.shortcutsOverlay.setAttribute('aria-hidden', 'true');
  }

  document.addEventListener('keydown', (e)=>{
    // Alt seul (sans autre touche) : affiche le rappel des raccourcis. On bloque le comportement
    // par défaut du navigateur (bascule de la barre de menu sur Firefox/Windows) pour cette seule
    // pression, sans gêner les combinaisons Alt+lettre ci-dessous.
    if(e.key === 'Alt'){
      if(!e.repeat) showShortcutsOverlay();
      e.preventDefault();
      return;
    }
    if(!e.altKey || e.ctrlKey || e.metaKey) return;
    const shortcut = KEYBOARD_SHORTCUTS.find(s => s.code === e.code);
    if(!shortcut) return;
    e.preventDefault();
    // Repli pour les navigateurs sans KeyboardLayoutMap (Firefox, Safari) : la touche qu'on vient
    // réellement d'appuyer nous dit elle-même quelle lettre y est imprimée sur cette disposition.
    if(/^[a-zA-Z]$/.test(e.key) && e.key.toUpperCase() !== shortcutDisplayKeys[shortcut.code]){
      shortcutDisplayKeys[shortcut.code] = e.key.toUpperCase();
      renderShortcutsOverlay();
    }
    shortcut.run();
  });

  document.addEventListener('keyup', (e)=>{
    if(e.key !== 'Alt') return;
    e.preventDefault();
    hideShortcutsOverlay();
  });

  // Défensif : si la fenêtre perd le focus pendant qu'Alt est maintenu (ex. Alt+Tab), aucun
  // keyup n'est reçu — sans ça le rappel resterait affiché indéfiniment.
  window.addEventListener('blur', hideShortcutsOverlay);

  // Coller n'importe où sur la page colle directement dans le champ de recherche, sauf si on a
  // déjà le focus sur un champ éditable (recherche elle-même, zone de collage transporteur, etc.),
  // auquel cas on laisse le comportement natif de collage du champ actif. En mode plein écran de
  // la section 3, cette exception saute : tout collage va dans la recherche, quel que soit le
  // champ actif (les seuls champs visibles dans ce mode sont de toute façon liés à cette section).
  document.addEventListener('paste', async (e)=>{
    const active = document.activeElement;
    const isEditable = active && (
      active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
    );
    const forceToSearch = document.body.classList.contains('focus-mode') && active !== els.search;
    if(isEditable && !forceToSearch) return;
    const text = (e.clipboardData || window.clipboardData)?.getData('text');
    if(!text) return;
    e.preventDefault();
    els.search.value = text;
    els.search.focus();
    if(!(await applyTrackingTransformIfNeeded())) render();
  });

  els.copyUrlBtn.addEventListener('click', async ()=>{
    const ok = await copyTextToClipboard(els.trackingUrlBox.value);
    els.copyUrlBtn.textContent = ok ? 'Copié !' : 'Échec de la copie';
    setTimeout(()=> els.copyUrlBtn.textContent = 'Copier', 1200);
  });

  els.modalCopyIconBtn.addEventListener('click', async ()=>{
    const ok = await copyTextToClipboard(els.trackingUrlBox.value);
    els.modalCopyIconBtn.textContent = ok ? '✓' : '⧉';
    els.modalCopyIconBtn.classList.toggle('copied', ok);
    setTimeout(()=>{ els.modalCopyIconBtn.textContent = '⧉'; els.modalCopyIconBtn.classList.remove('copied'); }, 1200);
  });

  els.openUrlBtn.addEventListener('click', ()=>{
    if(modalOpenUrl) window.open(modalOpenUrl, '_blank');
  });

  const CARRIER_BADGE_COLORS = {
    '4PX': { bg:'#fdece0', fg:'#c2540a' },
    'CAINIAO': { bg:'#fef2e0', fg:'#a15c00' },
    'TOPYOU': { bg:'#eafaf6', fg:'#0d9488' },
    'CNE': { bg:'#f0f4ff', fg:'#3730a3' },
    'SUNYOU': { bg:'#fff9db', fg:'#996a00' },
    'YANWEN': { bg:'#e8f3ff', fg:'#1d4ed8' },
    'YUN EXPRESS': { bg:'#eafbf1', fg:'#0f8a4c' },
    'SFC': { bg:'#f3e8ff', fg:'#7e22ce' },
    'LANDMARK': { bg:'#eef2ff', fg:'#4338ca' },
  };
  function badgeColorsFor(transporteur){
    const norm = normCarrierName(transporteur);
    return CARRIER_BADGE_COLORS[norm] || { bg:'#f3f4f6', fg:'#4b5563' };
  }

  // Construit un span copiable : texte + icône de copie visible au survol
  function createCopySpan(value, extraClass){
    const wrap = document.createElement('span');
    wrap.className = 'copy-field' + (extraClass ? ' ' + extraClass : '');
    const textNode = document.createElement('span');
    textNode.textContent = value;
    wrap.appendChild(textNode);

    if(value){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-icon';
      btn.title = 'Copier';
      btn.textContent = '⧉';
      btn.addEventListener('click', async (e)=>{
        e.stopPropagation();
        const ok = await copyTextToClipboard(value);
        btn.textContent = ok ? '✓' : '⧉';
        btn.classList.toggle('copied', ok);
        setTimeout(()=>{ btn.textContent = '⧉'; btn.classList.remove('copied'); }, 900);
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  // QTE et QTE_EXPED sont comparées (numériquement si possible, sinon en texte) pour les colorer :
  // vert si elles correspondent, rouge sinon. Partagé entre la liste et la fiche détaillée.
  function computeQtyMatchClass(qteRaw, qteExpRaw){
    const qteNum = Number(String(qteRaw ?? '').trim());
    const qteExpNum = Number(String(qteExpRaw ?? '').trim());
    const bothNumeric = String(qteRaw ?? '').trim() !== '' && String(qteExpRaw ?? '').trim() !== ''
      && !Number.isNaN(qteNum) && !Number.isNaN(qteExpNum);
    const qteMatch = bothNumeric
      ? qteNum === qteExpNum
      : String(qteRaw ?? '').trim() === String(qteExpRaw ?? '').trim() && String(qteRaw ?? '').trim() !== '';
    return qteMatch ? 'qty-match' : 'qty-mismatch';
  }

  // Une cellule = étiquette (visible en mobile, masquée en tableau desktop) + contenu. `display:contents`
  // en CSS mobile laisse les deux rejoindre directement la grille à 2 colonnes de `.db-card` ; en
  // desktop, `.db-cell` redevient une colonne du tableau et l'étiquette est masquée (voir styles.css).
  function buildDbCell(label, contentEl, extraClass){
    const cell = document.createElement('div');
    cell.className = 'db-cell' + (extraClass ? ' ' + extraClass : '');
    const labelEl = document.createElement('span');
    labelEl.className = 'db-cell-label';
    labelEl.textContent = label;
    cell.appendChild(labelEl);
    cell.appendChild(contentEl);
    return cell;
  }

  function buildDbCard(r){
    const card = document.createElement('div');
    card.className = 'db-card';
    card.addEventListener('click', ()=> openPackageModal(r));

    let carrierContent;
    if(r.transporteur){
      const colors = badgeColorsFor(r.transporteur);
      const badge = document.createElement('span');
      badge.className = 'carrier-badge';
      badge.style.background = colors.bg;
      badge.style.color = colors.fg;
      badge.textContent = r.transporteur;
      carrierContent = badge;
    }else{
      carrierContent = document.createElement('span');
      carrierContent.className = 'db-cell-empty';
      carrierContent.textContent = '—';
    }
    card.appendChild(buildDbCell('Transporteur', carrierContent));

    card.appendChild(buildDbCell('N° Commande', createCopySpan(r.numCommande || '—')));
    card.appendChild(buildDbCell('Commande Amazon', createCopySpan(r.commandeAmazon || '—')));

    const qty = document.createElement('span');
    qty.className = computeQtyMatchClass(r.qteCommande, r.qteExpedie);
    qty.textContent = `${r.qteCommande || '—'} / ${r.qteExpedie || '—'}`;
    card.appendChild(buildDbCell('Qté / Exp.', qty));

    card.appendChild(buildDbCell('Num Suivi', createCopySpan(r.numSuivi || '—'), 'db-cell-mono'));

    const nom = document.createElement('span');
    nom.textContent = r.nom || '—';
    if(!r.nom) nom.className = 'db-cell-empty';
    card.appendChild(buildDbCell('Nom', nom));

    card.appendChild(buildDbCell(
      'Num dernier km',
      createCopySpan(r.numDernierKm || '—', r.numDernierKm ? 'db-cell-bold' : 'db-cell-empty'),
      'db-cell-mono'
    ));

    return card;
  }

  // ---------- fenêtre de détails d'un colis (clic sur une carte) ----------
  function openPackageModal(r){
    const qteClass = computeQtyMatchClass(r.qteCommande, r.qteExpedie);

    const fields = [
      { label:'N° Commande',               value:r.numCommande },
      { label:'Commande Amazon',           value:r.commandeAmazon },
      { label:'Num Suivi',                 value:r.numSuivi },
      { label:'Transporteur',              value:r.transporteur, key:'transporteur' },
      { label:'Nom',                       value:r.nom ? r.nom.toUpperCase() : r.nom },
      { label:'QTE',                       value:r.qteCommande, extraClass: qteClass },
      { label:'QTE_EXPED',                 value:r.qteExpedie,  extraClass: qteClass },
      { label:'Num dernier kilométrique',  value:r.numDernierKm, extraClass: 'package-detail-bold' },
    ];

    els.packageModalBody.innerHTML = '';
    fields.forEach(f=>{
      const row = document.createElement('div');
      row.className = 'package-detail-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'package-detail-label';
      labelEl.textContent = f.label;
      row.appendChild(labelEl);

      if(f.key === 'transporteur' && f.value){
        // Même style que le badge affiché dans les cartes de la base de données (couleur par
        // transporteur, voir badgeColorsFor), plutôt qu'un simple texte copiable.
        const colors = badgeColorsFor(f.value);
        const badge = document.createElement('span');
        badge.className = 'carrier-badge';
        badge.style.background = colors.bg;
        badge.style.color = colors.fg;
        badge.textContent = f.value;
        row.appendChild(badge);
      }else{
        row.appendChild(createCopySpan(f.value || '—', f.extraClass));
      }
      els.packageModalBody.appendChild(row);
    });

    // QR code encodant le numéro de suivi (permet de le rescanner plus tard)
    els.packageQrCode.innerHTML = '';
    if(r.numSuivi && typeof QRCode !== 'undefined'){
      try{
        new QRCode(els.packageQrCode, {
          text: r.numSuivi,
          width: 128,
          height: 128,
          colorDark: '#1f2937',
          colorLight: '#ffffff'
        });
      }catch(e){ /* génération QR indisponible, on ignore silencieusement */ }
    }

    els.packageQrText.innerHTML = '';
    [
      { label:'Num Suivi', value:r.numSuivi },
      { label:'Num dernier kilométrique', value:r.numDernierKm },
    ].forEach(f=>{
      const line = document.createElement('div');
      const labelEl = document.createElement('span');
      labelEl.className = 'package-qr-text-label';
      labelEl.textContent = f.label + ' :';
      line.appendChild(labelEl);
      line.appendChild(document.createTextNode(f.value || '—'));
      els.packageQrText.appendChild(line);
    });

    applyPackageQrDisplayMode();

    els.packageModalBg.style.display = 'block';
  }

  // Bascule entre le QR code et le texte (numéro de suivi + numéro dernier kilométrique) selon
  // l'état de l'interrupteur, à côté du QR code dans la fiche colis.
  function applyPackageQrDisplayMode(){
    const showText = els.packageQrTextToggle.checked;
    els.packageQrCode.style.display = showText ? 'none' : '';
    els.packageQrText.style.display = showText ? '' : 'none';
  }
  els.packageQrTextToggle.addEventListener('change', applyPackageQrDisplayMode);

  // ---------- scanner caméra (code-barres / QR code) ----------
  let scannerInstance = null;
  let scannerStopping = false;

  function scannerFormats(){
    if(typeof Html5QrcodeSupportedFormats === 'undefined') return undefined;
    return [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.CODABAR,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
    ];
  }

  async function stopScanner(){
    if(scannerStopping) return;
    scannerStopping = true;
    if(scannerInstance){
      try{
        await scannerInstance.stop();
        scannerInstance.clear();
      }catch(e){ /* déjà arrêté ou jamais démarré */ }
      scannerInstance = null;
    }
    els.scannerModalBg.style.display = 'none';
    els.scannerError.style.display = 'none';
    els.scannerReaderContainer.innerHTML = '';
    scannerStopping = false;
  }

  async function startScanner(){
    if(typeof Html5Qrcode === 'undefined'){
      setDbLog("La bibliothèque de scan (html5-qrcode) n'a pas pu être chargée — vérifiez votre connexion internet.", true);
      return;
    }

    els.scannerError.style.display = 'none';
    els.scannerModalBg.style.display = 'block';
    scannerInstance = new Html5Qrcode('scannerReaderContainer', {
      formatsToSupport: scannerFormats(),
      verbose: false,
      // Utilise l'API native BarcodeDetector du navigateur quand disponible (Chrome/Edge Android
      // notamment) au lieu du décodeur JS (ZXing) — bien plus rapide et fiable, en particulier sur
      // les codes-barres 1D abîmés/reflétants, puisqu'il s'appuie sur l'accélération matérielle du
      // téléphone plutôt que sur du traitement d'image pur JS.
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });

    try{
      await scannerInstance.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          // Zone de scan plus large (surtout en largeur) : un code-barres 1D est souvent bien plus
          // large que haut, une zone carrée de 250x150 le recadrait inutilement et faisait échouer
          // la lecture si le code ne rentrait pas entièrement dedans.
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const size = Math.min(viewfinderWidth, viewfinderHeight);
            return { width: Math.round(size * 0.85), height: Math.round(size * 0.5) };
          },
          videoConstraints: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            advanced: [{ focusMode: 'continuous' }],
          },
        },
        async (decodedText)=>{
          // une valeur a été détectée : on arrête le scan et on colle la valeur dans la recherche
          stopScanner();
          const transformed = await computeBestTracking(decodedText);
          els.search.value = transformed || decodedText;
          els.search.dispatchEvent(new Event('input'));
          els.search.focus();
        },
        ()=>{ /* échecs de lecture image par image : ignorés silencieusement */ }
      );
    }catch(err){
      els.scannerError.textContent = `Impossible d'accéder à la caméra (${err && err.message ? err.message : 'permission refusée ou aucune caméra détectée'}).`;
      els.scannerError.style.display = 'block';
    }
  }

  els.scanBtn.addEventListener('click', startScanner);
  els.closeScannerBtn.addEventListener('click', stopScanner);
  els.scannerModalBg.addEventListener('click', (e)=>{
    if(e.target === els.scannerModalBg) stopScanner();
  });

  // ---------- affichage liste (recherche + pagination côté serveur, voir action 'search' dans
  // api/db.js) : plus de tableau complet en mémoire à filtrer/trier à chaque frappe, on ne
  // récupère que la page courante. ----------
  let searchRequestSeq = 0; // ignore une réponse arrivée en retard si une recherche plus récente a été lancée entre-temps

  async function fetchAndRenderPage(){
    const term = els.search.value.trim();
    const limit = parseInt(els.displayLimit.value, 10) || 10;
    const mySeq = ++searchRequestSeq;

    let result;
    try{
      result = await dbGet('search', { q: term, limit, offset: currentOffset });
    }catch(e){
      if(mySeq !== searchRequestSeq) return;
      els.dbCards.innerHTML = '';
      els.dbCards.style.display = 'none';
      els.emptyState.textContent = `Erreur de recherche (${e && e.message ? e.message : 'erreur inconnue'}).`;
      els.emptyState.style.display = 'block';
      return;
    }
    if(mySeq !== searchRequestSeq) return; // une recherche plus récente a déjà pris le relais

    currentPageRows = result.rows;
    currentSearchTotal = result.total;

    if(term && els.autoDetailsCheckbox.checked && document.body.classList.contains('focus-mode') && currentSearchTotal === 1 && currentPageRows.length === 1){
      if(autoOpenedRecord !== currentPageRows[0]){
        autoOpenedRecord = currentPageRows[0];
        openPackageModal(currentPageRows[0]);
      }
    }else{
      // La recherche ne correspond plus à un seul colis (0 ou plusieurs résultats) : si une fiche
      // avait été ouverte automatiquement pour une recherche précédente, elle affichait un colis
      // périmé, sans rapport avec la nouvelle recherche — on la referme.
      if(autoOpenedRecord && els.packageModalBg.style.display === 'block'){
        closePackageModal();
      }
      autoOpenedRecord = null;
    }

    els.dbCards.innerHTML = '';
    currentPageRows.forEach(r=> els.dbCards.appendChild(buildDbCard(r)));

    const showList = currentPageRows.length > 0;
    els.dbCards.style.display = showList ? 'flex' : 'none';
    els.emptyState.style.display = showList ? 'none' : 'block';
    els.emptyState.textContent = term
      ? 'Aucun résultat pour cette recherche.'
      : 'Aucune commande en base pour le moment. Importez un CSV pour commencer.';

    els.count.textContent = currentSearchTotal > 0 ? `${currentSearchTotal} résultat(s) pour cette recherche` : '';

    const totalPages = Math.max(1, Math.ceil(currentSearchTotal / limit));
    const currentPageNum = Math.floor(currentOffset / limit) + 1;
    els.pageInfo.textContent = currentSearchTotal > 0 ? `Page ${currentPageNum} / ${totalPages}` : '';
    els.prevPageBtn.disabled = currentOffset <= 0;
    els.nextPageBtn.disabled = (currentOffset + limit) >= currentSearchTotal;
  }

  // Débounce léger sur la frappe (recherche) — évite une requête par caractère tapé.
  let searchDebounceTimer = null;
  function render(){
    currentOffset = 0;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(fetchAndRenderPage, 200);
  }

  els.prevPageBtn.addEventListener('click', ()=>{
    const limit = parseInt(els.displayLimit.value, 10) || 10;
    currentOffset = Math.max(0, currentOffset - limit);
    fetchAndRenderPage();
  });
  els.nextPageBtn.addEventListener('click', ()=>{
    const limit = parseInt(els.displayLimit.value, 10) || 10;
    if(currentOffset + limit < currentSearchTotal) currentOffset += limit;
    fetchAndRenderPage();
  });

  els.search.addEventListener('input', render);
  els.displayLimit.addEventListener('change', render);

  // Transformation du numéro de suivi : au collage (Ctrl+V), à la touche Entrée (bipeur physique)
  // ou en quittant le champ (change).
  els.search.addEventListener('paste', ()=>{
    setTimeout(async ()=>{ if(!(await applyTrackingTransformIfNeeded())) render(); }, 0);
  });
  els.search.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') applyTrackingTransformIfNeeded();
  });
  els.search.addEventListener('change', applyTrackingTransformIfNeeded);

  // ---------- verrouillage : au départ, section 3 seule + export bloqué ----------
  // Dès la connexion, l'app démarre verrouillée : seule la section 3 est visible (mode plein
  // écran) et le bouton Exporter est désactivé. Alt+T (ou le bouton 🔒) demande le code
  // d'exportation pour tout déverrouiller d'un coup — toutes les sections réapparaissent et
  // Exporter n'a plus besoin de code pour le reste de la session (code mémorisé côté client).
  // Alt+T une seconde fois reverrouille instantanément, sans code.
  let exportUnlocked = false;
  let unlockedExportCode = null;

  function syncLockUi(){
    document.body.classList.toggle('focus-mode', !exportUnlocked);
    els.focusDbBtn.textContent = exportUnlocked ? '🔓' : '🔒';
    els.focusDbBtn.title = exportUnlocked ? 'Déverrouillé — Alt+T pour verrouiller' : 'Verrouillé — Alt+T pour déverrouiller';
    els.exportJsonEncryptedBtn.disabled = !exportUnlocked;
    els.exportJsonEncryptedBtn.title = exportUnlocked ? 'Télécharger un export CSV de toute la base' : 'Verrouillé — Alt+T pour déverrouiller';
    // Masqués (pas juste désactivés) tant que non déverrouillé : ces actions sont destructrices,
    // autant ne même pas les montrer avant Alt+T plutôt que de les laisser visibles mais grisées.
    els.cleanInvalidBtn.style.display = exportUnlocked ? '' : 'none';
    els.cleanInvalidBtn.title = 'Retire définitivement de la base les colis sans N° Commande ou sans Commande Amazon';
    els.cleanInvalidKmBtn.style.display = exportUnlocked ? '' : 'none';
    els.cleanInvalidKmBtn.title = 'Vide définitivement les numéros dernier kilométrique invalides (non alphanumériques, sans aucun chiffre, ou mots parasites connus)';
    render(); // ré-évalue "Détails auto" : la recherche peut déjà correspondre à un seul colis
  }

  function openExportCodeModal(){
    els.exportCodeInput.value = '';
    els.exportCodeModalError.textContent = '';
    els.exportCodeInput.disabled = false;
    els.exportCodeConfirmBtn.disabled = false;
    els.exportCodeCancelBtn.disabled = false;
    els.exportCodeModalBg.style.display = 'block';
    els.exportCodeInput.focus();
  }
  function closeExportCodeModal(){
    els.exportCodeModalBg.style.display = 'none';
  }

  els.focusDbBtn.addEventListener('click', ()=>{
    if(exportUnlocked){
      exportUnlocked = false;
      unlockedExportCode = null;
      syncLockUi();
    }else{
      openExportCodeModal();
    }
  });
  els.exportCodeCancelBtn.addEventListener('click', closeExportCodeModal);
  els.exportCodeModalBg.addEventListener('click', (e)=>{
    if(e.target === els.exportCodeModalBg) closeExportCodeModal();
  });

  els.exportCodeConfirmBtn.addEventListener('click', async ()=>{
    const code = els.exportCodeInput.value;
    if(!code){
      els.exportCodeModalError.textContent = 'Code requis.';
      return;
    }
    els.exportCodeModalError.textContent = '';
    els.exportCodeInput.disabled = true;
    els.exportCodeConfirmBtn.disabled = true;
    els.exportCodeCancelBtn.disabled = true;
    try{
      await dbPost('verify-code', { exportCode: code });
      unlockedExportCode = code;
      exportUnlocked = true;
      syncLockUi();
      closeExportCodeModal();
    }catch(e){
      els.exportCodeModalError.textContent = e && e.message ? e.message : 'Échec de la vérification.';
    }finally{
      els.exportCodeInput.disabled = false;
      els.exportCodeConfirmBtn.disabled = false;
      els.exportCodeCancelBtn.disabled = false;
    }
  });

  // ---------- "Détails auto" : ouvre automatiquement le détail d'un colis en mode plein écran ----------
  const AUTO_DETAILS_KEY = 'commandes-auto-details';
  function loadAutoDetails(){
    // Coché par défaut (activé) tant que l'utilisateur n'a jamais changé ce réglage lui-même.
    try{
      const raw = localStorage.getItem(AUTO_DETAILS_KEY);
      return raw === null ? true : raw === 'true';
    }catch(e){ return true; }
  }
  function saveAutoDetails(enabled){
    try{ localStorage.setItem(AUTO_DETAILS_KEY, enabled ? 'true' : 'false'); }catch(e){ /* stockage indisponible */ }
  }
  els.autoDetailsCheckbox.checked = loadAutoDetails();
  els.autoDetailsCheckbox.addEventListener('change', ()=>{
    saveAutoDetails(els.autoDetailsCheckbox.checked);
    render();
  });

  // Mémorise le dernier colis ouvert automatiquement pour ne pas le rouvrir en boucle à chaque
  // rendu tant que la recherche continue de ne correspondre qu'à lui — remis à null dès que la
  // recherche ne correspond plus à exactement un colis, ce qui permet une nouvelle ouverture
  // automatique la prochaine fois qu'une recherche se réduit à une seule correspondance.
  let autoOpenedRecord = null;

  // ---------- export / import JSON ----------
  let dbLogTimer = null;
  function setDbLog(text, isErr){
    els.dbLog.textContent = text;
    els.dbLog.style.color = isErr ? 'var(--danger)' : 'var(--success)';
    // Le message disparaît tout seul au bout d'1 minute
    if(dbLogTimer) clearTimeout(dbLogTimer);
    dbLogTimer = setTimeout(()=>{ els.dbLog.textContent = ''; }, 60000);
  }

  // ---------- export CSV / rechargement / nettoyage / suppression totale (Postgres) ----------
  // La base vit entièrement dans Vercel Postgres (voir api/db.js) : plus de fusion "brouillon local
  // + sauvegarde distante" avant export, chaque import/scraping/nettoyage écrit déjà directement en
  // base. "Exporter" ne fait plus qu'un export en clair (CSV) pour sauvegarde/analyse externe — la
  // couche de chiffrement AES n'a plus d'utilité, l'accès à Postgres étant déjà protégé côté serveur.

  function showBackupProgress(percentage, label){
    els.backupProgressWrap.style.display = '';
    els.backupProgressBar.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    els.backupProgressText.textContent = label;
  }
  function hideBackupProgress(){
    els.backupProgressWrap.style.display = 'none';
    els.backupProgressBar.style.width = '0%';
    els.backupProgressText.textContent = '';
  }

  els.exportJsonEncryptedBtn.addEventListener('click', async ()=>{
    if(!exportUnlocked || !unlockedExportCode) return; // bouton normalement désactivé dans ce cas
    els.exportJsonEncryptedBtn.disabled = true;
    try{
      showBackupProgress(0, 'Préparation du CSV…');
      // Le code d'export passe en en-tête (pas dans l'URL) pour ne jamais apparaître dans
      // l'historique du navigateur ni les journaux d'accès serveur.
      const res = await fetch('/api/db?action=export-csv', {
        headers: { 'X-Export-Code': unlockedExportCode },
        cache: 'no-store',
      });
      if(!res.ok){
        const errData = await res.json().catch(() => null);
        throw new Error(errData && errData.error ? errData.error : `HTTP ${res.status}`);
      }
      showBackupProgress(60, 'Téléchargement du fichier CSV…');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aia-mg-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setDbLog('Export CSV téléchargé.', false);
    }catch(e){
      setDbLog(`Échec de l'export (${e && e.message ? e.message : 'erreur inconnue'}).`, true);
    }finally{
      hideBackupProgress();
      els.exportJsonEncryptedBtn.disabled = !exportUnlocked;
    }
  });

  els.importBackupBtn.addEventListener('click', async ()=>{
    els.importBackupBtn.disabled = true;
    try{
      currentOffset = 0;
      await Promise.all([fetchAndRenderPage(), refreshStats(), refreshUnresolvedRows().then(updateCarrierTracking)]);
      setDbLog('Base rechargée depuis Postgres.', false);
    }catch(e){
      setDbLog(`Échec du rechargement (${e && e.message ? e.message : 'erreur inconnue'}).`, true);
    }finally{
      els.importBackupBtn.disabled = false;
    }
  });

  els.cleanInvalidBtn.addEventListener('click', async ()=>{
    if(!exportUnlocked || !unlockedExportCode) return; // bouton normalement désactivé dans ce cas
    if(!confirm('Retirer définitivement de la base tous les colis sans N° Commande ou sans Commande Amazon ?')) return;
    els.cleanInvalidBtn.disabled = true;
    try{
      const { removed } = await dbPost('clean-invalid', { exportCode: unlockedExportCode });
      if(removed === 0){
        setDbLog('Aucun colis sans N° Commande / Commande Amazon dans la base actuelle.', false);
      }else{
        currentOffset = 0;
        await Promise.all([fetchAndRenderPage(), refreshStats(), refreshUnresolvedRows().then(updateCarrierTracking)]);
        setDbLog(`${removed} colis retiré(s) (sans N° Commande / Commande Amazon).`, false);
      }
    }catch(e){
      setDbLog(`Échec du nettoyage (${e && e.message ? e.message : 'erreur inconnue'}).`, true);
    }finally{
      els.cleanInvalidBtn.disabled = false;
    }
  });

  els.cleanInvalidKmBtn.addEventListener('click', async ()=>{
    if(!exportUnlocked || !unlockedExportCode) return; // bouton normalement désactivé dans ce cas
    if(!confirm('Vider définitivement le numéro dernier kilométrique de tous les colis où cette valeur ne serait pas alphanumérique, ne contiendrait aucun chiffre, ou correspondrait à un mot parasite connu ?')) return;
    els.cleanInvalidKmBtn.disabled = true;
    try{
      const { removed } = await dbPost('clean-invalid-km', { exportCode: unlockedExportCode });
      if(removed === 0){
        setDbLog('Aucun numéro dernier kilométrique invalide trouvé dans la base actuelle.', false);
      }else{
        currentOffset = 0;
        await Promise.all([fetchAndRenderPage(), refreshStats(), refreshUnresolvedRows().then(updateCarrierTracking)]);
        setDbLog(`${removed} numéro(s) dernier kilométrique invalide(s) vidé(s).`, false);
      }
    }catch(e){
      setDbLog(`Échec du nettoyage (${e && e.message ? e.message : 'erreur inconnue'}).`, true);
    }finally{
      els.cleanInvalidKmBtn.disabled = false;
    }
  });

  // Recouvre toute la page pendant le chargement initial (liste + compteurs + section 2
  // transporteurs) : refreshUnresolvedRows() peut prendre du temps sur une grosse base (récupérée
  // par lots de 5000), autant empêcher toute interaction avec une page à moitié chargée plutôt que
  // de laisser cliquer sur des boutons dont l'état dépend de ces données.
  (async ()=>{
    try{
      await Promise.all([
        fetchAndRenderPage(),
        refreshStats(),
        refreshUnresolvedRows().then(updateCarrierTracking),
      ]);
    }catch(e){
      // Échec silencieux ici : chaque fonction gère déjà ses propres erreurs (message dans #dbLog
      // ou #scrapeAllLog) — on ne bloque jamais l'affichage de la page à cause de ça.
    }finally{
      els.appLoadingOverlay.style.display = 'none';
    }
  })();
  syncLockUi(); // état verrouillé par défaut à chaque connexion (voir plus haut)

  // Enregistrement du service worker (mode PWA installable). On ne le fait que si le contexte
  // le permet (HTTPS ou localhost) : sur file:// ou http simple, l'API n'existe pas et ce bloc
  // ne fait rien, sans jamais faire planter le reste de l'application.
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Échec silencieux : l'app continue de fonctionner normalement sans mode hors-ligne.
      });
    });
  }

  // ---------- détection de nouvelle version déployée ----------
  // /api/version lit assets/version.json (régénéré à chaque build Vercel, voir
  // scripts/generate-version.mjs) et renvoie un numéro v1.2.DD.MM.HH horodaté au moment du
  // déploiement. On passe par une fonction serverless plutôt que de servir ce fichier directement
  // comme asset statique : sur Vercel, les fichiers sous /assets sont servis depuis l'arborescence
  // Git du projet (qui n'a jamais ce fichier généré, volontairement absent du dépôt), alors que les
  // fonctions sont construites après "npm install" et voient bien le fichier généré par postinstall.
  // On charge une première fois pour afficher la version actuellement chargée, puis on réinterroge
  // périodiquement (sans cache HTTP) : si la valeur change, une nouvelle version a été déployée
  // pendant que cette page était ouverte.
  let loadedAppVersion = null;

  async function fetchAppVersion(){
    try{
      const res = await fetch('/api/version', { cache: 'no-store' });
      if(!res.ok) return null;
      const data = await res.json();
      return data && data.version ? data.version : null;
    }catch(e){
      return null; // hors ligne, ou version indisponible (ex. build local sans postinstall) : ignoré
    }
  }

  async function checkForAppUpdate(){
    const current = await fetchAppVersion();
    if(!current || !loadedAppVersion) return;
    if(current !== loadedAppVersion){
      els.updateAvailableBtn.style.display = '';
    }
  }

  els.updateAvailableBtn.addEventListener('click', async ()=>{
    els.updateAvailableBtn.disabled = true;
    els.updateAvailableBtn.textContent = '⟳ Mise à jour…';
    try{
      // Vide le cache du service worker (styles/scripts servis en "cache d'abord") pour être sûr
      // que le rechargement récupère bien les nouveaux fichiers plutôt que l'ancienne version
      // encore en cache.
      if('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    }catch(e){ /* non bloquant : on recharge quand même */ }
    location.reload();
  });

  (async () => {
    loadedAppVersion = await fetchAppVersion();
    if(loadedAppVersion) els.appVersion.textContent = `${loadedAppVersion} · © TSLV`;

    const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    setInterval(checkForAppUpdate, CHECK_INTERVAL_MS);
    // Vérification immédiate dès que l'utilisateur revient sur l'onglet, plutôt que d'attendre
    // jusqu'à 5 minutes après un déploiement survenu pendant qu'il était sur un autre onglet.
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'visible') checkForAppUpdate();
    });
  })();
})();
