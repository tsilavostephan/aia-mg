// Application "Mobile" : uniquement la caméra + le résultat. Pas de recherche manuelle, pas
// d'accès au reste de l'app (voir middleware.js — un compte de rôle "mobile" est de toute façon
// redirigé vers cette page pour tout le reste du site). Reprend délibérément une partie du moteur
// de reconnaissance de numéro de suivi et de la logique de scan continu ("mode rafale") déjà
// présents dans assets/script.js — dupliqués ici plutôt qu'importés : ce projet n'a pas de bundler,
// seulement des balises <script> classiques, et cette page doit rester légère et indépendante du
// reste de l'application (pas tout script.js).
(function(){
  'use strict';

  const els = {
    readerContainer: document.getElementById('scanReaderContainer'),
    errorBox: document.getElementById('scanError'),
    resultOverlay: document.getElementById('scanResultOverlay'),
    resultBody: document.getElementById('scanResultBody'),
    newScanBtn: document.getElementById('newScanBtn'),
    message: document.getElementById('scanMessage'),
    version: document.getElementById('scanVersion'),
  };

  async function dbGet(action, params){
    const qs = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/db?${qs.toString()}`, { cache: 'no-store' });
    if(!res.ok){
      const errData = await res.json().catch(() => null);
      throw new Error(errData && errData.error ? errData.error : `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ---------- reconnaissance du numéro de suivi scanné (copie de assets/script.js) ----------
  function cleanNumSuivi(v){
    return String(v ?? '').replace(/[="'\\]/g, '').trim();
  }
  function stripSpecialCharsEdges(str){
    return String(str || '').replace(/^[^0-9A-Za-z]+/, '').replace(/[^0-9A-Za-z]+$/, '');
  }
  async function trackingExistsInDb(value){
    if(!value) return false;
    try{
      const { exists } = await dbGet('exists', { numSuivi: value });
      return exists;
    }catch(e){
      return false;
    }
  }

  const SEARCH_ALGOS_STORAGE_KEY = 'commandes-search-algos';
  const DEFAULT_SEARCH_ALGORITHMS = [
    { id:'laposte', label:'La Poste', enabled:true, rules:[
      { length:32, startsWith:'%', endsWith:'^', contentType:'any', extractType:'twoStepCut', cut1:22, cut2:9 }
    ]},
    { id:'colissimo', label:'Colissimo', enabled:true, rules:[
      { length:28, startsWith:'%', endsWith:'', contentType:'any', extractType:'slice', start:11, end:22 }
    ]},
    { id:'chronopost', label:'Chronopost', enabled:true, rules:[
      { length:28, startsWith:'%', endsWith:'', contentType:'any', extractType:'slice', start:11, end:22 }
    ]},
    { id:'dpd', label:'DPD', enabled:true, rules:[
      { length:28, startsWith:'', endsWith:'', contentType:'digits', extractType:'slice', start:8, end:21 }
    ]},
    { id:'gls', label:'GLS', enabled:true, rules:[
      { length:13, startsWith:'', endsWith:'', contentType:'digits', extractType:'removeLast', count:2 },
      { length:16, startsWith:'', endsWith:'', contentType:'digits', extractType:'removeLast', count:2 },
      { length:10, startsWith:'', endsWith:'', contentType:'alnum', extractType:'removeFirst', count:2 },
      { length:13, startsWith:'', endsWith:'', contentType:'alnum', extractType:'removeFirst', count:2 }
    ]},
  ];
  let SEARCH_ALGORITHMS = DEFAULT_SEARCH_ALGORITHMS;
  try{
    const raw = localStorage.getItem(SEARCH_ALGOS_STORAGE_KEY);
    if(raw){
      const saved = JSON.parse(raw);
      if(Array.isArray(saved) && saved.length > 0) SEARCH_ALGORITHMS = saved;
    }
  }catch(e){ /* config invalide, on garde les algorithmes par défaut */ }

  function contentTypeMatches(str, type){
    if(type === 'digits') return /^[0-9]+$/.test(str);
    if(type === 'alnum') return /^[A-Za-z0-9]+$/.test(str);
    return true;
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
  function runSearchAlgorithm(algo, raw){
    if(!algo.enabled) return null;
    const clean = String(raw || '').replace(/\s+/g, '');
    for(const rule of (algo.rules || [])){
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
  async function computeBestTracking(raw){
    const stripped = stripSpecialCharsEdges(raw);
    if(stripped && await trackingExistsInDb(stripped)) return stripped;
    const results = SEARCH_ALGORITHMS.map(algo => runSearchAlgorithm(algo, raw)).filter(v => v);
    for(const v of results){
      if(await trackingExistsInDb(v)) return v;
    }
    return stripped || results[0] || null;
  }

  // ---------- affichage du résultat ----------
  function escapeHtml(v){
    return String(v ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function showMessage(text){
    els.message.textContent = text;
    els.message.classList.add('visible');
    clearTimeout(showMessage._t);
    showMessage._t = setTimeout(()=>{ els.message.classList.remove('visible'); }, 2200);
  }

  function showPackageResult(r){
    const qteMatch = String(r.qteCommande || '').trim() !== '' && String(r.qteCommande || '').trim() === String(r.qteExpedie || '').trim();
    const fields = [
      { label:'N° Commande', value:r.numCommande },
      { label:'Commande Amazon', value:r.commandeAmazon },
      { label:'Num Suivi', value:r.numSuivi },
      { label:'Transporteur', value:r.transporteur },
      { label:'Nom', value:r.nom },
      { label:'QTE', value:r.qteCommande, cls: qteMatch ? 'qty-match' : 'qty-mismatch' },
      { label:'QTE_EXPED', value:r.qteExpedie, cls: qteMatch ? 'qty-match' : 'qty-mismatch' },
      { label:'Num dernier kilométrique', value:r.numDernierKm, cls:'bold' },
    ];
    els.resultBody.innerHTML = fields.map(f => `
      <div class="scan-result-row">
        <span class="scan-result-label">${f.label}</span>
        <span class="scan-result-value${f.cls ? ' ' + f.cls : ''}">${escapeHtml(f.value) || '—'}</span>
      </div>
    `).join('');
    els.resultOverlay.classList.add('visible');
  }

  function hidePackageResult(){
    els.resultOverlay.classList.remove('visible');
  }
  els.newScanBtn.addEventListener('click', hidePackageResult);

  // ---------- scan continu (caméra jamais arrêtée, façon "mode rafale" de l'app principale) ----------
  let lastValue = '';
  let lastTime = 0;
  const COOLDOWN_MS = 2500;

  async function handleDecode(decodedText){
    const now = Date.now();
    if(decodedText === lastValue && (now - lastTime) < COOLDOWN_MS) return;
    lastValue = decodedText;
    lastTime = now;

    if(els.resultOverlay.classList.contains('visible')) return; // une fiche est déjà affichée, on attend "Nouveau scan"

    try{
      const transformed = await computeBestTracking(decodedText);
      const value = transformed || decodedText;
      const result = await dbGet('search', { q: value, limit: 2, offset: 0 });
      if(result.total === 1 && result.rows.length === 1){
        showPackageResult(result.rows[0]);
      }else if(result.total === 0){
        showMessage('Aucun colis trouvé pour ce code.');
      }else{
        showMessage('Plusieurs colis correspondent — impossible de choisir automatiquement.');
      }
    }catch(e){
      showMessage(e && e.message ? e.message : 'Erreur de recherche.');
    }
  }

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

  async function startScanner(){
    if(typeof Html5Qrcode === 'undefined'){
      els.errorBox.textContent = "La bibliothèque de scan n'a pas pu être chargée — vérifiez votre connexion internet.";
      els.errorBox.style.display = 'block';
      return;
    }
    const scanner = new Html5Qrcode('scanReaderContainer', {
      formatsToSupport: scannerFormats(),
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    try{
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 15,
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
        (decodedText) => { handleDecode(decodedText); },
        () => { /* échecs de lecture image par image : ignorés silencieusement */ }
      );
    }catch(err){
      els.errorBox.textContent = `Impossible d'accéder à la caméra (${err && err.message ? err.message : 'permission refusée ou aucune caméra détectée'}).`;
      els.errorBox.style.display = 'block';
    }
  }

  fetch('/api/version', { cache: 'no-store' })
    .then(r => r.json())
    .then(({ version }) => { if(version) els.version.textContent = version; })
    .catch(() => {});

  startScanner();
})();
