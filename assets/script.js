(function(){
  // Colonnes source (index 1-based dans le fichier CSV) -> champ de la base
  const COLS = [
    { key:'numCommande',   label:'N° Commande',               col:4  },
    { key:'commandeAmazon',label:'Commande Amazon',           col:2  },
    { key:'qteCommande',   label:'QTE',                       col:5  },
    { key:'numSuivi',      label:'Num Suivi',                 col:24 },
    { key:'qteExpedie',    label:'QTE_EXPED',                 col:25 },
    { key:'nom',           label:'Nom',                       col:26 },
    { key:'transporteur',  label:'Transporteur',              col:34 },
    { key:'numDernierKm',  label:'Num dernier kilométrique',  col:null } // toujours vide
  ];
  const STORAGE_KEY = 'commandes-db';
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
    count: document.getElementById('count'),
    emptyState: document.getElementById('emptyState'),
    search: document.getElementById('search'),
    displayLimit: document.getElementById('displayLimit'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    jsonFileInput: document.getElementById('jsonFileInput'),
    dbLog: document.getElementById('dbLog'),
    clearBtn: document.getElementById('clearBtn'),
    carrierSection: document.getElementById('carrierSection'),
    carrierTabs: document.getElementById('carrierTabs'),
    carrierPanel: document.getElementById('carrierPanel'),
    fourPxApiConfigModalBg: document.getElementById('fourPxApiConfigModalBg'),
    fourPxScrapeEndpoint: document.getElementById('fourPxScrapeEndpoint'),
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

  // Extrait le Nom depuis la colonne 26 : la valeur utile se trouve entre "CART'IN" et ", CART'IN"
  // (apostrophe droite ou typographique acceptée). Si le motif n'est pas trouvé, renvoie ''.
  function extractNomFromCol26(v){
    const str = String(v ?? '');
    const m = str.match(/CART['’]IN(.*?),\s*CART['’]IN/i);
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
        // Découpage en 2 étapes : on garde les 21 premiers caractères, puis dans ce résultat on
        // garde à partir de la position 9 (13 caractères au final).
        { length: 32, startsWith: '%', endsWith: '^', contentType: 'any', extractType: 'twoStepCut', cut1: 21, cut2: 9 }
      ]
    },
    {
      id: 'colissimo', label: 'Colissimo / Chronopost / DPD', enabled: true,
      rules: [
        // Code de 28 caractères débutant par % (ex. "%0094150116C2111186098802250" -> "6C2111186").
        // Extraction directe des positions 11 à 19 (incluses).
        { length: 28, startsWith: '%', endsWith: '', contentType: 'any', extractType: 'slice', start: 11, end: 19 }
      ]
    },
    {
      id: 'gls', label: 'GLS', enabled: true,
      rules: [
        // Code entièrement numérique : on garde la valeur mais on retire les 2 derniers caractères.
        { length: null, startsWith: '', endsWith: '', contentType: 'digits', extractType: 'removeLast', count: 2 },
        // Code alphanumérique (ex. "GL00L5UAZM" -> "00L5UAZM") : on retire les 2 premiers caractères.
        { length: null, startsWith: '', endsWith: '', contentType: 'alnum', extractType: 'removeFirst', count: 2 }
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
      if(!ruleConditionsMatch(clean, rule)) continue;
      const result = applyExtraction(clean, rule);
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
      removeAlgoBtn.textContent = 'Supprimer l\'algorithme';
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
      addRuleBtn.textContent = '+ Ajouter une condition';
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

  // ---------- stockage persistant (localStorage du navigateur) ----------
  // Remarque : window.storage n'existe que dans l'aperçu Artifacts de Claude.ai — sur un vrai
  // navigateur (Chrome Android, Safari, etc.) il n'existe pas, ce qui provoquait un plantage au
  // démarrage. On utilise donc localStorage, disponible partout.
  function loadDatabase(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      database = raw ? JSON.parse(raw) : [];
    }catch(e){
      database = [];
    }
    render();
  }

  function saveDatabase(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
    }catch(e){
      logLine('Erreur lors de la sauvegarde de la base de données.', true);
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
          rec[c.key] = extractNomFromCol26(v);
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
          database[existingIndex] = { ...database[existingIndex], ...rec };
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
    { key:'4px',        label:'4PX',        match:['4PX'],                     baseUrl:'https://track.cainiao.com/orderTrack?mailNoList=', kmColIndex:1, mode:'url',
      pasteHint: 'Sur la page de suivi ouverte via « Ouvrir », cliquez sur le bouton « Copy Overview » puis collez le texte copié ci-dessous.' },
    { key:'yanwen',     label:'YANWEN',     match:['YANWEN'],                  baseUrl:'https://track.yw56.com.cn/en/querydel?nums=',      kmColIndex:1, mode:'url' },
    { key:'yunexpress', label:'Yun Express',match:['YUN EXPRESS','YUNEXPRESS'],baseUrl:'https://www.yuntrack.com/parcelTracking?id=',       kmColIndex:2, mode:'url' },
    { key:'sfc',        label:'SFC',        match:['SFC'],                     baseUrl:'https://www.sendfromchina.com/track',                kmColIndex:2, mode:'clipboard', pasteHasHeader:true, matchColIndex:1 },
  ];
  const CHUNK_SIZE = 99;

  let carrierGroups = [];   // groupes actuellement présents dans la base (avec numéros + chunks)
  let activeCarrierKey = null;
  let pastedTextByCarrier = {};   // key -> texte collé (conservé lors du changement d'onglet)
  let importLogByCarrier = {};    // key -> { text, err }
  let modalOpenUrl = '';          // URL à ouvrir via le bouton "Ouvrir" de la fenêtre modale

  function normCarrierName(v){
    return String(v || '').trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function chunkArray(arr, size){
    const out = [];
    for(let i=0; i<arr.length; i+=size) out.push(arr.slice(i, i+size));
    return out;
  }

  function computeCarrierGroups(){
    return CARRIERS.map(c=>{
      const nums = database
        .filter(r => c.match.includes(normCarrierName(r.transporteur)))
        .map(r => cleanNumSuivi(r.numSuivi))
        .filter(v => v.length > 0);
      return { ...c, nums, chunks: chunkArray(nums, CHUNK_SIZE) };
    }).filter(g => g.nums.length > 0);
  }

  function getActiveGroup(){
    return carrierGroups.find(g => g.key === activeCarrierKey) || carrierGroups[0] || null;
  }

  function renderCarrierTabs(){
    els.carrierTabs.innerHTML = '';
    carrierGroups.forEach(g=>{
      const btn = document.createElement('button');
      btn.textContent = `${g.label} (${g.nums.length})`;
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
      if(!g.match.includes(normCarrierName(r.transporteur))) return;
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
  // NOTE : l'API officielle 4PX (plateforme "open.4px.com") nécessite un compte marchand /
  // partenaire logiciel et des identifiants (App Key / App Secret) qui ne sont pas publics — voir
  // https://open.4px.com/apiInfo/introduce. Tant que ces identifiants et le format exact de
  // l'endpoint ne sont pas connus, cet appel est fourni en best-effort : il envoie une requête
  // POST JSON générique et lit la réponse selon le mapping de champs configuré ci-dessous. Il est
  // probable qu'il faille l'ajuster (voire passer par un backend, l'API 4PX n'autorisant sans
  // doute pas les appels directs depuis un navigateur pour des raisons de CORS et de signature de
  // requête) une fois les identifiants et la doc réelle obtenus auprès de 4PX.
  const FOURPX_API_CONFIG_KEY = 'fourpx-api-config';

  function loadFourPxApiConfig(){
    try{
      const raw = localStorage.getItem(FOURPX_API_CONFIG_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch(e){
      return {};
    }
  }

  function saveFourPxApiConfig(config){
    try{
      localStorage.setItem(FOURPX_API_CONFIG_KEY, JSON.stringify(config));
    }catch(e){ /* stockage indisponible, la config ne sera pas persistée */ }
  }

  // Lit une valeur imbriquée dans un objet à partir d'un chemin "a.b.c" (chaîne vide = objet racine)
  function readByPath(obj, path){
    if(!path) return obj;
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined) ? acc[key] : undefined, obj);
  }

  function openFourPxApiConfigModal(){
    const config = loadFourPxApiConfig();
    els.fourPxScrapeEndpoint.value = config.scrapeEndpoint || '/api/scrape-4px';
    els.fourPxPageLoadWaitMs.value = config.pageLoadWaitMs || 4000;
    els.fourPxClickWaitMs.value = config.clickWaitMs || 600;
    els.fourPxApiConfigModalBg.style.display = 'block';
  }

  function closeFourPxApiConfigModal(){
    els.fourPxApiConfigModalBg.style.display = 'none';
  }

  els.fourPxApiConfigCancelBtn.addEventListener('click', closeFourPxApiConfigModal);
  els.fourPxApiConfigModalBg.addEventListener('click', (e)=>{
    if(e.target === els.fourPxApiConfigModalBg) closeFourPxApiConfigModal();
  });
  els.fourPxApiConfigSaveBtn.addEventListener('click', ()=>{
    saveFourPxApiConfig({
      scrapeEndpoint: els.fourPxScrapeEndpoint.value.trim() || '/api/scrape-4px',
      pageLoadWaitMs: parseInt(els.fourPxPageLoadWaitMs.value, 10) || 4000,
      clickWaitMs: parseInt(els.fourPxClickWaitMs.value, 10) || 600,
    });
    closeFourPxApiConfigModal();
  });

  // Extrait le tableau de résultats d'une réponse JSON (selon le mapping configuré), met à jour
  // numDernierKm pour les commandes 4PX correspondantes, sauvegarde et journalise le résultat.
  async function applyFourPxResultsToDb(g, json, config, sourceLabel){
    const items = readByPath(json, config.respArrayField);
    if(!Array.isArray(items)){
      const preview = JSON.stringify(json).slice(0, 500);
      importLogByCarrier[g.key] = {
        text: `Réponse de ${sourceLabel} reçue mais le champ « ${config.respArrayField || '(racine)'} » ne contient pas de tableau exploitable — ajustez le mapping des champs. Aperçu brut de la réponse : ${preview}`,
        err: true
      };
      renderCarrierPanel();
      return;
    }

    const updateMap = new Map();
    items.forEach(item=>{
      const trackingNumber = cleanNumSuivi(item[config.respTrackingField]);
      const lastKm = String(item[config.respLastMileField] ?? '').trim();
      if(trackingNumber) updateMap.set(trackingNumber, lastKm);
    });

    let matched = 0;
    database.forEach(r=>{
      if(!g.match.includes(normCarrierName(r.transporteur))) return;
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
        .filter(r => g.match.includes(normCarrierName(r.transporteur)))
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
  }

  // ---------- scraping 4PX via une fonction backend Vercel ----------
  // La fonction serverless /api/scrape-4px.js (voir ce fichier) ouvre réellement la page de suivi
  // Cainiao dans un navigateur headless, attend son chargement, clique sur le bouton "Copy Overview"
  // puis lit le texte copié dans le presse-papier du navigateur headless. Elle renvoie un format
  // fixe et déjà découpé selon la même règle que l'import manuel :
  // { results: [{ trackingNumber, lastKm }, ...] }.
  async function scrapeFourPxViaVercel(g){
    const config = loadFourPxApiConfig();
    const scrapeEndpoint = config.scrapeEndpoint || '/api/scrape-4px';

    importLogByCarrier[g.key] = { text: 'Scraping 4PX (via Vercel) en cours… (ouverture de la page + lecture de "Copy Overview", peut prendre jusqu\'à 30-60 secondes)', err: false };
    renderCarrierPanel();

    let json;
    try{
      const res = await fetch(scrapeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumbers: g.nums,
          pageLoadWaitMs: config.pageLoadWaitMs || 4000,
          clickWaitMs: config.clickWaitMs || 600,
        }),
      });
      json = await res.json();
      if(!res.ok) throw new Error(json && json.error ? json.error : `réponse HTTP ${res.status}`);
    }catch(e){
      importLogByCarrier[g.key] = {
        text: `Échec du scraping (${e && e.message ? e.message : 'erreur réseau'}). ` +
              `Vérifiez que le projet est bien déployé sur Vercel avec le dossier /api, et que l'URL « ${scrapeEndpoint} » est accessible.`,
        err: true
      };
      renderCarrierPanel();
      return;
    }

    if(!Array.isArray(json.results) || json.results.length === 0){
      const debugText = json.debug ? JSON.stringify(json.debug, null, 2) : '(pas de diagnostic disponible)';
      importLogByCarrier[g.key] = {
        text: `Le scraping n'a renvoyé aucun résultat exploitable (bouton "Copy Overview" non trouvé/cliqué ou presse-papier headless inaccessible). Diagnostic : ${debugText}`,
        err: true
      };
      renderCarrierPanel();
      return;
    }

    await applyFourPxResultsToDb(g, json, { respArrayField: 'results', respTrackingField: 'trackingNumber', respLastMileField: 'lastKm' }, 'le scraping Vercel');
  }

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

    const openLabel = g.mode === 'clipboard' ? 'Copier + Ouvrir' : 'Ouvrir';
    const linksHtml = g.chunks.map((chunk, idx)=>
      `<div class="row" style="display:flex; gap:8px; align-items:center; margin:6px 0;">
        <span style="font-size:13px; min-width:150px;">Lien ${idx+1} — ${chunk.length} colis</span>
        <button class="linkOpenBtn" data-idx="${idx}">${openLabel}</button>
        <button class="linkShowBtn" data-idx="${idx}">Afficher</button>
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

    const fourPxApiHtml = g.key === '4px'
      ? `<div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
          <label style="font-size:13px;">Ou importer directement le numéro dernier kilométrique par scraping automatique</label>
          <div class="actions">
            <button id="fourPxScrapeBtn" type="button">Scrapping (Vercel)</button>
            <button id="fourPxApiConfigBtn" type="button" class="secondary">⚙ Config Scraping 4PX</button>
          </div>
        </div>`
      : '';

    els.carrierPanel.innerHTML = `
      <p style="font-size:13px; color:var(--muted);">
        ${g.nums.length} numéro(s) de suivi trouvé(s) pour ${g.label}${g.chunks.length > 1 ? `, répartis en ${g.chunks.length} liens (max ${CHUNK_SIZE} par lien)` : ''}.
      </p>
      ${linksHtml}
      ${noteHtml}
      <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
        <label style="font-size:13px;">Coller les données de suivi ${g.label} (max 10000 caractères) puis cliquer sur Importer</label>
        ${pasteHintHtml}
        <div class="row">
          <textarea id="pasteArea" maxlength="10000" rows="5" style="width:100%; font-size:12px; padding:8px;" placeholder="Collez ici les données copiées depuis la page de suivi ${g.label}…"></textarea>
        </div>
        <div class="actions"><button id="importPasteBtn">Importer</button></div>
      </div>
      ${fourPxApiHtml}
      ${logHtml}
    `;

    const pasteArea = document.getElementById('pasteArea');
    pasteArea.value = pastedTextByCarrier[g.key] || '';
    pasteArea.addEventListener('input', ()=>{ pastedTextByCarrier[g.key] = pasteArea.value; });

    els.carrierPanel.querySelectorAll('.linkOpenBtn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const idx = parseInt(btn.dataset.idx, 10);
        if(g.mode === 'clipboard'){
          const ok = await copyTextToClipboard(g.chunks[idx].join('\n'));
          btn.textContent = ok ? 'Copié !' : 'Échec de la copie';
          window.open(g.baseUrl, '_blank');
          setTimeout(()=>{ btn.textContent = openLabel; }, 1500);
        }else{
          window.open(g.baseUrl + g.chunks[idx].join(','), '_blank');
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
          const url = g.baseUrl + g.chunks[idx].join(',');
          els.trackingUrlBox.value = url;
          modalOpenUrl = url;
        }
        els.trackingModalBg.style.display = 'block';
      });
    });

    document.getElementById('importPasteBtn').addEventListener('click', ()=> handleImportPaste(g));

    if(g.key === '4px'){
      document.getElementById('fourPxScrapeBtn').addEventListener('click', ()=> scrapeFourPxViaVercel(g));
      document.getElementById('fourPxApiConfigBtn').addEventListener('click', openFourPxApiConfigModal);
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
    }else if(els.trackingModalBg.style.display === 'block'){
      els.trackingModalBg.style.display = 'none';
    }else if(els.csvOptionsModalBg.style.display === 'block'){
      closeCsvOptionsModal();
    }else if(els.searchOptionsModalBg.style.display === 'block'){
      closeSearchOptionsModal();
    }else if(els.fourPxApiConfigModalBg.style.display === 'block'){
      closeFourPxApiConfigModal();
    }else if(els.scannerModalBg && els.scannerModalBg.style.display === 'block'){
      stopScanner();
    }else if(els.search.value){
      // Aucune fenêtre ouverte : Échap vide le champ de recherche
      els.search.value = '';
      render();
    }
  });

  // Raccourci ALT+Q : place le curseur dans le champ de recherche, où qu'on soit sur la page.
  // On utilise e.code (position physique de la touche) plutôt que e.key pour que ça marche
  // quel que soit l'agencement du clavier (AZERTY, QWERTY…).
  document.addEventListener('keydown', (e)=>{
    if(!e.altKey || e.ctrlKey || e.metaKey) return;
    if(e.code !== 'KeyQ') return;
    e.preventDefault();
    els.search.focus();
    els.search.select();
  });

  // Coller n'importe où sur la page colle directement dans le champ de recherche, sauf si on a
  // déjà le focus sur un champ éditable (recherche elle-même, zone de collage transporteur, etc.),
  // auquel cas on laisse le comportement natif de collage du champ actif.
  document.addEventListener('paste', (e)=>{
    const active = document.activeElement;
    const isEditable = active && (
      active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
    );
    if(isEditable) return;
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
    'YANWEN': { bg:'#e8f3ff', fg:'#1d4ed8' },
    'YUN EXPRESS': { bg:'#eafbf1', fg:'#0f8a4c' },
    'SFC': { bg:'#f3e8ff', fg:'#7e22ce' },
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
      { label:'Transporteur',              value:r.transporteur },
      { label:'Num Suivi',                 value:r.numSuivi },
      { label:'Commande Amazon',           value:r.commandeAmazon },
      { label:'N° Commande',               value:r.numCommande },
      { label:'Nom',                       value:r.nom },
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

    els.packageModalBg.style.display = 'block';
  }

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
    const filtered = term
      ? database.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)))
      : database;
    const limitVal = els.displayLimit.value; // 'all' ou nombre en chaîne
    const reversedFiltered = filtered.slice().reverse();
    const rows = limitVal === 'all' ? reversedFiltered : reversedFiltered.slice(0, parseInt(limitVal, 10));

    els.dbCards.innerHTML = '';
    rows.forEach(r=> els.dbCards.appendChild(buildDbCard(r)));

    els.rowCount.textContent = database.length;

    if(term && filtered.length < database.length){
      els.count.textContent = `${rows.length} affichée(s) / ${filtered.length} résultat(s) / ${database.length} commande(s) au total`;
    }else if(limitVal !== 'all' && database.length > parseInt(limitVal, 10)){
      els.count.textContent = `${rows.length} affichée(s) sur ${database.length} commande(s) (limite : ${limitVal})`;
    }else{
      els.count.textContent = '';
    }

    els.emptyState.textContent = database.length === 0
      ? 'Aucune commande en base pour le moment. Importez un CSV pour commencer.'
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

  // ---------- mode plein écran de la section "2. Base de données" ----------
  // Le bouton en haut à droite de la section bascule l'affichage : seuls l'en-tête de l'app et
  // cette section restent visibles. Seul un nouveau clic sur ce même bouton permet de revenir en
  // arrière — volontairement, la touche Échap ne fait rien dans ce mode.
  els.focusDbBtn.addEventListener('click', ()=>{
    const active = document.body.classList.toggle('focus-mode');
    els.focusDbBtn.textContent = active ? '✕' : '⛶';
    els.focusDbBtn.title = active ? 'Quitter le mode plein écran' : 'Afficher uniquement cette section';
  });

  // ---------- export / import JSON ----------
  let dbLogTimer = null;
  function setDbLog(text, isErr){
    els.dbLog.textContent = text;
    els.dbLog.style.color = isErr ? 'var(--danger)' : 'var(--success)';
    // Le message disparaît tout seul au bout d'1 minute
    if(dbLogTimer) clearTimeout(dbLogTimer);
    dbLogTimer = setTimeout(()=>{ els.dbLog.textContent = ''; }, 60000);
  }

  els.exportJsonBtn.addEventListener('click', ()=>{
    if(database.length === 0){ setDbLog('Aucune donnée à exporter.', true); return; }
    try{
      const json = JSON.stringify(database, null, 2);
      const blob = new Blob([json], { type:'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'base-commandes-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDbLog(`Export réussi — ${database.length} commande(s) exportée(s) en JSON.`, false);
    }catch(e){
      setDbLog(`Échec de l'export JSON (${e && e.message ? e.message : 'erreur inconnue'}).`, true);
    }
  });

  els.jsonFileInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;

    let text;
    try{
      text = await readFileAsText(file);
    }catch(err){
      setDbLog(`${file.name} — échec de la lecture du fichier (${err && err.message ? err.message : 'erreur inconnue'}).`, true);
      e.target.value = '';
      return;
    }

    if(!text || text.trim().length === 0){
      setDbLog(`${file.name} — le fichier est vide.`, true);
      e.target.value = '';
      return;
    }

    let parsed;
    try{
      parsed = JSON.parse(text);
    }catch(err){
      setDbLog(`${file.name} — ce n'est pas un JSON valide (${err.message}).`, true);
      e.target.value = '';
      return;
    }

    if(!Array.isArray(parsed)){
      setDbLog(`${file.name} — le fichier JSON doit contenir un tableau de commandes ([...]), pas un objet unique.`, true);
      e.target.value = '';
      return;
    }

    if(parsed.length === 0){
      setDbLog(`${file.name} — le tableau JSON est vide, aucune commande à importer.`, true);
      e.target.value = '';
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
          database[existingIndex] = { ...database[existingIndex], ...rec };
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
      setDbLog(`${file.name} — aucune entrée valide trouvée dans le tableau JSON (${skipped} élément(s) ignoré(s), format inattendu).`, true);
      e.target.value = '';
      return;
    }

    await saveDatabase();
    render();
    e.target.value = '';
    const jsonSummary = [];
    if(added > 0) jsonSummary.push(`${added} ajoutée(s)`);
    if(updated > 0) jsonSummary.push(`${updated} mise(s) à jour`);
    setDbLog(`${file.name} — ${jsonSummary.join(', ')}.` + (skipped > 0 ? ` ${skipped} élément(s) ignoré(s) (format invalide).` : ''), false);
  });

  els.clearBtn.addEventListener('click', async ()=>{
    if(database.length === 0) return;
    if(!confirm('Voulez-vous vraiment effacer toute la base de données de commandes ? Cette action est irréversible.')) return;
    database = [];
    await saveDatabase();
    render();
    setDbLog('Base de données effacée.', false);
  });

  loadDatabase();

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
})();
