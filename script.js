(function(){
  // Colonnes source (index 1-based dans le fichier CSV) -> champ de la base
  const COLS = [
    { key:'numCommande',   label:'N° Commande',               col:4  },
    { key:'commandeAmazon',label:'Commande Amazon',           col:2  },
    { key:'qteCommande',   label:'QTE',                       col:5  },
    { key:'numSuivi',      label:'Num Suivi',                 col:24 },
    { key:'qteExpedie',    label:'QTE_EXPED',                 col:25 },
    { key:'transporteur',  label:'Transporteur',              col:34 },
    { key:'numDernierKm',  label:'Num dernier kilométrique',  col:null } // toujours vide
  ];
  const STORAGE_KEY = 'commandes-db';

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
    scanBtn: document.getElementById('scanBtn'),
    scannerModalBg: document.getElementById('scannerModalBg'),
    scannerReaderContainer: document.getElementById('scannerReaderContainer'),
    scannerError: document.getElementById('scannerError'),
    closeScannerBtn: document.getElementById('closeScannerBtn'),
  };

  let selectedFiles = [];
  let database = []; // { numCommande, commandeAmazon, qteCommande, numSuivi, qteExpedie, transporteur, numDernierKm }

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

  // Nettoie la colonne Num Suivi : retire =, ", ', et les antislash d'échappement
  function cleanNumSuivi(v){
    return String(v ?? '').replace(/[="'\\]/g, '').trim();
  }

  // Calcul de la clé Colissimo (algorithme du fichier Calcul_clé_Colis_colisimo.xlsx)
  // S'applique uniquement si la valeur scannée fait exactement 28 caractères : en extrait le préfixe (2 lettres)
  // et le numéro à 10 chiffres, calcule la clé de contrôle, et renvoie le numéro de suivi final.
  function computeColissimoTracking(raw){
    const clean = String(raw || '').replace(/\s+/g, '');
    if(clean.length !== 28) return null;

    const seg = clean; // la valeur entière constitue la zone utile (28 caractères)
    const prefix = seg.slice(9, 11);   // 2 lettres (ex. "6C")
    const core = seg.slice(11, 21);    // 10 chiffres du numéro de suivi

    if(!/^[A-Za-z0-9]{2}$/.test(prefix) || !/^\d{10}$/.test(core)) return null;

    const digits = core.split('').map(Number);
    const oddSum  = digits[0] + digits[2] + digits[4] + digits[6] + digits[8]; // positions 1,3,5,7,9
    const evenSum = digits[1] + digits[3] + digits[5] + digits[7] + digits[9]; // positions 2,4,6,8,10
    const total = oddSum + evenSum * 3;
    const roundedUp = Math.ceil(total / 10) * 10;
    const checkDigit = roundedUp - total;

    return prefix.toUpperCase() + core + String(checkDigit);
  }

  // Calcule la clé de contrôle ISO/IEC 7064 MOD 37,36 d'une chaîne alphanumérique
  // (algorithme partagé par les convertisseurs DPD et La Poste).
  function mod3736CheckChar(core){
    const MOD = 36, MODP1 = 37;
    let r = MOD;
    for(let i=0; i<core.length; i++){
      const ch = core[i];
      const val = /[0-9]/.test(ch) ? Number(ch) : (ch.toUpperCase().charCodeAt(0) - 55);
      let sum = r + val;
      if(sum > MOD) sum -= MOD;
      const doubled = sum * 2;
      r = doubled >= MODP1 ? doubled - MODP1 : doubled;
    }
    const k = (MODP1 - r) === MOD ? 0 : (MODP1 - r);
    return k < 10 ? String(k) : String.fromCharCode(55 + k);
  }

  // Calcul du numéro de suivi DPD (algorithme du fichier dpd.xlsx)
  // S'applique uniquement si la valeur scannée fait exactement 28 caractères : en extrait le
  // numéro de suivi brut (14 caractères), calcule la clé de contrôle via ISO/IEC 7064 MOD 37,36,
  // et renvoie le numéro de suivi final (14 caractères + 1 clé).
  function computeDpdTracking(raw){
    const clean = String(raw || '').replace(/\s+/g, '');
    if(clean.length !== 28) return null;

    const core = clean.slice(7, 21); // 14 caractères du numéro de suivi brut
    if(!/^[A-Za-z0-9]{14}$/.test(core)) return null;

    return core + mod3736CheckChar(core);
  }

  // Calcul du numéro de suivi La Poste, à partir d'un code-barres scanné de 32 caractères
  // encadré par % ... ^ (ex. "%000000088000232558316600250A18^").
  // Le numéro de suivi brut (14 caractères) se trouve aux positions 9 à 22 ; la clé de contrôle
  // se calcule avec le même algorithme ISO/IEC 7064 MOD 37,36 que le convertisseur DPD.
  function computeLaPosteTracking(raw){
    const clean = String(raw || '').replace(/\s+/g, '');
    if(clean.length !== 32) return null;
    if(clean[0] !== '%' || clean[clean.length - 1] !== '^') return null;

    const core = clean.slice(8, 22); // 14 caractères du numéro de suivi brut
    if(!/^[A-Za-z0-9]{14}$/.test(core)) return null;

    return core + mod3736CheckChar(core);
  }

  // Un numéro de suivi calculé correspond-il à une commande déjà présente en base ?
  function trackingExistsInDb(value){
    if(!value) return false;
    const v = value.toLowerCase();
    return database.some(r => cleanNumSuivi(r.numSuivi).toLowerCase() === v);
  }

  // Détermine le meilleur numéro de suivi à partir d'une valeur scannée/collée : on essaie
  // Colissimo, puis DPD, puis La Poste, et on retient le premier résultat qui correspond à une
  // commande déjà présente en base. Si aucun ne correspond, on garde le comportement historique
  // (Colissimo par défaut si calculable, sinon DPD, sinon La Poste).
  function computeBestTracking(raw){
    const colissimo = computeColissimoTracking(raw);
    const dpd = computeDpdTracking(raw);
    const laposte = computeLaPosteTracking(raw);

    if(colissimo && trackingExistsInDb(colissimo)) return colissimo;
    if(dpd && trackingExistsInDb(dpd)) return dpd;
    if(laposte && trackingExistsInDb(laposte)) return laposte;

    return colissimo || dpd || laposte || null;
  }

  // Applique la transformation (Colissimo, DPD ou La Poste selon ce qui correspond en base)
  // sur le champ de recherche
  function applyColissimoTransformIfNeeded(){
    const transformed = computeBestTracking(els.search.value);
    if(transformed){
      els.search.value = transformed;
      render();
      return true;
    }
    return false;
  }

  // ---------- stockage persistant ----------
  async function loadDatabase(){
    try{
      const res = await window.storage.get(STORAGE_KEY, false);
      database = res && res.value ? JSON.parse(res.value) : [];
    }catch(e){
      database = [];
    }
    render();
  }

  async function saveDatabase(){
    try{
      await window.storage.set(STORAGE_KEY, JSON.stringify(database), false);
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
  }

  function rowToRecord(row){
    const rec = {};
    COLS.forEach(c=>{
      if(c.col === null){
        rec[c.key] = '';
      }else{
        const raw = row[c.col - 1];
        const v = (raw === undefined || raw === null) ? '' : String(raw).trim();
        rec[c.key] = c.key === 'numSuivi' ? cleanNumSuivi(v) : v;
      }
    });
    return rec;
  }

  els.importBtn.addEventListener('click', async ()=>{
    if(selectedFiles.length === 0) return;
    els.importBtn.disabled = true;
    let totalAdded = 0;

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
      let shortRows = 0;
      rows.forEach(row=>{
        if(!row || row.every(c => c === '' || c === undefined)) return;
        if(row.length < maxColNeeded) shortRows++;
        database.push(rowToRecord(row));
        added++;
      });

      if(added === 0){
        logLine(`${file.name} — 0 ligne ajoutée (toutes les lignes lues étaient vides).`, true);
        continue;
      }

      totalAdded += added;
      logLine(`${file.name} — ${added} ligne(s) ajoutée(s).`);
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
    logLine(`Import terminé — ${totalAdded} commande(s) ajoutée(s) au total.`);
  });

  // ---------- transporteurs pris en charge et gabarits d'URL de suivi ----------
  const CARRIERS = [
    { key:'4px',        label:'4PX',        match:['4PX'],                     baseUrl:'https://track.cainiao.com/orderTrack?mailNoList=', kmColIndex:1, mode:'url' },
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

    els.carrierPanel.innerHTML = `
      <p style="font-size:13px; color:var(--muted);">
        ${g.nums.length} numéro(s) de suivi trouvé(s) pour ${g.label}${g.chunks.length > 1 ? `, répartis en ${g.chunks.length} liens (max ${CHUNK_SIZE} par lien)` : ''}.
      </p>
      ${linksHtml}
      ${noteHtml}
      <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
        <label style="font-size:13px;">Coller les données de suivi ${g.label} (max 10000 caractères) puis cliquer sur Importer</label>
        <div class="row">
          <textarea id="pasteArea" maxlength="10000" rows="5" style="width:100%; font-size:12px; padding:8px;" placeholder="Collez ici les données copiées depuis la page de suivi ${g.label}…"></textarea>
        </div>
        <div class="actions"><button id="importPasteBtn">Importer</button></div>
        ${logHtml}
      </div>
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
    }else if(els.scannerModalBg && els.scannerModalBg.style.display === 'block'){
      stopScanner();
    }
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
    const fields = [
      { label:'Transporteur',              value:r.transporteur },
      { label:'Num Suivi',                 value:r.numSuivi },
      { label:'Commande Amazon',           value:r.commandeAmazon },
      { label:'N° Commande',               value:r.numCommande },
      { label:'QTE',                       value:r.qteCommande },
      { label:'QTE_EXPED',                 value:r.qteExpedie },
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
      row.appendChild(createCopySpan(f.value || '—'));
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

  // Transformation Colissimo : au collage (Ctrl+V), à la touche Entrée (bipeur physique)
  // ou en quittant le champ (change), si la valeur dépasse 28 caractères.
  els.search.addEventListener('paste', ()=>{
    setTimeout(()=>{ if(!applyColissimoTransformIfNeeded()) render(); }, 0);
  });
  els.search.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') applyColissimoTransformIfNeeded();
  });
  els.search.addEventListener('change', applyColissimoTransformIfNeeded);

  // ---------- export / import JSON ----------
  function setDbLog(text, isErr){
    els.dbLog.textContent = text;
    els.dbLog.style.color = isErr ? 'var(--danger)' : 'var(--success)';
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
    let skipped = 0;
    parsed.forEach(item=>{
      if(item && typeof item === 'object' && !Array.isArray(item)){
        const rec = {};
        keys.forEach(k => rec[k] = item[k] !== undefined && item[k] !== null ? String(item[k]) : '');
        rec.numSuivi = cleanNumSuivi(rec.numSuivi);
        database.push(rec);
        added++;
      }else{
        skipped++;
      }
    });

    if(added === 0){
      setDbLog(`${file.name} — aucune entrée valide trouvée dans le tableau JSON (${skipped} élément(s) ignoré(s), format inattendu).`, true);
      e.target.value = '';
      return;
    }

    await saveDatabase();
    render();
    e.target.value = '';
    setDbLog(`${file.name} — ${added} commande(s) importée(s) avec succès.` + (skipped > 0 ? ` ${skipped} élément(s) ignoré(s) (format invalide).` : ''), false);
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
})();
