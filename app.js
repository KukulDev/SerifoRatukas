/* app.js (fix)
   - Fix #1: wheel dropdown tuščias -> robust element lookup + always render options
   - Fix #2: result modal mygtukai neveikia -> (re)bind events even if overlay already exists
   - Also: close advanced overlay when showing result modal (kad neblokuotų klikų)
*/

(() => {
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);

  // -----------------------------
  // Robust UI lookup
  // -----------------------------
  function getElByAnyId(ids){
    for(const id of ids){
      const el = $(id);
      if(el) return el;
    }
    return null;
  }

  function findTopWheelSelectFallback(){
    // bandom rasti select viršuje: 1) header bar 2) pirmas select dokumente
    const header = document.querySelector(".header") || document.querySelector("header") || document.body;
    const inHeader = header.querySelector("select");
    if(inHeader) return inHeader;
    return document.querySelector("select");
  }

  // -----------------------------
  // DOM (existing)
  // -----------------------------
  const entriesEl = $("entries");
  const addEntryBtn = $("addEntryBtn");
  const spinBtn = $("spinBtn");
  const respinBtn = $("respinBtn");
  const excludeLastEl = $("excludeLast");
  const removeWinnerEl = $("removeWinner");
  const soundEl = $("sound");
  const slowEl = $("slow");
  const resetBtn = $("resetBtn");

  const totalVisibleEl = $("totalVisible");
  const totalWeightEl = $("totalWeight");

  const wheel = $("wheel");
  const ctx = wheel?.getContext("2d");
  const winnerNameEl = $("winnerName");
  const removeBtn = $("removeBtn");
  const clearWinnerBtn = $("clearWinnerBtn");
  const historyEl = $("history");
  const currentWheelNameEl = $("currentWheelName");
  const pickCenterImgBtn = $("pickCenterImgBtn");
  const clearCenterImgBtn = $("clearCenterImgBtn");
  const centerImgPicker = $("centerImgPicker");

  // Advanced modal (existing)
  const overlay = $("overlay");
  const closeModalBtn = $("closeModalBtn");
  const cancelModalBtn = $("cancelModalBtn");
  const okModalBtn = $("okModalBtn");
  const prevEntryBtn = $("prevEntryBtn");
  const nextEntryBtn = $("nextEntryBtn");
  const dupEntryBtn = $("dupEntryBtn");
  const delEntryBtn = $("delEntryBtn");
  const addEntryModalBtn = $("addEntryModalBtn");
  const modalCounter = $("modalCounter");

  const mVisible = $("mVisible");
  const mText = $("mText");
  const mColor = $("mColor");
  const mMinus = $("mMinus");
  const mPlus = $("mPlus");
  const mWeight = $("mWeight");
  const mProb = $("mProb");

  // Optional next wheel select inside advanced modal
  const mNextWheel = $("mNextWheel");

  // Top wheels UI (ID gali skirtis – todėl bandom kelis)
  const wheelPicker =
    getElByAnyId(["wheelPicker","wheelSelect","wheelsSelect","wheelDropdown"]) ||
    findTopWheelSelectFallback();

  const addWheelBtn = getElByAnyId(["addWheelBtn","newWheelBtn","addWheel"]);
  const renameWheelBtn = getElByAnyId(["renameWheelBtn","renameWheel","renameBtn"]);
  const deleteWheelBtn = getElByAnyId(["deleteWheelBtn","deleteWheel","removeWheelBtn"]);

  // -----------------------------
  // Storage
  // -----------------------------
  const LS_WHEELS = "wheels_v2";
  const LS_CURRENT = "wheels_current_v2";
  const LS_OPT = "wheel_opts_v2";

  // -----------------------------
  // Audio
  // -----------------------------
  let audioCtx = null;
  function beep(freq=700, dur=0.03, type="sine", gain=0.04){
    if(!soundEl?.checked) return;
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }
  function winSound(){
    if(!soundEl?.checked) return;
    beep(660,0.07,"triangle",0.06);
    setTimeout(()=>beep(880,0.08,"triangle",0.06), 90);
    setTimeout(()=>beep(990,0.10,"triangle",0.06), 190);
  }

  // -----------------------------
  // State
  // -----------------------------
  let angle = 0;
  let spinning = false;
  let lastIdleTs = null;
  const IDLE_SPEED = 0.10; // radianai per sekundę (labai lėtai)

  /** @type {{id:string,name:string,entries:any[],history:any[],centerImgDataUrl?:string|null}[]} */
  let wheels = [];
  let currentWheelId = null;

  let lastWinnerId = null;
  let winnerEntry = null;

  // Advanced modal state
  let modalIndex = 0;
  let modalDraft = null;

  // Result modal state
  const resultModalState = { nextWheelId: null };

  // -----------------------------
  // Helpers
  // -----------------------------
  function uid(){
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }
  function getCurrentWheel(){
    return wheels.find(w => w.id === currentWheelId) || null;
  }
  function getEntries(){
    const w = getCurrentWheel();
    return w ? w.entries : [];
  }
  function setEntries(arr){
    const w = getCurrentWheel();
    if(w) w.entries = arr;
  }
  function getHistory(){
    const w = getCurrentWheel();
    return w ? (w.history || []) : [];
  }
  function setHistory(arr){
    const w = getCurrentWheel();
    if(w) w.history = arr;
  }

  function defaultEntry(){
    return {
      id: uid(),
      text: "New entry",
      color: "#be9164",
      weight: 1,
      visible: true,
      nextWheelId: null
    };
  }

  // centrinės nuotraukos cache (kad neperkrautume kiekvieną kartą)
  const centerImgCache = new Map(); // wheelId -> HTMLImageElement

  function visibleEntries(){
    return getEntries().filter(e => e.visible && (e.text||"").trim() && (e.weight|0) >= 1);
  }
  function totalWeight(){
    return visibleEntries().reduce((sum,e)=>sum + (e.weight|0), 0);
  }
  function probabilityFor(entry){
    const tw = totalWeight();
    if(!entry?.visible || tw <= 0) return 0;
    return (entry.weight / tw) * 100;
  }

  function expandedSlices(opts = {}){
    let v = visibleEntries();
    if(opts.excludeLast && lastWinnerId){
      v = v.filter(e => e.id !== lastWinnerId);
    }
    const slices = [];
    for(const e of v){
      const w = Math.max(1, e.weight|0);
      for(let i=0;i<w;i++) slices.push(e);
    }
    return slices;
  }

  // -----------------------------
  // Persist / Load
  // -----------------------------
  function persist(){
    localStorage.setItem(LS_WHEELS, JSON.stringify(wheels));
    localStorage.setItem(LS_CURRENT, JSON.stringify({ currentWheelId }));
    localStorage.setItem(LS_OPT, JSON.stringify({
      sound: !!soundEl?.checked,
      slow: !!slowEl?.checked,
      excludeLast: !!excludeLastEl?.checked,
      removeWinner: !!removeWinnerEl?.checked
    }));
  }

  function load(){
    const raw = localStorage.getItem(LS_WHEELS);
    if(raw){
      try{
        const arr = JSON.parse(raw);
        if(Array.isArray(arr) && arr.length) wheels = arr;
      }catch{}
    }

    const cur = localStorage.getItem(LS_CURRENT);
    if(cur){
      try{
        const o = JSON.parse(cur);
        if(o?.currentWheelId) currentWheelId = o.currentWheelId;
      }catch{}
    }

    const opt = localStorage.getItem(LS_OPT);
    if(opt){
      try{
        const o = JSON.parse(opt);
        if(soundEl) soundEl.checked = o.sound !== false;
        if(slowEl) slowEl.checked = !!o.slow;
        if(excludeLastEl) excludeLastEl.checked = !!o.excludeLast;
        if(removeWinnerEl) removeWinnerEl.checked = !!o.removeWinner;
      }catch{}
    }

    if(!wheels.length){
      wheels = [{
        id: uid(),
        name: "Pirmas ratukas",
        entries: [
          { ...defaultEntry(), id: uid(), text:"Ali", color:"#ad7f51" },
          { ...defaultEntry(), id: uid(), text:"Beatriz", color:"#be9164" },
          { ...defaultEntry(), id: uid(), text:"Charles", color:"#d1a981" },
          { ...defaultEntry(), id: uid(), text:"Diya", color:"#dfc0a2" },
        ],
        history: [],
        centerImgDataUrl: null
      }];
      currentWheelId = wheels[0].id;
    }

    // užtikrinam, kad visi turėtų centerImgDataUrl lauką
    wheels.forEach(w => {
      if(typeof w.centerImgDataUrl === "undefined"){
        w.centerImgDataUrl = null;
      }
    });

    if(!currentWheelId || !wheels.some(w => w.id === currentWheelId)){
      currentWheelId = wheels[0].id;
    }

    renderWheelPicker();
    renderEntries();
    renderHistory();
    drawWheel();
  }

  // -----------------------------
  // Wheel picker
  // -----------------------------
  function renderWheelPicker(){
    // jei nerandam select – bent jau nekraunam klaidų
    if(!wheelPicker) return;

    wheelPicker.innerHTML = "";
    wheels.forEach(w => {
      const opt = document.createElement("option");
      opt.value = w.id;
      opt.textContent = w.name;
      wheelPicker.appendChild(opt);
    });
    wheelPicker.value = currentWheelId;

    // atnaujinam rodomą ratuko pavadinimą dešinėje
    if(currentWheelNameEl){
      const w = getCurrentWheel();
      currentWheelNameEl.textContent = w ? w.name : "—";
    }

    // advanced modal next wheel dropdown
    if(mNextWheel){
      mNextWheel.innerHTML = `<option value="">—</option>`;
      wheels.forEach(w => {
        const o = document.createElement("option");
        o.value = w.id;
        o.textContent = w.name;
        mNextWheel.appendChild(o);
      });
    }
  }

  function switchWheel(id){
    if(!wheels.some(w => w.id === id)) return;
    currentWheelId = id;
    winnerEntry = null;
    lastWinnerId = null;
    if(winnerNameEl) winnerNameEl.textContent = "—";
    persist();
    renderWheelPicker();
    renderEntries();
    renderHistory();
    drawWheel();
  }

  if(wheelPicker){
    wheelPicker.addEventListener("change", (e) => switchWheel(e.target.value));
  }

  if(addWheelBtn){
    addWheelBtn.addEventListener("click", () => {
      const name = prompt("Naujo ratuko pavadinimas:", `Ratas ${wheels.length+1}`);
      if(name === null) return;
      wheels.push({ id: uid(), name: name.trim() || `Ratas ${wheels.length+1}`, entries: [], history: [] });
      currentWheelId = wheels[wheels.length-1].id;
      persist();
      renderWheelPicker();
      renderEntries();
      renderHistory();
      drawWheel();
    });
  }

  if(renameWheelBtn){
    renameWheelBtn.addEventListener("click", () => {
      const w = getCurrentWheel(); if(!w) return;
      const name = prompt("Peravadinti ratą į:", w.name);
      if(name === null) return;
      w.name = name.trim() || w.name;
      persist();
      renderWheelPicker();
    });
  }

  if(deleteWheelBtn){
    deleteWheelBtn.addEventListener("click", () => {
      if(wheels.length <= 1) return alert("Negalima ištrinti paskutinio ratuko.");
      const w = getCurrentWheel(); if(!w) return;
      if(!confirm(`Ištrinti ratuką "${w.name}"?`)) return;
      wheels = wheels.filter(x => x.id !== w.id);
      currentWheelId = wheels[0].id;
      persist();
      renderWheelPicker();
      renderEntries();
      renderHistory();
      drawWheel();
    });
  }

  // -----------------------------
  // History
  // -----------------------------
  function renderHistory(){
    if(!historyEl) return;
    const history = getHistory();
    if(history.length === 0){
      historyEl.innerHTML = "<span class='tiny'>Istorija tuščia.</span>";
      return;
    }
    const items = history.slice(0,50)
      .map((h, i) => `#${history.length - i} <b>${escapeHtml(h.name)}</b> <span class="tiny">(${new Date(h.ts).toLocaleString()})</span>`)
      .join("<br/>");
    historyEl.innerHTML = `<div class="tiny">Paskutiniai laimėtojai:</div>${items}`;
  }

  function pushHistory(name){
    const history = getHistory();
    history.unshift({ name, ts: Date.now() });
    setHistory(history.slice(0,200));
    renderHistory();
  }

  function replaceLastHistory(name){
    const history = getHistory();
    if(history.length) history.shift();
    history.unshift({ name, ts: Date.now() });
    setHistory(history.slice(0,200));
    renderHistory();
  }

  // -----------------------------
  // Entries UI
  // -----------------------------
  function renderEntries(){
    if(!entriesEl) return;

    const entries = getEntries();
    entriesEl.innerHTML = "";

    entries.forEach((e, idx) => {
      const entry = document.createElement("div");
      entry.className = "entry";

      const top = document.createElement("div");
      top.className = "entryTopRow compact";

      const moveCol = document.createElement("div");
      moveCol.className = "moveCol";

      const up = document.createElement("button");
      up.className = "btn iconBtn";
      up.textContent = "↑";
      up.disabled = idx === 0;
      up.addEventListener("click", () => {
        if(idx <= 0) return;
        [entries[idx-1], entries[idx]] = [entries[idx], entries[idx-1]];
        setEntries(entries); persist(); renderEntries(); drawWheel();
      });

      const down = document.createElement("button");
      down.className = "btn iconBtn";
      down.textContent = "↓";
      down.disabled = idx === entries.length - 1;
      down.addEventListener("click", () => {
        if(idx >= entries.length-1) return;
        [entries[idx+1], entries[idx]] = [entries[idx], entries[idx+1]];
        setEntries(entries); persist(); renderEntries(); drawWheel();
      });

      moveCol.appendChild(up);
      moveCol.appendChild(down);

      const textWrap = document.createElement("div");
      textWrap.className = "entryText";
      const input = document.createElement("input");
      input.value = e.text;
      input.placeholder = "New entry";
      input.addEventListener("input", () => {
        e.text = input.value;
        persist(); drawWheel();
      });
      textWrap.appendChild(input);

      const right = document.createElement("div");
      right.className = "entryRight";

      const adv = document.createElement("button");
      adv.className = "btn iconBtn";
      adv.textContent = "⚙";
      adv.addEventListener("click", () => openModal(idx));

      const del = document.createElement("button");
      del.className = "btn iconBtn";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        entries.splice(idx,1);
        setEntries(entries); persist(); renderEntries(); drawWheel();
      });

      const vis = document.createElement("input");
      vis.type = "checkbox";
      vis.className = "check";
      vis.checked = !!e.visible;
      vis.addEventListener("change", () => {
        e.visible = vis.checked;
        persist(); drawWheel();
      });

      right.appendChild(adv);
      right.appendChild(del);
      right.appendChild(vis);

      top.appendChild(moveCol);
      top.appendChild(textWrap);
      top.appendChild(right);

      entry.appendChild(top);
      entriesEl.appendChild(entry);
    });

    if(entries.length === 0){
      const empty = document.createElement("div");
      empty.className = "tiny";
      empty.textContent = "Tuščia. Spausk + Add ir pridėk pirmą įrašą.";
      entriesEl.appendChild(empty);
    }

    if(totalVisibleEl) totalVisibleEl.textContent = String(visibleEntries().length);
    if(totalWeightEl) totalWeightEl.textContent = String(totalWeight());
  }

  // -----------------------------
  // Advanced modal
  // -----------------------------
  function structuredCloneEntry(e){
    return {
      id: e.id,
      text: e.text,
      color: e.color,
      weight: e.weight,
      visible: e.visible,
      nextWheelId: e.nextWheelId || null
    };
  }

  function openModal(index){
    const entries = getEntries();
    if(!entries.length || !overlay) return;
    modalIndex = Math.max(0, Math.min(index, entries.length-1));
    modalDraft = structuredCloneEntry(entries[modalIndex]);
    overlay.style.display = "flex";
    syncModalUI();
  }

  function closeModal(){
    if(!overlay) return;
    overlay.style.display = "none";
    modalDraft = null;
  }

  function syncModalUI(){
    if(!modalDraft) return;
    if(modalCounter) modalCounter.textContent = `Entry ${modalIndex+1} / ${getEntries().length}`;
    if(mVisible) mVisible.checked = !!modalDraft.visible;
    if(mText) mText.value = modalDraft.text || "";
    if(mColor) mColor.value = modalDraft.color || "#be9164";
    if(mWeight) mWeight.value = String(Math.max(1, modalDraft.weight|0));
    if(mProb) mProb.textContent = `${Math.round(probabilityFor(modalDraft))}%`;
    if(mNextWheel) mNextWheel.value = modalDraft.nextWheelId || "";
  }

  function applyModalDraft(){
    if(!modalDraft) return;
    const entries = getEntries();

    entries[modalIndex] = {
      ...entries[modalIndex],
      text: (mText?.value || "").trim() || "—",
      visible: !!mVisible?.checked,
      color: mColor?.value || "#be9164",
      weight: Math.max(1, parseInt(mWeight?.value,10) || 1),
      nextWheelId: mNextWheel ? (mNextWheel.value || null) : (modalDraft.nextWheelId || null)
    };

    setEntries(entries);
    persist();
    renderEntries();
    drawWheel();
  }

  if(closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
  if(cancelModalBtn) cancelModalBtn.addEventListener("click", closeModal);
  if(okModalBtn) okModalBtn.addEventListener("click", () => { applyModalDraft(); closeModal(); });
  if(overlay) overlay.addEventListener("click", (e) => { if(e.target === overlay) closeModal(); });

  if(prevEntryBtn) prevEntryBtn.addEventListener("click", () => {
    const entries = getEntries(); if(!entries.length) return;
    applyModalDraft();
    modalIndex = (modalIndex - 1 + entries.length) % entries.length;
    modalDraft = structuredCloneEntry(entries[modalIndex]);
    syncModalUI();
  });

  if(nextEntryBtn) nextEntryBtn.addEventListener("click", () => {
    const entries = getEntries(); if(!entries.length) return;
    applyModalDraft();
    modalIndex = (modalIndex + 1) % entries.length;
    modalDraft = structuredCloneEntry(entries[modalIndex]);
    syncModalUI();
  });

  if(dupEntryBtn) dupEntryBtn.addEventListener("click", () => {
    const entries = getEntries(); if(!entries.length) return;
    applyModalDraft();
    const src = entries[modalIndex];
    entries.splice(modalIndex+1, 0, { ...structuredCloneEntry(src), id: uid() });
    setEntries(entries); persist(); renderEntries(); drawWheel();
    modalIndex = modalIndex + 1;
    modalDraft = structuredCloneEntry(entries[modalIndex]);
    syncModalUI();
  });

  if(delEntryBtn) delEntryBtn.addEventListener("click", () => {
    const entries = getEntries(); if(!entries.length) return;
    entries.splice(modalIndex, 1);
    setEntries(entries); persist(); renderEntries(); drawWheel();
    if(entries.length === 0){ closeModal(); return; }
    modalIndex = Math.min(modalIndex, entries.length-1);
    modalDraft = structuredCloneEntry(entries[modalIndex]);
    syncModalUI();
  });

  if(addEntryModalBtn) addEntryModalBtn.addEventListener("click", () => {
    const entries = getEntries();
    entries.push(defaultEntry());
    setEntries(entries); persist(); renderEntries(); drawWheel();
    modalIndex = entries.length - 1;
    modalDraft = structuredCloneEntry(entries[modalIndex]);
    syncModalUI();
  });

  if(mVisible) mVisible.addEventListener("change", () => { if(modalDraft){ modalDraft.visible = mVisible.checked; syncModalUI(); }});
  if(mText) mText.addEventListener("input", () => { if(modalDraft){ modalDraft.text = mText.value; }});
  if(mColor) mColor.addEventListener("input", () => { if(modalDraft){ modalDraft.color = mColor.value; syncModalUI(); }});
  if(mWeight) mWeight.addEventListener("input", () => { if(modalDraft){ modalDraft.weight = Math.max(1, parseInt(mWeight.value,10)||1); syncModalUI(); }});
  if(mNextWheel) mNextWheel.addEventListener("change", () => { if(modalDraft){ modalDraft.nextWheelId = mNextWheel.value || null; }});

  if(mMinus) mMinus.addEventListener("click", () => {
    if(!modalDraft || !mWeight) return;
    modalDraft.weight = Math.max(1, (modalDraft.weight|0)-1);
    mWeight.value = String(modalDraft.weight);
    syncModalUI();
  });

  if(mPlus) mPlus.addEventListener("click", () => {
    if(!modalDraft || !mWeight) return;
    modalDraft.weight = Math.max(1, (modalDraft.weight|0)+1);
    mWeight.value = String(modalDraft.weight);
    syncModalUI();
  });

  // -----------------------------
  // Result modal (naudoja esamą HTML)
  // -----------------------------
  const resultOverlay = $("resultOverlay");
  const resultTextEl = $("resultText");
  const closeResultBtn = $("closeResultBtn");
  const respinResultBtn = $("respinResultBtn");
  const spinResultBtn = $("spinResultBtn");
  const openNextWheelBtn = $("openNextWheelBtn");

  function getWheelNameById(id){
    const w = wheels.find(w => w.id === id);
    return w ? w.name : null;
  }

  function showResultModal(text, nextWheelId){
    // uždarom advanced overlay, kad neblokuotų click’ų
    if(overlay) overlay.style.display = "none";

    if(resultTextEl) resultTextEl.textContent = text || "—";
    resultModalState.nextWheelId = nextWheelId || null;

    if(openNextWheelBtn){
      if(nextWheelId){
        const name = getWheelNameById(nextWheelId) || "kitą";
        openNextWheelBtn.style.display = "inline-flex";
        openNextWheelBtn.textContent = `Sukti „${name}“ ratuką`;
      }else{
        openNextWheelBtn.style.display = "none";
      }
    }

    if(resultOverlay) resultOverlay.style.display = "flex";
  }

  function hideResultModal(){
    if(resultOverlay) resultOverlay.style.display = "none";
  }

  if(closeResultBtn){
    closeResultBtn.addEventListener("click", hideResultModal);
  }
  if(respinResultBtn){
    respinResultBtn.addEventListener("click", () => {
      hideResultModal();
      spin({ mode:"respin", excludeLast: !!excludeLastEl?.checked });
    });
  }
  if(spinResultBtn){
    spinResultBtn.addEventListener("click", () => {
      hideResultModal();
      spin({ mode:"spin", excludeLast:false });
    });
  }
  if(openNextWheelBtn){
    openNextWheelBtn.addEventListener("click", () => {
      const id = resultModalState.nextWheelId;
      if(id){
        hideResultModal();
        switchWheel(id);
      }
    });
  }

  // -----------------------------
  // Wheel draw
  // -----------------------------
  function drawWheel(){
    if(!wheel || !ctx) return;

    const w = wheel.width, h = wheel.height;
    const cx = w/2, cy = h/2;
    const r = Math.min(cx, cy) - 18;

    ctx.clearRect(0,0,w,h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0,0,r+10,0,TAU);
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.fill();
    ctx.restore();

    const slices = expandedSlices({ excludeLast:false });
    const n = slices.length;

    if(n === 0){
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.arc(0,0,r,0,TAU);
      ctx.fillStyle = "rgba(0,0,0,.08)";
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.font = "900 28px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Pridėk įrašus kairėje", 0, 0);
      ctx.restore();
      return;
    }

    const slice = TAU / n;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle - Math.PI/2);

    for(let i=0;i<n;i++){
      const e = slices[i];
      const a0 = i * slice;
      const a1 = a0 + slice;

      ctx.beginPath();
      ctx.moveTo(0,0);
      ctx.arc(0,0,r,a0,a1);
      ctx.closePath();
      ctx.fillStyle = e.color || "#be9164";
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,.18)";
      ctx.lineWidth = 3;
      ctx.stroke();

      const label = (e.text || "").trim() || "—";
      ctx.save();
      // pasukam iki segmento vidurio (kryptis nuo centro į išorę)
      ctx.rotate(a0 + slice/2);
      // nueinam išilgai spindulio
      ctx.translate(r*0.60, 0);
      ctx.fillStyle = "rgba(0,0,0,.75)";
      ctx.font = "900 24px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const maxW = r*0.60;
      let text = label;
      // jei tekstas per ilgas – patrumpinam ir pridedam „…“
      while(ctx.measureText(text).width > maxW && text.length > 2) text = text.slice(0, -1);
      if(text !== label) text = text.slice(0, Math.max(0,text.length-1)) + "…";

      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.strokeText(text, 0, 0);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    ctx.rotate(Math.PI/2 - angle);
    ctx.beginPath();
    ctx.arc(0,0,85,0,TAU);
    ctx.fillStyle = "rgba(255,255,255,.16)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0,0,64,0,TAU);
    ctx.fillStyle = "rgba(0,0,0,.10)";
    ctx.fill();
    ctx.restore();

    // nupiešiam centro nuotrauką (jei yra) ANT viršutinių centrinių apskritimų
    const wObj = getCurrentWheel();
    if(wObj && wObj.centerImgDataUrl){
      let img = centerImgCache.get(wObj.id);
      if(!img){
        img = new Image();
        img.src = wObj.centerImgDataUrl;
        centerImgCache.set(wObj.id, img);
        img.onload = () => {
          // kai užsikraus pirmą kartą – persipaišom ratą
          drawWheel();
        };
      }
      if(img.complete && img.naturalWidth){
        const size = r * 0.6; // kiek didelis bus paveikslėlis centre
        const half = size / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle); // kad suktųsi kartu su ratu
        ctx.beginPath();
        ctx.arc(0,0,half,0,TAU);
        ctx.clip();
        ctx.drawImage(img, -half, -half, size, size);
        ctx.restore();
      }
    }
  }

  function pickWinnerFromAngle(finalAngle, slices){
    const n = slices.length;
    if(n === 0) return null;
    let a = (finalAngle % TAU + TAU) % TAU;
    const slice = TAU / n;
    const idx = Math.floor((((TAU - a) % TAU)) / slice) % n;
    return { idx, entry: slices[idx] };
  }

  // -----------------------------
  // Idle rotation (kai nieko nevyksta)
  // -----------------------------
  function idleLoop(ts){
    if(lastIdleTs == null) lastIdleTs = ts;
    const dt = (ts - lastIdleTs) / 1000; // sekundės
    lastIdleTs = ts;

    if(!spinning){
      angle = (angle + IDLE_SPEED * dt) % TAU;
      drawWheel();
    }

    requestAnimationFrame(idleLoop);
  }

  // -----------------------------
  // Spin
  // -----------------------------
  function spin(opts = {}){
    if(spinning) return;

    const mode = opts.mode || "spin";
    const slices = expandedSlices({ excludeLast: !!opts.excludeLast });

    if(slices.length < 1){
      winnerNameEl && (winnerNameEl.textContent = "—");
      return;
    }
    if(slices.length === 1){
      winnerEntry = slices[0];
      lastWinnerId = winnerEntry.id;
      winnerNameEl && (winnerNameEl.textContent = winnerEntry.text || "—");

      if(mode === "respin") replaceLastHistory(winnerEntry.text || "—");
      else pushHistory(winnerEntry.text || "—");

      persist();
      showResultModal(winnerEntry.text || "—", winnerEntry.nextWheelId || null);
      return;
    }

    spinning = true;
    winnerEntry = null;
    winnerNameEl && (winnerNameEl.textContent = "…");

    const slow = !!slowEl?.checked;
    const baseDur = slow ? 5600 : 3800;
    const extra = slow ? 2200 : 1400;
    const duration = baseDur + Math.random()*extra;

    const start = performance.now();
    const startAngle = angle;
    const spins = (slow ? 10 : 8) + Math.floor(Math.random()*4);
    const target = startAngle + spins*TAU + (Math.random()*TAU);

    let lastTickIdx = null;
    // pradžioje lėtai, viduryje greičiau, gale vėl lėtėja
    const easeInOutCubic = (t) => t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function frame(now){
      const t = Math.min(1, (now - start)/duration);
      const e = easeInOutCubic(t);
      angle = startAngle + (target - startAngle) * e;
      drawWheel();

      const p = pickWinnerFromAngle(angle, slices);
      if(p){
        if(lastTickIdx === null) lastTickIdx = p.idx;
        if(p.idx !== lastTickIdx){
          beep(880, 0.015, "square", 0.025);
          lastTickIdx = p.idx;
        }
      }

      if(t < 1){
        requestAnimationFrame(frame);
      } else {
        spinning = false;

        const res = pickWinnerFromAngle(angle, slices);
        if(!res){
          winnerNameEl && (winnerNameEl.textContent = "—");
          return;
        }

        winnerEntry = res.entry;
        lastWinnerId = winnerEntry.id;
        winnerNameEl && (winnerNameEl.textContent = winnerEntry.text || "—");
        winSound();

        if(mode === "respin") replaceLastHistory(winnerEntry.text || "—");
        else pushHistory(winnerEntry.text || "—");

        if(!!removeWinnerEl?.checked){
          const entries = getEntries();
          const i = entries.findIndex(x => x.id === winnerEntry.id);
          if(i >= 0) entries.splice(i, 1);
          setEntries(entries);
          renderEntries();
          drawWheel();
        }

        persist();
        showResultModal(winnerEntry.text || "—", winnerEntry.nextWheelId || null);
      }
    }

    requestAnimationFrame(frame);
  }

  // -----------------------------
  // Buttons
  // -----------------------------
  if(addEntryBtn) addEntryBtn.addEventListener("click", () => {
    const entries = getEntries();
    entries.push(defaultEntry());
    setEntries(entries);
    persist(); renderEntries(); drawWheel();
  });

  if(spinBtn) spinBtn.addEventListener("click", () => spin({ mode:"spin", excludeLast:false }));
  if(respinBtn) respinBtn.addEventListener("click", () => spin({ mode:"respin", excludeLast: !!excludeLastEl?.checked }));

  if(resetBtn) resetBtn.addEventListener("click", () => {
    const w = getCurrentWheel(); if(!w) return;
    w.entries = [];
    w.history = [];
    winnerEntry = null;
    lastWinnerId = null;
    winnerNameEl && (winnerNameEl.textContent = "—");
    persist(); renderEntries(); renderHistory(); drawWheel();
  });

  if(removeBtn) removeBtn.addEventListener("click", () => {
    if(!winnerEntry || spinning) return;
    const entries = getEntries();
    const i = entries.findIndex(x => x.id === winnerEntry.id);
    if(i >= 0) entries.splice(i, 1);
    setEntries(entries);
    winnerEntry = null;
    winnerNameEl && (winnerNameEl.textContent = "—");
    persist(); renderEntries(); drawWheel();
  });

  if(clearWinnerBtn) clearWinnerBtn.addEventListener("click", () => {
    winnerEntry = null;
    winnerNameEl && (winnerNameEl.textContent = "—");
  });

  // Centro nuotrauka
  if(pickCenterImgBtn && centerImgPicker){
    pickCenterImgBtn.addEventListener("click", () => {
      centerImgPicker.value = "";
      centerImgPicker.click();
    });

    centerImgPicker.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if(!file) return;
      const wObj = getCurrentWheel();
      if(!wObj) return;

      const reader = new FileReader();
      reader.onload = () => {
        wObj.centerImgDataUrl = reader.result;
        centerImgCache.delete(wObj.id); // perkrausim Image
        persist();
        drawWheel();
      };
      reader.readAsDataURL(file);
    });
  }

  if(clearCenterImgBtn){
    clearCenterImgBtn.addEventListener("click", () => {
      const wObj = getCurrentWheel();
      if(!wObj) return;
      wObj.centerImgDataUrl = null;
      centerImgCache.delete(wObj.id);
      persist();
      drawWheel();
    });
  }

  // Space key
  document.addEventListener("keydown", (e) => {
    if(e.code !== "Space") return;
    const active = document.activeElement;
    const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if(typing) return;
    e.preventDefault();
    spin({ mode:"spin", excludeLast:false });
  });

  // -----------------------------
  // Init
  // -----------------------------
  load();
  requestAnimationFrame(idleLoop);

})();
