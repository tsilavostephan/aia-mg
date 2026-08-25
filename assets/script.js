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
    exportJsonEncryptedBtn: document.getElementById('exportJsonEncryptedBtn'),
    importBackupBtn: document.getElementById('importBackupBtn'),
    backupProgressWrap: document.getElementById('backupProgressWrap'),
    backupProgressBar: document.getElementById('backupProgressBar'),
    backupProgressText: document.getElementById('backupProgressText'),
    dbVersionInfo: document.getElementById('dbVersionInfo'),
    exportCodeModalBg: document.getElementById('exportCodeModalBg'),
    exportCodeInput: document.getElementById('exportCodeInput'),
    exportCodeModalError: document.getElementById('exportCodeModalError'),
    exportCodeConfirmBtn: document.getElementById('exportCodeConfirmBtn'),
    exportCodeCancelBtn: document.getElementById('exportCodeCancelBtn'),
    dbLog: document.getElementById('dbLog'),
    clearBtn: document.getElementById('clearBtn'),
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
  let database = []; // { numCommande, commandeAmazon, qteCommande, numSuivi, qteExpedie, nom, transporteur, numDernierKm }

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

  // Extrait le Nom depuis la colonne 7 : le texte trouvé entre "CART'IN" et la première virgule qui
  // suit (apostrophe droite ou typographique acceptée), ex. "CART'IN Giovany Salomon, AEIC - ..."
  // -> "Giovany Salomon". Si le motif n'est pas trouvé, renvoie ''.
  function extractNomFromCol7(v){
    const str = String(v ?? '');
    const m = str.match(/CART['’]IN(.*?),/i);
    return m ? m[1].trim() : '';
  }

  // ---------- reconnaissance du numéro de suivi collé / scanné ----------

  // Retire les caractères spéciaux (non alphanumériques) uniquement en tout début et toute fin de
  // la chaîne scannée/collée, sans toucher aux caractères internes.
  function stripSpecialCharsEdges(str){
    return String(str || '').replace(/^[^0-9A-Za-z]+/, '').replace(/[^0-9A-Za-z]+$/, '');
  }

  // Un numéro de suivi calculé correspond-il à une commande déjà présente en base ?
  function trackingExistsInDb(value){
    if(!value) return false;
    const v = value.toLowerCase();
    return database.some(r => cleanNumSuivi(r.numSuivi).toLowerCase() === v);
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
  function computeBestTracking(raw){
    const stripped = stripSpecialCharsEdges(raw);
    if(stripped && trackingExistsInDb(stripped)) return stripped;

    const results = SEARCH_ALGORITHMS
      .map(algo => runSearchAlgorithm(algo, raw))
      .filter(v => v);

    const matched = results.find(v => trackingExistsInDb(v));
    if(matched) return matched;

    return stripped || results[0] || null;
  }

  // Applique la transformation ci-dessus sur le champ de recherche
  function applyTrackingTransformIfNeeded(){
    const transformed = computeBestTracking(els.search.value);
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
  // "Exporter en JSON" / "Importer un JSON" de la section 3) au début de chaque session. Ça évite
  // toute question de quota de stockage (localStorage ~5-10 Mo, IndexedDB parfois restreint ou
  // évincé sur mobile) puisqu'il n'y a plus rien à stocker durablement côté navigateur.
  // saveDatabase() reste une fonction (vide) pour ne pas avoir à toucher tous ses appelants
  // existants (import CSV, scraping, etc., qui font déjà "await saveDatabase()").
  function loadDatabase(){
    database = [];
    render();
  }

  async function saveDatabase(){
    // volontairement vide : rien n'est persisté.
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

  // Clé unique d'une commande : la combinaison N° Commande + Commande Amazon (il faut que les
  // deux correspondent pour considérer qu'il s'agit de la même commande). Num Suivi n'entre pas
  // dans la clé : c'est un champ de référence, il est simplement mis à jour comme les autres.
  function buildOrderKey(rec){
    const numCommande = String(rec.numCommande || '').trim().toLowerCase();
    const commandeAmazon = String(rec.commandeAmazon || '').trim().toLowerCase();
    if(!numCommande || !commandeAmazon) return null;
    return numCommande + '||' + commandeAmazon;
  }

  // Recherche des enregistrements déjà en base par clé unique (N° Commande + Commande Amazon),
  // pour éviter les doublons à l'import : si une commande avec la même clé existe déjà, on met à
  // jour ses champs (dont Num Suivi, à titre de référence) au lieu d'ajouter une nouvelle ligne.
  function buildOrderKeyIndex(){
    const idx = new Map();
    database.forEach((r, i)=>{
      const key = buildOrderKey(r);
      if(key) idx.set(key, i);
    });
    return idx;
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

  els.importBtn.addEventListener('click', async ()=>{
    if(selectedFiles.length === 0) return;
    els.importBtn.disabled = true;
    let totalAdded = 0;
    let totalUpdated = 0;
    const orderKeyIndex = buildOrderKeyIndex();

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

      const maxColNeeded = Math.max(...COLS.filter(c=>c.col !== null).map(c=>c.col));

      let added = 0;
      let updated = 0;
      let shortRows = 0;
      rows.forEach(row=>{
        if(!row || row.every(c => c === '' || c === undefined)) return;
        if(row.length < maxColNeeded) shortRows++;

        const rec = rowToRecord(row);
        const key = buildOrderKey(rec);
        const existingIndex = key ? orderKeyIndex.get(key) : undefined;

        if(existingIndex !== undefined){
          // Le CSV n'a pas de colonne Num dernier kilométrique (col:null) : on garde la valeur
          // déjà en base au lieu de l'écraser avec la chaîne vide de rec.
          database[existingIndex] = { ...database[existingIndex], ...rec, numDernierKm: database[existingIndex].numDernierKm };
          updated++;
        }else{
          database.push(rec);
          if(key) orderKeyIndex.set(key, database.length - 1);
          added++;
        }
      });

      if(added === 0 && updated === 0){
        logLine(`${file.name} — 0 ligne ajoutée (toutes les lignes lues étaient vides).`, true);
        continue;
      }

      totalAdded += added;
      totalUpdated += updated;
      const parts = [];
      if(added > 0) parts.push(`${added} ajoutée(s)`);
      if(updated > 0) parts.push(`${updated} mise(s) à jour`);
      logLine(`${file.name} — ${parts.join(', ')}.`);
      if(shortRows > 0){
        logLine(`${file.name} — attention : ${shortRows} ligne(s) ont moins de ${maxColNeeded} colonnes, certains champs ont été laissés vides.`, true);
      }
    }

    await saveDatabase();
    render();

    selectedFiles = [];
    els.fileInput.value = '';
    renderFileList();
    els.importBtn.disabled = false;
    const summaryParts = [];
    if(totalAdded > 0) summaryParts.push(`${totalAdded} ajoutée(s)`);
    if(totalUpdated > 0) summaryParts.push(`${totalUpdated} mise(s) à jour`);
    logLine(`Import terminé — ${summaryParts.join(', ') || '0 commande'} au total.`);
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
    { key:'landmark',   label:'LANDMARK',   match:['LANDMARK'],                baseUrl:'https://track.landmarkglobal.com/?search=',          kmColIndex:1, mode:'url', numsSeparator:', ', urlEncodeNums:true,
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
    // Scraping uniquement (disableManualImport) : ce site n'accepte qu'un seul numéro par lien
    // (chunkSize:1) et il peut y avoir des centaines de colis, donc les liens "Ouvrir" sont affichés
    // en petits boutons numérotés (compactLinks) plutôt qu'une ligne complète par lien.
    // scrapeChunkSize regroupe malgré tout plusieurs numéros par appel de fonction Vercel (voir
    // lib/scrapers/parcelsapp.js, même principe que CNE). match:['SF EXPRESS'] : SF Express est
    // scrappé par défaut avec ce transporteur.
    { key:'parcelsapp', label:'PARCELSAPP', match:['SF EXPRESS'],              baseUrl:'https://parcelsapp.com/en/tracking/',                kmColIndex:1, mode:'url', chunkSize:1, scrapeChunkSize:10,
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

  function computeCarrierGroups(){
    return CARRIERS.map(c=>{
      // Inutile de rescraper une commande qui a déjà son numéro dernier kilométrique — seules les
      // commandes encore non résolues sont proposées au scraping automatique/à l'import manuel.
      const nums = Array.from(new Set(
        database
          .filter(r => rowBelongsToCarrierGroup(r, c) && !String(r.numDernierKm || '').trim())
          .map(r => cleanNumSuivi(r.numSuivi)).filter(v => v.length > 0)
      ));
      return { ...c, nums, chunks: chunkArray(nums, c.chunkSize || CHUNK_SIZE) };
    }).filter(g => g.nums.length > 0)
      .sort((a, b) => b.nums.length - a.nums.length); // le plus de colis d'abord
  }

  // ---------- fenêtre d'association manuelle transporteur ----------
  let draftCarrierMapping = {};

  function renderCarrierMappingList(){
    const rawValues = Array.from(new Set(database.map(r => String(r.transporteur || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));

    if(rawValues.length === 0){
      els.carrierMappingList.innerHTML = '<p style="font-size:13px; color:var(--muted);">Aucune valeur de transporteur trouvée en base.</p>';
      return;
    }

    els.carrierMappingList.innerHTML = rawValues.map(raw=>{
      const rawKey = raw.toUpperCase();
      const count = database.filter(r => String(r.transporteur || '').trim() === raw).length;

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

  function openCarrierMappingModal(){
    draftCarrierMapping = { ...carrierMapping };
    renderCarrierMappingList();
    els.carrierMappingModalBg.style.display = 'block';
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

    const updateMap = new Map();
    updates.forEach(u => updateMap.set(u.trackingNumber, u.lastKm));

    let matched = 0;
    database.forEach(r=>{
      if(!rowBelongsToCarrierGroup(r, g)) return;
      const key = cleanNumSuivi(r.numSuivi);
      if(updateMap.has(key)){
        r.numDernierKm = updateMap.get(key);
        matched++;
      }
    });

    const notFound = Math.max(0, updates.length - matched);
    await saveDatabase();

    pastedTextByCarrier[g.key] = ''; // vide le champ après un import terminé avec succès

    importLogByCarrier[g.key] = {
      text: `${matched} commande(s) mise(s) à jour dans la base.` + (notFound > 0 ? ` ${notFound} numéro(s) collé(s) sans correspondance dans la base pour ${g.label}.` : ''),
      err: false
    };
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

  // Lit une valeur imbriquée dans un objet à partir d'un chemin "a.b.c" (chaîne vide = objet racine)
  function readByPath(obj, path){
    if(!path) return obj;
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined) ? acc[key] : undefined, obj);
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

  // Extrait le tableau de résultats d'une réponse JSON (selon le mapping configuré), met à jour
  // numDernierKm pour les commandes du transporteur correspondant, sauvegarde et journalise le
  // résultat. Partagé par tous les transporteurs pris en charge pour le scraping (4PX, YANWEN, ...).
  // Renvoie le nombre de commandes mises à jour (matched), utilisé par scrapeAllCarriers() pour
  // afficher le total dans le titre de la section une fois tous les transporteurs traités.
  async function applyScrapedResultsToDb(g, json, config, sourceLabel){
    const items = readByPath(json, config.respArrayField);
    if(!Array.isArray(items)){
      const preview = JSON.stringify(json).slice(0, 500);
      importLogByCarrier[g.key] = {
        text: `Réponse de ${sourceLabel} reçue mais le champ « ${config.respArrayField || '(racine)'} » ne contient pas de tableau exploitable — ajustez le mapping des champs. Aperçu brut de la réponse : ${preview}`,
        err: true
      };
      renderCarrierPanel();
      return 0;
    }

    const updateMap = new Map();
    items.forEach(item=>{
      const trackingNumber = cleanNumSuivi(item[config.respTrackingField]);
      const lastKm = String(item[config.respLastMileField] ?? '').trim();
      if(trackingNumber) updateMap.set(trackingNumber, lastKm);
    });

    let matched = 0;
    database.forEach(r=>{
      if(!rowBelongsToCarrierGroup(r, g)) return;
      const key = cleanNumSuivi(r.numSuivi);
      if(updateMap.has(key)){
        r.numDernierKm = updateMap.get(key);
        matched++;
      }
    });

    const notFound = Math.max(0, items.length - matched);
    await saveDatabase();

    let mismatchSample = '';
    if(matched === 0 && items.length > 0){
      // Aucune correspondance alors que la commande existe visiblement en base : on affiche un
      // échantillon des deux côtés en JSON.stringify (qui révèle les caractères invisibles, ex.
      // espace insécable/zero-width venant du presse-papier) pour repérer un décalage d'encodage.
      const scrapedKeys = Array.from(updateMap.keys()).slice(0, 3).map(k => JSON.stringify(k));
      const dbKeys = database
        .filter(r => rowBelongsToCarrierGroup(r, g))
        .slice(0, 3)
        .map(r => JSON.stringify(cleanNumSuivi(r.numSuivi)));
      mismatchSample = ` Échantillon scrapé : ${scrapedKeys.join(', ')} — Échantillon base : ${dbKeys.join(', ')}`;
      if(json.debug){
        mismatchSample += ` Diagnostic scraping : ${JSON.stringify(json.debug).slice(0, 600)}`;
      }
    }

    importLogByCarrier[g.key] = {
      text: `${matched} commande(s) mise(s) à jour via ${sourceLabel}.` + (notFound > 0 ? ` ${notFound} résultat(s) sans correspondance dans la base.` : '') + mismatchSample,
      err: false
    };
    render();
    return matched;
  }

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
  // milliers de lots (PARCELSAPP : un lien par colis, regroupés seulement par 10 — voir
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
    importLogByCarrier[g.key] = {
      text: `Scraping ${g.label} (via Vercel) en cours` + (chunks.length > 1 ? ` — ${chunks.length} liens traités par vagues de ${MAX_CONCURRENT_SCRAPES}` : '') + ` (peut prendre du temps pour un grand nombre de colis)…`,
      err: false
    };
    renderCarrierPanel();

    const chunkOutcomes = await runWithConcurrencyLimit(chunks, MAX_CONCURRENT_SCRAPES, async (chunk) => {
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
          const structureWarning = json.debug && json.debug.structureChangeWarning;
          const debugText = json.debug ? JSON.stringify(json.debug).slice(0, 300) : '(pas de diagnostic disponible)';
          throw new Error(structureWarning
            ? `⚠️ ${structureWarning}`
            : `aucun résultat exploitable (${debugText})`);
        }
        return updates;
      }finally{
        // Un lot vient de se terminer (succès ou échec) : on avance la barre de progression.
        const progress = scrapeProgressByCarrier[g.key];
        if(progress){
          progress.done++;
          renderCarrierPanel();
        }
      }
    });

    scrapeProgressByCarrier[g.key] = null;

    const allResults = [];
    const chunkErrors = [];
    chunkOutcomes.forEach((outcome, idx)=>{
      if(outcome.status === 'fulfilled'){
        allResults.push(...outcome.value);
      }else{
        const reason = outcome.reason && outcome.reason.message ? outcome.reason.message : 'échec inconnu';
        chunkErrors.push(`lien ${idx + 1}/${chunks.length} : ${reason}`);
      }
    });

    if(allResults.length === 0){
      importLogByCarrier[g.key] = {
        text: `Le scraping n'a renvoyé aucun résultat exploitable.` + (chunkErrors.length > 0 ? ` ${chunkErrors.join(' | ')}` : ''),
        err: true
      };
      renderCarrierPanel();
      return 0;
    }

    const matched = await applyScrapedResultsToDb(
      g,
      { results: allResults },
      { respArrayField: 'results', respTrackingField: 'trackingNumber', respLastMileField: 'lastKm' },
      `${g.sourceLabel || 'le scraping Vercel'}${chunks.length > 1 ? ` (${chunks.length} liens)` : ''}`
    );

    if(chunkErrors.length > 0){
      const current = importLogByCarrier[g.key];
      importLogByCarrier[g.key] = {
        text: `${current.text} ⚠️ ${chunkErrors.length} lien(s) en échec : ${chunkErrors.join(' | ')}`,
        err: current.err
      };
      renderCarrierPanel();
    }

    return matched;
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
    { code:'KeyJ', label:'Importer une base (.aiae)',           run: () => els.importBackupBtn.click() },
    { code:'KeyX', label:'Effacer la base de données',          run: () => els.clearBtn.click() },
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
  document.addEventListener('paste', (e)=>{
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
    if(!applyTrackingTransformIfNeeded()) render();
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

  function buildMetaItem(label, value){
    const item = document.createElement('span');
    item.className = 'meta-item';
    item.textContent = `${label}: ${value || '—'}`;
    return item;
  }

  function buildDbCard(r){
    const card = document.createElement('div');
    card.className = 'db-card';
    card.addEventListener('click', ()=> openPackageModal(r));

    const info = document.createElement('div');
    info.className = 'db-card-info';

    const title = document.createElement('div');
    title.className = 'db-card-title';
    if(r.transporteur){
      const colors = badgeColorsFor(r.transporteur);
      const badge = document.createElement('span');
      badge.className = 'carrier-badge';
      badge.style.background = colors.bg;
      badge.style.color = colors.fg;
      badge.textContent = r.transporteur;
      title.appendChild(badge);
    }
    const numSuiviSpan = document.createElement('span');
    numSuiviSpan.textContent = r.numSuivi || '—';
    title.appendChild(numSuiviSpan);
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'db-card-meta';
    const metaItems = [
      buildMetaItem('Amazon', r.commandeAmazon),
      buildMetaItem('Cmd', r.numCommande),
      buildMetaItem('Qté', r.qteCommande),
      buildMetaItem('Exp', r.qteExpedie),
    ];
    metaItems.forEach((el, idx)=>{
      meta.appendChild(el);
      if(idx < metaItems.length - 1) meta.appendChild(document.createTextNode(' · '));
    });
    info.appendChild(meta);

    card.appendChild(info);

    const right = document.createElement('div');
    right.className = 'db-card-right';
    if(!r.numDernierKm) right.classList.add('empty');
    right.textContent = r.numDernierKm || '–';
    card.appendChild(right);

    return card;
  }

  // ---------- fenêtre de détails d'un colis (clic sur une carte) ----------
  function openPackageModal(r){
    // QTE et QTE_EXPED sont comparées (numériquement si possible, sinon en texte) pour les colorer :
    // vert si elles correspondent, rouge sinon.
    const qteRaw = r.qteCommande, qteExpRaw = r.qteExpedie;
    const qteNum = Number(String(qteRaw ?? '').trim());
    const qteExpNum = Number(String(qteExpRaw ?? '').trim());
    const bothNumeric = String(qteRaw ?? '').trim() !== '' && String(qteExpRaw ?? '').trim() !== ''
      && !Number.isNaN(qteNum) && !Number.isNaN(qteExpNum);
    const qteMatch = bothNumeric
      ? qteNum === qteExpNum
      : String(qteRaw ?? '').trim() === String(qteExpRaw ?? '').trim() && String(qteRaw ?? '').trim() !== '';
    const qteClass = qteMatch ? 'qty-match' : 'qty-mismatch';

    const fields = [
      { label:'Nom',                       value:r.nom },
      { label:'Num Suivi',                 value:r.numSuivi },
      { label:'Commande Amazon',           value:r.commandeAmazon },
      { label:'N° Commande',               value:r.numCommande },
      { label:'Transporteur',              value:r.transporteur },
      { label:'QTE',                       value:r.qteCommande, extraClass: qteClass },
      { label:'QTE_EXPED',                 value:r.qteExpedie,  extraClass: qteClass },
      { label:'Num dernier kilométrique',  value:r.numDernierKm },
    ];

    els.packageModalBody.innerHTML = '';
    fields.forEach(f=>{
      const row = document.createElement('div');
      row.className = 'package-detail-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'package-detail-label';
      labelEl.textContent = f.label;
      row.appendChild(labelEl);
      row.appendChild(createCopySpan(f.value || '—', f.extraClass));
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
    scannerInstance = new Html5Qrcode('scannerReaderContainer', { formatsToSupport: scannerFormats(), verbose: false });

    try{
      await scannerInstance.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText)=>{
          // une valeur a été détectée : on arrête le scan et on colle la valeur dans la recherche
          stopScanner();
          const transformed = computeBestTracking(decodedText);
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

  // ---------- affichage liste ----------
  function render(){
    const term = els.search.value.trim().toLowerCase();
    // Plusieurs critères séparés par des virgules fonctionnent comme un OU : une ligne correspond
    // dès qu'au moins un des critères est trouvé dans au moins un de ses champs.
    const terms = term.split(',').map(t => t.trim()).filter(t => t.length > 0);
    const filtered = terms.length
      ? database.filter(r => terms.some(t => Object.values(r).some(v => String(v).toLowerCase().includes(t))))
      : database;

    if(term && els.autoDetailsCheckbox.checked && document.body.classList.contains('focus-mode') && filtered.length === 1){
      if(autoOpenedRecord !== filtered[0]){
        autoOpenedRecord = filtered[0];
        openPackageModal(filtered[0]);
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

    const limitVal = els.displayLimit.value; // 'all' ou nombre en chaîne
    const reversedFiltered = filtered.slice().reverse();
    const rows = limitVal === 'all' ? reversedFiltered : reversedFiltered.slice(0, parseInt(limitVal, 10));

    els.dbCards.innerHTML = '';
    rows.forEach(r=> els.dbCards.appendChild(buildDbCard(r)));

    els.rowCount.textContent = database.length;
    // Recalculé à chaque rendu à partir de l'état actuel de la base (pas un compteur qui
    // s'incrémenterait à chaque import/scraping) : relancer plusieurs fois les mêmes imports ou le
    // scraping ne fausse donc jamais ce total.
    const resolvedTotal = database.filter(r => String(r.numDernierKm || '').trim()).length;
    els.resolvedCount.textContent = resolvedTotal;
    els.resolvedPercent.textContent = database.length > 0
      ? ` (${((resolvedTotal / database.length) * 100).toFixed(2)}%)`
      : '';

    if(term && filtered.length < database.length){
      els.count.textContent = `${rows.length} affichée(s) / ${filtered.length} résultat(s) / ${database.length} commande(s) au total`;
    }else if(limitVal !== 'all' && database.length > parseInt(limitVal, 10)){
      els.count.textContent = `${rows.length} affichée(s) sur ${database.length} commande(s) (limite : ${limitVal})`;
    }else{
      els.count.textContent = '';
    }

    els.emptyState.textContent = database.length === 0
      ? 'Aucune commande en base pour le moment. Importez un CSV pour commencer, ou un fichier .aiae exporté lors d\'une session précédente (la base n\'est pas conservée automatiquement entre deux visites).'
      : 'Aucun résultat pour cette recherche.';
    const showList = rows.length > 0;
    els.dbCards.style.display = showList ? 'flex' : 'none';
    els.emptyState.style.display = showList ? 'none' : 'block';

    updateCarrierTracking();
  }

  els.search.addEventListener('input', render);
  els.displayLimit.addEventListener('change', render);

  // Transformation du numéro de suivi : au collage (Ctrl+V), à la touche Entrée (bipeur physique)
  // ou en quittant le champ (change).
  els.search.addEventListener('paste', ()=>{
    setTimeout(()=>{ if(!applyTrackingTransformIfNeeded()) render(); }, 0);
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
    els.exportJsonEncryptedBtn.title = exportUnlocked ? 'Exporter vers Vercel Blob' : 'Verrouillé — Alt+T pour déverrouiller';
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
      await postBackupAction('verify-code', { exportCode: code });
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

  // Fusionne un tableau déjà décodé (JSON classique ou déchiffré) dans la base, avec la même
  // logique de dédoublonnage par clé (N° Commande + Commande Amazon) que l'import CSV. Partagée
  // entre l'import JSON classique et l'import JSON chiffré, pour ne pas dupliquer cette logique.
  async function importParsedJsonArray(parsed, sourceLabel){
    if(!Array.isArray(parsed)){
      setDbLog(`${sourceLabel} — le contenu doit être un tableau de commandes ([...]), pas un objet unique.`, true);
      return;
    }
    if(parsed.length === 0){
      setDbLog(`${sourceLabel} — le tableau est vide, aucune commande à importer.`, true);
      return;
    }

    const keys = COLS.map(c=>c.key);
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const orderKeyIndexJson = buildOrderKeyIndex();
    parsed.forEach(item=>{
      if(item && typeof item === 'object' && !Array.isArray(item)){
        const rec = {};
        keys.forEach(k => rec[k] = item[k] !== undefined && item[k] !== null ? String(item[k]) : '');
        rec.numSuivi = cleanNumSuivi(rec.numSuivi);

        const key = buildOrderKey(rec);
        const existingIndex = key ? orderKeyIndexJson.get(key) : undefined;

        if(existingIndex !== undefined){
          // Ne pas effacer le Num dernier kilométrique déjà en base si l'enregistrement importé
          // n'en a pas (ou en a un vide) : on garde la valeur existante dans ce cas.
          const numDernierKm = rec.numDernierKm ? rec.numDernierKm : database[existingIndex].numDernierKm;
          database[existingIndex] = { ...database[existingIndex], ...rec, numDernierKm };
          updated++;
        }else{
          database.push(rec);
          if(key) orderKeyIndexJson.set(key, database.length - 1);
          added++;
        }
      }else{
        skipped++;
      }
    });

    if(added === 0 && updated === 0){
      setDbLog(`${sourceLabel} — aucune entrée valide trouvée dans le tableau JSON (${skipped} élément(s) ignoré(s), format inattendu).`, true);
      return;
    }

    await saveDatabase();
    render();
    const jsonSummary = [];
    if(added > 0) jsonSummary.push(`${added} ajoutée(s)`);
    if(updated > 0) jsonSummary.push(`${updated} mise(s) à jour`);
    setDbLog(`${sourceLabel} — ${jsonSummary.join(', ')}.` + (skipped > 0 ? ` ${skipped} élément(s) ignoré(s) (format invalide).` : ''), false);
  }

  // ---------- export/import .aiae (CSV chiffré AES-256-GCM via l'API Web Crypto du navigateur) ----------
  // Unique mécanisme d'export/import de la base (le JSON en clair a été retiré) : un fichier .aiae
  // sûr à partager (email, drive, clé USB) même intercepté, sans dépendance externe (Web Crypto est
  // natif à tous les navigateurs modernes). Le mot de passe n'est jamais saisi à la main — voir
  // getEncryptionPassword() plus bas, qui le dérive automatiquement du code de connexion.
  //
  // Le contenu chiffré est du CSV plutôt que du JSON : le JSON répète le nom de chaque champ à
  // chaque commande (8 clés par colis), ce qui gonfle nettement la taille du fichier sur une grosse
  // base — le CSV n'écrit ces noms qu'une fois, en en-tête.
  const ENC_MAGIC = 'AIAENC2'; // v2 = contenu CSV (v1, retiré, était du JSON) — refuse volontairement de désérialiser un ancien fichier v1 comme du CSV
  const ENC_PBKDF2_ITERATIONS = 250000;

  // Échappe un champ selon les règles CSV standard (entoure de guillemets si le champ contient une
  // virgule, un guillemet ou un saut de ligne, en doublant les guillemets internes).
  function csvEscapeField(v){
    const s = String(v ?? '');
    if(/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // Sérialise les commandes en CSV (en-tête = clés des champs, une ligne par commande) — voir
  // COLS pour la liste des champs. Symétrique de csvToRecords() ci-dessous.
  function recordsToCsv(records){
    const keys = COLS.map(c => c.key);
    const lines = [keys.map(csvEscapeField).join(',')];
    records.forEach(r => lines.push(keys.map(k => csvEscapeField(r[k])).join(',')));
    return lines.join('\r\n');
  }

  // Reconstruit un tableau de commandes à partir du CSV généré par recordsToCsv() — réutilise le
  // même analyseur CSV que l'import de fichiers CSV externes (parseCSV), la première ligne étant
  // ici toujours un en-tête (noms de champs, pas des numéros de colonne à deviner).
  function csvToRecords(csvText){
    const rows = parseCSV(csvText);
    if(!rows || rows.length === 0) return [];
    const header = rows[0];
    return rows.slice(1)
      .filter(row => row && row.some(cell => cell !== '' && cell !== undefined))
      .map(row => {
        const rec = {};
        header.forEach((key, i) => { rec[key] = row[i] !== undefined ? row[i] : ''; });
        return rec;
      });
  }

  // btoa/atob sur un Uint8Array direct plante ou est inexact pour de gros tableaux : on encode par
  // blocs pour éviter tout dépassement de pile avec une grosse base (ex. 50 Mo).
  function arrayBufferToBase64(buf){
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for(let i=0; i<bytes.length; i+=chunkSize){
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  function base64ToUint8Array(b64){
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveAesKey(password, salt){
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations: ENC_PBKDF2_ITERATIONS, hash:'SHA-256' },
      keyMaterial,
      { name:'AES-GCM', length:256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJsonPayload(data, password, exportedAt){
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(password, salt);
    const plaintext = new TextEncoder().encode(recordsToCsv(data));
    const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, plaintext);
    return JSON.stringify({
      magic: ENC_MAGIC,
      // Horodatage de l'export en clair dans l'enveloppe (pas chiffré) : ça ne révèle aucune donnée
      // sensible, et ça permet d'afficher "quelle version de la base" a été importée sans avoir à
      // déchiffrer quoi que ce soit pour ça — voir dbVersionInfo.
      exportedAt: exportedAt || new Date().toISOString(),
      salt: arrayBufferToBase64(salt),
      iv: arrayBufferToBase64(iv),
      ciphertext: arrayBufferToBase64(ciphertext),
    });
  }

  // Renvoie { records, exportedAt } plutôt que juste le tableau de commandes, pour que l'appelant
  // puisse afficher de quel export provient la base qui vient d'être importée.
  async function decryptJsonPayload(envelopeText, password){
    let envelope;
    try{
      envelope = JSON.parse(envelopeText);
    }catch(e){
      throw new Error("ce n'est pas un fichier .aiae valide.");
    }
    if(!envelope || envelope.magic !== ENC_MAGIC){
      throw new Error("format non reconnu — ce n'est pas un fichier .aiae exporté par cette app (ou il vient d'une version trop ancienne).");
    }
    const salt = base64ToUint8Array(envelope.salt);
    const iv = base64ToUint8Array(envelope.iv);
    const ciphertext = base64ToUint8Array(envelope.ciphertext);
    const key = await deriveAesKey(password, salt);
    let plaintext;
    try{
      plaintext = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ciphertext);
    }catch(e){
      throw new Error('mot de passe incorrect ou fichier corrompu.');
    }
    return { records: csvToRecords(new TextDecoder().decode(plaintext)), exportedAt: envelope.exportedAt || null };
  }

  // Le mot de passe de chiffrement n'est jamais saisi à la main : il est dérivé automatiquement du
  // code de connexion de l'app (récupéré via /api/login-code, protégé par le même cookie de
  // session que le reste du site) suivi d'un suffixe fixe. ⚠️ Contrairement au cookie de session
  // (un HMAC, jamais le code lui-même), ce endpoint renvoie le vrai code en clair à toute session
  // déjà connectée — un compromis délibéré pour permettre ce chiffrement "automatique".
  const ENC_PASSWORD_SUFFIX = 'tsil@v0';
  let cachedLoginCode = null;

  async function getEncryptionPassword(){
    if(cachedLoginCode) return cachedLoginCode + ENC_PASSWORD_SUFFIX;
    const res = await fetch('/api/login-code', { cache: 'no-store' });
    if(!res.ok) throw new Error("impossible de récupérer le code de connexion (êtes-vous bien connecté ?).");
    const data = await res.json();
    if(!data || !data.code) throw new Error('code de connexion indisponible côté serveur.');
    cachedLoginCode = data.code;
    return cachedLoginCode + ENC_PASSWORD_SUFFIX;
  }

  // Découpe l'enveloppe chiffrée en morceaux < 4,5 Mo (limite d'une requête vers une fonction
  // serverless Vercel) et les envoie un par un à notre propre fonction (voir api/backup.js), qui
  // les recolle et les stocke elle-même sur Vercel Blob. Remplace le protocole "client upload"
  // officiel de @vercel/blob/client (upload direct navigateur -> Vercel Blob) : chargé depuis un
  // CDN dans cette app sans étape de build, il envoyait le fichier avec succès mais la requête vers
  // vercel.com/api/blob se heurtait systématiquement à un blocage CORS côté navigateur (ce SDK est
  // conçu pour être empaqueté via Next.js/Webpack) — avec une nouvelle tentative complète à chaque
  // échec, d'où la progression qui repartait sans cesse de 0 % en boucle. Cette approche maison
  // reste toujours à l'intérieur de notre propre domaine, jamais directement vers vercel.com.
  const EXPORT_CHUNK_SIZE = 3 * 1024 * 1024; // 3 Mo par morceau, marge confortable sous 4,5 Mo

  async function postBackupAction(action, extra){
    const res = await fetch('/api/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    if(!res.ok){
      const errData = await res.json().catch(() => null);
      throw new Error(errData && errData.error ? errData.error : `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function uploadEnvelopeInChunks(envelope, exportCode, onProgress){
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const totalChunks = Math.max(1, Math.ceil(envelope.length / EXPORT_CHUNK_SIZE));
    for(let i = 0; i < totalChunks; i++){
      const chunk = envelope.slice(i * EXPORT_CHUNK_SIZE, (i + 1) * EXPORT_CHUNK_SIZE);
      await postBackupAction('chunk', { exportCode, uploadId, chunkIndex: i, data: chunk });
      onProgress(((i + 1) / totalChunks) * 100, totalChunks);
    }
    await postBackupAction('finalize', { exportCode, uploadId, totalChunks });
  }

  // Affiche la date/heure de l'export dont provient la base actuellement chargée, en bas à droite
  // de la rangée Exporter/Importer/Effacer — pour savoir "quelle version" de la base est active.
  // Non persistant (comme le reste de la base, voir loadDatabase) : disparaît au rechargement de
  // la page tant qu'un nouvel import ou export n'a pas eu lieu.
  function setDbVersionInfo(isoDate){
    if(!isoDate){ els.dbVersionInfo.textContent = ''; return; }
    const d = new Date(isoDate);
    if(Number.isNaN(d.getTime())){ els.dbVersionInfo.textContent = ''; return; }
    const datePart = d.toLocaleDateString('fr-FR');
    const timePart = d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
    els.dbVersionInfo.textContent = `Version du ${datePart} à ${timePart}`;
  }

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

  // Rejette avec un message clair si "promise" ne se règle pas dans le délai imparti — filet de
  // sécurité pour ne jamais rester bloqué en silence (ex. upload() qui ne résoudrait/rejetterait
  // jamais suite à un problème réseau ou serveur imprévu).
  function withTimeout(promise, ms, message){
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  // Télécharge et déchiffre la sauvegarde actuellement sur Vercel Blob. Renvoie null s'il n'y en a
  // encore aucune (404, avant le premier export). Partagée entre l'import manuel et la fusion
  // automatique avant chaque export (voir plus bas) — pour ne jamais dupliquer cette logique de
  // lecture par flux/déchiffrement.
  async function downloadRemoteBackup(password, onProgress){
    const res = await withTimeout(fetch('/api/backup', { cache: 'no-store' }), 30000, 'Délai dépassé (30s) en attendant Vercel Blob.');
    if(res.status === 404) return null;
    if(!res.ok){
      const errData = await res.json().catch(() => null);
      throw new Error(errData && errData.error ? errData.error : `HTTP ${res.status}`);
    }

    // fetch() n'a pas d'événement de progression natif : on lit le flux de réponse par morceaux
    // et on compare les octets reçus au total annoncé par Content-Length pour estimer le %.
    const totalBytes = Number(res.headers.get('content-length')) || 0;
    let text;
    if(totalBytes > 0 && res.body && res.body.getReader){
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for(;;){
        const { done, value } = await reader.read();
        if(done) break;
        chunks.push(value);
        received += value.length;
        if(onProgress) onProgress((received / totalBytes) * 100);
      }
      const merged = new Uint8Array(received);
      let offset = 0;
      chunks.forEach(c => { merged.set(c, offset); offset += c.length; });
      text = new TextDecoder().decode(merged);
    }else{
      if(onProgress) onProgress(50);
      text = await res.text();
    }

    return decryptJsonPayload(text, password);
  }

  els.exportJsonEncryptedBtn.addEventListener('click', async ()=>{
    if(!exportUnlocked || !unlockedExportCode) return; // bouton normalement désactivé dans ce cas
    if(database.length === 0){
      setDbLog('Rien à exporter : la base de données est vide.', true);
      return;
    }
    els.exportJsonEncryptedBtn.disabled = true;
    try{
      showBackupProgress(0, 'Préparation…');
      const password = await getEncryptionPassword();

      // Fusionne d'abord avec la sauvegarde déjà présente sur Vercel Blob (si elle existe) : sans
      // ça, exporter depuis une session qui n'a en mémoire qu'une partie des commandes (ex. juste
      // les CSV importés aujourd'hui) écraserait tout l'historique déjà en ligne au lieu de le
      // compléter — l'utilisateur ne retrouverait alors plus les colis des mois précédents.
      showBackupProgress(0, 'Récupération de la sauvegarde existante…');
      const remote = await downloadRemoteBackup(password, (pct) =>
        showBackupProgress(pct * 0.3, `Récupération de la sauvegarde existante… ${Math.round(pct)} %`)
      );
      if(remote && Array.isArray(remote.records) && remote.records.length > 0){
        await importParsedJsonArray(remote.records, 'fusion avant export');
      }

      const exportedAt = new Date().toISOString();
      const envelope = await encryptJsonPayload(database, password, exportedAt);

      // Aucun téléchargement local : la sauvegarde vit uniquement sur Vercel Blob désormais.
      showBackupProgress(0, 'Envoi vers Vercel Blob… 0 %');
      await withTimeout(
        uploadEnvelopeInChunks(envelope, unlockedExportCode, (percentage, totalChunks) =>
          showBackupProgress(percentage, `Envoi vers Vercel Blob… ${Math.round(percentage)} % (${totalChunks} morceau(x))`)
        ),
        180000,
        "Délai dépassé (3 min) — vérifiez que le Blob Store est bien connecté au projet, puis réessayez."
      );

      setDbVersionInfo(exportedAt);
      setDbLog(`Export réussi — ${database.length} commande(s) envoyée(s) sur Vercel Blob.`, false);
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
      const password = await getEncryptionPassword();
      showBackupProgress(0, 'Téléchargement depuis Vercel Blob… 0 %');
      const remote = await downloadRemoteBackup(password, (pct) =>
        showBackupProgress(pct, `Téléchargement depuis Vercel Blob… ${Math.round(pct)} %`)
      );
      if(!remote){
        setDbLog('Aucune sauvegarde trouvée sur Vercel Blob — exportez au moins une fois avant de pouvoir importer.', true);
        return;
      }
      showBackupProgress(100, 'Téléchargement terminé, déchiffrement…');

      await importParsedJsonArray(remote.records, 'data-mg.aiae (Vercel Blob)');
      setDbVersionInfo(remote.exportedAt);
    }catch(err){
      const msg = err && err.message ? err.message : 'erreur inconnue';
      // Message dédié pour l'erreur de mot de passe (déchiffrement AES échoué) plutôt que noyé dans
      // un message générique — c'est presque toujours parce que le code de connexion a changé
      // depuis l'export (le mot de passe en dépend automatiquement, voir getEncryptionPassword).
      if(msg.indexOf('mot de passe incorrect') !== -1){
        setDbLog("Échec de l'import : mot de passe incorrect — le code de connexion actuel ne correspond pas à celui utilisé lors de l'export (ou le fichier est corrompu).", true);
      }else{
        setDbLog(`Échec de l'import depuis Vercel Blob (${msg}).`, true);
      }
    }finally{
      hideBackupProgress();
      els.importBackupBtn.disabled = false;
    }
  });

  els.clearBtn.addEventListener('click', async ()=>{
    if(database.length === 0) return;
    if(!confirm('Voulez-vous vraiment effacer toute la base de données de commandes ? Cette action est irréversible.')) return;
    database = [];
    await saveDatabase();
    render();
    setDbVersionInfo(null);
    setDbLog('Base de données effacée.', false);
  });

  loadDatabase();
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
