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
    readerPlaceholder: document.getElementById('scanReaderPlaceholder'),
    errorBox: document.getElementById('scanError'),
    resultOverlay: document.getElementById('scanResultOverlay'),
    resultBody: document.getElementById('scanResultBody'),
    resultQr: document.getElementById('scanResultQr'),
    hiddenInput: document.getElementById('scanHiddenInput'),
    newScanBtn: document.getElementById('newScanBtn'),
    message: document.getElementById('scanMessage'),
    notFoundOverlay: document.getElementById('scanNotFoundOverlay'),
    notFoundCode: document.getElementById('scanNotFoundCode'),
    version: document.getElementById('scanVersion'),
    toggleCameraBtn: document.getElementById('toggleCameraBtn'),
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
      // Le numéro de suivi complet inclut une clé de contrôle calculée (voir colissimoKey /
      // applyExtraction ci-dessous) — une simple sous-chaîne (ex. "6A0750391009") est un caractère
      // trop courte et ne correspond à aucun colis en base (le vrai numéro est "6A07503910096").
      { length:28, startsWith:'%', endsWith:'', contentType:'any', extractType:'colissimoKey', prefixStart:11, prefixLen:2, numStart:13, numLen:10 }
    ]},
    { id:'chronopost', label:'Chronopost', enabled:true, rules:[
      { length:28, startsWith:'%', endsWith:'', contentType:'any', extractType:'colissimoKey', prefixStart:11, prefixLen:2, numStart:13, numLen:10 }
    ]},
    { id:'dpd', label:'DPD', enabled:true, rules:[
      { length:28, startsWith:'', endsWith:'', contentType:'digits', extractType:'slice', start:8, end:21 },
      // Format officiel avec clé de contrôle du bloc en position 28 (DPD Parcel Label Specification
      // v2.4.1, §4.6.1.4) : le caractère 28 (souvent une lettre) empêche la règle "digits"
      // ci-dessus de matcher. Numéro de suivi client = champ T (positions 8-21, 14 caractères) +
      // clé calculée séparément par ISO/IEC 7064 MOD 37,36 (voir iso7064Mod3736 ci-dessous), ex.
      // "009415010913008577590101902P" -> T="10913008577590" -> "10913008577590U".
      { length:28, startsWith:'', endsWith:'', contentType:'alnum', extractType:'dpdChecksum', numStart:8, numLen:14 }
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
      case 'colissimoKey': {
        const prefixStart = Number(rule.prefixStart), prefixLen = Number(rule.prefixLen);
        const numStart = Number(rule.numStart), numLen = Number(rule.numLen);
        if(!prefixStart || !prefixLen || !numStart || !numLen) return null;
        if(clean.length < prefixStart - 1 + prefixLen || clean.length < numStart - 1 + numLen) return null;
        const prefix = clean.slice(prefixStart - 1, prefixStart - 1 + prefixLen);
        const numStr = clean.slice(numStart - 1, numStart - 1 + numLen);
        if(!/^[0-9]+$/.test(numStr)) return null;
        let oddSum = 0, evenSum = 0;
        for(let i = 0; i < numStr.length; i++){
          const digit = Number(numStr[i]);
          if((i + 1) % 2 === 1) oddSum += digit; else evenSum += digit;
        }
        const total = oddSum + evenSum * 3;
        const key = Math.ceil(total / 10) * 10 - total;
        return prefix + numStr + String(key);
      }
      case 'dpdChecksum': {
        const numStart = Number(rule.numStart), numLen = Number(rule.numLen);
        if(!numStart || !numLen) return null;
        if(clean.length < numStart - 1 + numLen) return null;
        const numStr = clean.slice(numStart - 1, numStart - 1 + numLen);
        const key = iso7064Mod3736(numStr);
        if(!key) return null;
        return numStr + key;
      }
      default: return null;
    }
  }

  // Clé de contrôle ISO/IEC 7064 MOD 37,36 (DPD Parcel Label Specification v2.4.1, §4.6.1.4) : un
  // caractère (0-9 ou A-Z) calculé à partir d'une chaîne alphanumérique. Copie de la même fonction
  // dans assets/script.js (voir ce fichier pour le détail du calcul).
  function iso7064Mod3736(str){
    const s = String(str || '');
    if(!s) return null;
    const M = 36, M1 = 37;
    let p = M;
    for(let i = 0; i < s.length; i++){
      const ch = s[i];
      let val;
      if(/[0-9]/.test(ch)) val = Number(ch);
      else if(/[A-Za-z]/.test(ch)) val = 10 + (ch.toUpperCase().charCodeAt(0) - 65);
      else return null;
      p += val;
      if(p > M) p -= M;
      p *= 2;
      if(p >= M1) p -= M1;
    }
    const index = M1 - p;
    if(index === M) return '0';
    return index < 10 ? String(index) : String.fromCharCode(65 + (index - 10));
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
  // Si aucun candidat ne correspond exactement à un num_suivi déjà en base (colis pas encore
  // résolu, typiquement), un résultat d'algorithme (déjà découpé selon un format de transporteur
  // connu) passe AVANT le simple "stripped" (juste les bords retirés, donc les données brutes du
  // code-barres) — bien plus susceptible d'être le bon numéro que le texte brut tel quel.
  async function computeBestTracking(raw){
    const stripped = stripSpecialCharsEdges(raw);
    if(stripped && await trackingExistsInDb(stripped)) return stripped;
    const results = SEARCH_ALGORITHMS.map(algo => runSearchAlgorithm(algo, raw)).filter(v => v);
    for(const v of results){
      if(await trackingExistsInDb(v)) return v;
    }
    return results[0] || stripped || null;
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
    // Referme le popup "colis non trouvé" s'il était encore affiché (rafale rapide) : sinon il
    // resterait visible par-dessus cette fiche jusqu'à l'expiration de son propre délai.
    clearTimeout(showNotFoundPopup._t);
    els.notFoundOverlay.classList.remove('visible');

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

    // QR code encodant le numéro de suivi (même logique que la fiche colis de l'app principale,
    // voir openPackageModal dans assets/script.js) : permet de rescanner ce colis plus tard.
    els.resultQr.innerHTML = '';
    if(r.numSuivi && typeof QRCode !== 'undefined'){
      try{
        new QRCode(els.resultQr, {
          text: r.numSuivi,
          width: 148,
          height: 148,
          colorDark: '#1f2937',
          colorLight: '#ffffff',
        });
      }catch(e){ /* génération QR indisponible, on ignore silencieusement */ }
    }

    els.resultOverlay.classList.add('visible');
  }

  function hidePackageResult(){
    els.resultOverlay.classList.remove('visible');
  }
  els.newScanBtn.addEventListener('click', hidePackageResult);

  // Popup plein écran (pas un simple message discret en bas d'écran) quand le code scanné ne
  // correspond à aucun colis en base — se ferme toute seule après un court délai pour rester
  // hands-free (mode rafale). Referme aussi une fiche colis déjà affichée : sinon, une fois le
  // popup disparu, l'ancienne fiche resterait visible en arrière-plan alors que CE code-là n'a
  // rien donné, ce qui prêterait à confusion.
  function showNotFoundPopup(code){
    hidePackageResult();
    els.notFoundCode.textContent = code || '';
    els.notFoundOverlay.classList.add('visible');
    clearTimeout(showNotFoundPopup._t);
    showNotFoundPopup._t = setTimeout(()=>{ els.notFoundOverlay.classList.remove('visible'); }, 2200);
  }

  // ---------- scan continu (caméra jamais arrêtée, façon "mode rafale" de l'app principale) ----------
  let lastValue = '';
  let lastTime = 0;
  const COOLDOWN_MS = 2500;

  async function handleDecode(decodedText){
    const now = Date.now();
    if(decodedText === lastValue && (now - lastTime) < COOLDOWN_MS) return;
    lastValue = decodedText;
    lastTime = now;

    // Mode rafale : un nouveau scan remplace directement la fiche affichée, sans avoir à passer
    // par "Nouveau scan" au préalable — showPackageResult() reconstruit tout son contenu à chaque
    // appel, donc l'enchaînement colis après colis reste possible même fiche ouverte.
    try{
      const transformed = await computeBestTracking(decodedText);
      const value = transformed || decodedText;
      const result = await dbGet('search', { q: value, limit: 2, offset: 0 });
      if(result.total === 1 && result.rows.length === 1){
        showPackageResult(result.rows[0]);
      }else if(result.total === 0){
        showNotFoundPopup(value);
      }else{
        showMessage('Plusieurs colis correspondent — impossible de choisir automatiquement.');
      }
    }catch(e){
      showMessage(e && e.message ? e.message : 'Erreur de recherche.');
    }
  }

  // ---------- douchette code-barres (USB/Bluetooth, se comporte comme un clavier) ----------
  // Ce type d'appareil "tape" le code scanné puis Entrée dans l'élément qui a le focus — sans
  // champ de saisie toujours focus, ces frappes se perdraient (cette page n'a normalement aucun
  // champ de texte, tout se fait par la caméra). Deux mécanismes en parallèle, volontairement
  // redondants :
  //  1) #scanHiddenInput reste focus en permanence, jamais visible ni ouvert de clavier virtuel
  //     (inputmode="none") — la méthode "propre", mais qui dépend de la gestion du focus.
  //  2) Une capture globale sur `document`, indépendante du focus (tant que le focus est quelque
  //     part sur la page, keydown remonte jusqu'à document) : un filet de sécurité si, sur un
  //     appareil/navigateur donné, le focus venait à être repris par autre chose (ex. le bouton
  //     lampe torche injecté par html5-qrcode) sans qu'on l'ait anticipé.
  function refocusHiddenInput(){
    els.hiddenInput.focus({ preventScroll: true });
  }
  els.hiddenInput.addEventListener('blur', ()=> setTimeout(refocusHiddenInput, 50));
  document.addEventListener('click', ()=> setTimeout(refocusHiddenInput, 50));
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) refocusHiddenInput(); });
  refocusHiddenInput();

  // Tampon global : une douchette "tape" ses caractères bien plus vite qu'un humain (quelques
  // millisecondes entre chaque touche) — au-delà de HID_CHAR_GAP_MS sans nouveau caractère, on
  // considère qu'il s'agissait d'autre chose (ou d'un scan précédent resté incomplet) et on repart
  // de zéro, plutôt que d'accumuler indéfiniment.
  let hidBuffer = '';
  let hidLastCharTime = 0;
  const HID_CHAR_GAP_MS = 150;

  document.addEventListener('keydown', (e)=>{
    // La plupart des douchettes terminent par Entrée (certains modèles par Tabulation).
    if(e.key === 'Enter' || e.key === 'Tab'){
      if(!hidBuffer) return;
      const value = hidBuffer;
      hidBuffer = '';
      if(els.hiddenInput.value) els.hiddenInput.value = ''; // évite un doublon si les deux mécanismes ont capté la même frappe
      e.preventDefault();
      handleDecode(value);
      return;
    }
    if(e.key.length !== 1) return; // ignore Shift/Alt/flèches/etc., un seul caractère "imprimable" à la fois
    const now = Date.now();
    if(now - hidLastCharTime > HID_CHAR_GAP_MS) hidBuffer = '';
    hidBuffer += e.key;
    hidLastCharTime = now;
  });

  // Certaines douchettes n'émettent aucune touche individuelle : elles collent directement le
  // texte (soit un vrai "coller" avec presse-papier, soit une insertion IME côté Android/iOS) —
  // le clavier "keydown" ci-dessus ne voit alors rien passer. Deux filets supplémentaires :
  //  1) l'événement "paste" natif (Ctrl+V ou équivalent programmatique), traité immédiatement.
  //  2) l'événement "input" du champ caché (se déclenche quel que soit le mécanisme d'insertion,
  //     y compris une insertion IME sans "paste" ni "keydown") : on attend une courte pause sans
  //     nouvelle frappe/insertion avant de considérer le texte complet, puisqu'il n'y a ici ni
  //     Entrée ni séparateur fiable pour marquer la fin du collage.
  document.addEventListener('paste', (e)=>{
    const text = ((e.clipboardData || window.clipboardData) || {}).getData
      ? (e.clipboardData || window.clipboardData).getData('text')
      : '';
    const value = String(text || '').trim();
    if(!value) return;
    e.preventDefault();
    hidBuffer = '';
    els.hiddenInput.value = '';
    handleDecode(value);
  });

  let hiddenInputIdleTimer = null;
  els.hiddenInput.addEventListener('input', ()=>{
    clearTimeout(hiddenInputIdleTimer);
    hiddenInputIdleTimer = setTimeout(()=>{
      const value = els.hiddenInput.value.trim();
      els.hiddenInput.value = '';
      hidBuffer = '';
      if(value) handleDecode(value);
    }, 200);
  });

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

  // Réglages poussés au maximum pour la détection, cette page n'ayant que ça à faire :
  // - fps 20 (au lieu de 15) : plus de tentatives de décodage par seconde.
  // - zone de scan agrandie (0.92 x 0.6 au lieu de 0.85 x 0.5) : plus de marge pour cadrer un
  //   code-barres 1D large sans le recadrer par erreur.
  // - showTorchButtonIfSupported/showZoomSliderIfSupported (natifs à html5-qrcode) : bouton
  //   lampe torche et curseur de zoom affichés automatiquement si le téléphone les supporte —
  //   déterminant en entrepôt faiblement éclairé ou pour un petit code éloigné.
  // - focusMode/exposureMode "continuous" : re-fait la mise au point/l'exposition en continu
  //   plutôt qu'une fois au démarrage (Chrome Android respecte ces contraintes ; ignoré ailleurs
  //   sans erreur, une contrainte "advanced" non supportée est simplement sautée).
  function buildScanConfig(videoConstraints){
    return {
      fps: 20,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const size = Math.min(viewfinderWidth, viewfinderHeight);
        return { width: Math.round(size * 0.92), height: Math.round(size * 0.6) };
      },
      aspectRatio: 1.5,
      disableFlip: false,
      showTorchButtonIfSupported: true,
      showZoomSliderIfSupported: true,
      defaultZoomValueIfSupported: 2,
      videoConstraints,
    };
  }

  const IDEAL_VIDEO_CONSTRAINTS = {
    facingMode: 'environment',
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    advanced: [{ focusMode: 'continuous' }, { exposureMode: 'continuous' }],
  };

  // ---------- activation/désactivation de la caméra ----------
  // Bouton dans l'en-tête : coupe le flux vidéo (batterie, discrétion, ou simplement laisser la
  // douchette code-barres travailler seule) sans quitter la page — la douchette et le champ caché
  // restent actifs dans les deux états, seul le décodage par caméra est concerné.
  let scannerInstance = null;
  let cameraOn = false;

  function setReaderVisible(visible){
    els.readerContainer.style.display = visible ? 'block' : 'none';
    els.readerPlaceholder.style.display = visible ? 'none' : 'flex';
  }

  function updateToggleBtn(){
    els.toggleCameraBtn.textContent = cameraOn ? '📷 Désactiver' : '📷 Activer';
    els.toggleCameraBtn.setAttribute('aria-pressed', cameraOn ? 'true' : 'false');
    els.toggleCameraBtn.classList.toggle('camera-off', !cameraOn);
  }

  async function startScanner(){
    if(typeof Html5Qrcode === 'undefined'){
      els.errorBox.textContent = "La bibliothèque de scan n'a pas pu être chargée — vérifiez votre connexion internet.";
      els.errorBox.style.display = 'block';
      return;
    }
    els.errorBox.style.display = 'none';
    setReaderVisible(true);
    scannerInstance = new Html5Qrcode('scanReaderContainer', {
      formatsToSupport: scannerFormats(),
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    const onDecode = (decodedText) => { handleDecode(decodedText); };
    const onFailure = () => { /* échecs de lecture image par image : ignorés silencieusement */ };

    try{
      await scannerInstance.start({ facingMode: 'environment' }, buildScanConfig(IDEAL_VIDEO_CONSTRAINTS), onDecode, onFailure);
      cameraOn = true;
    }catch(err){
      // Repli : certains téléphones (souvent d'entrée de gamme) rejettent une résolution/focus
      // "idéale" trop précise pour leur caméra arrière — on retente avec des contraintes minimales
      // plutôt que de laisser la page entièrement inutilisable pour ces appareils.
      try{
        await scannerInstance.start({ facingMode: 'environment' }, buildScanConfig({ facingMode: 'environment' }), onDecode, onFailure);
        cameraOn = true;
      }catch(err2){
        els.errorBox.textContent = `Impossible d'accéder à la caméra (${err2 && err2.message ? err2.message : 'permission refusée ou aucune caméra détectée'}).`;
        els.errorBox.style.display = 'block';
        scannerInstance = null;
        setReaderVisible(false);
      }
    }
    updateToggleBtn();
  }

  async function stopScanner(){
    if(scannerInstance){
      try{ await scannerInstance.stop(); }catch(e){ /* déjà arrêtée, ou jamais vraiment démarrée */ }
      try{ scannerInstance.clear(); }catch(e){ /* rien à nettoyer */ }
      scannerInstance = null;
    }
    cameraOn = false;
    els.errorBox.style.display = 'none';
    setReaderVisible(false);
    updateToggleBtn();
  }

  let toggleBusy = false;
  els.toggleCameraBtn.addEventListener('click', async ()=>{
    if(toggleBusy) return;
    toggleBusy = true;
    els.toggleCameraBtn.disabled = true;
    try{
      if(cameraOn) await stopScanner(); else await startScanner();
    }finally{
      els.toggleCameraBtn.disabled = false;
      toggleBusy = false;
    }
  });

  fetch('/api/version', { cache: 'no-store' })
    .then(r => r.json())
    .then(({ version }) => { if(version) els.version.textContent = version; })
    .catch(() => {});

  startScanner();
})();
