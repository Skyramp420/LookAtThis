/* Advanced editor (LookAtThis).
   Načíta sa až pri prvom otvorení (Studio.load), takže appku nezaťažuje, kým ho nepoužiješ.

   Projekt = časová os s voľne umiestnenými položkami na stopách:
     lanes: video · text · zvukové stopy podľa klipov (Systém, Hra, Discord, Mikrofón…) · hudba
     items: { id, lane, kind: 'video'|'audio'|'text', start (s na osi), in/out (s v zdroji), speed, g (skupina = video + jeho zvuk) }
   Náhľad: <video> pre každý klip + <audio> pre každú stopu (synchronizované s hodinami editora), text na plátne.
   Export: main → project-export.js (ffmpeg), rovnaké výpočty výrezu a animácií ako náhľad.
   Projekt sa priebežne ukladá (localStorage), takže zatvorenie nič nezahodí. */
window.Studio = (function () {
  const { $, $$, esc, I, toast, fileUrl, menu } = UI;
  const FMT = {
    '16:9': { r: 16 / 9, sub: 'YouTube' },
    '9:16': { r: 9 / 16, sub: 'Shorts, TikTok, Reels' },
    '1:1': { r: 1, sub: 'Instagram, Discord' }
  };
  const AUDIO_C = ['#30d158', '#ffb340', '#bf5af2', '#64d2ff', '#ff375f', '#ffd60a', '#8e8e93', '#40c8e0'];
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  const HEAD_W = 176;
  const LANE_H = { video: 62, text: 30, audio: 44 };
  const STYLES = {
    gamer: { l: 'Gamer', font: '"Arial Black", "Segoe UI Black", sans-serif', w: 900, color: '#ffffff', outline: true, box: false, glow: false, upper: true },
    clean: { l: 'Čistý', font: '"Inter Variable", "Segoe UI", system-ui, sans-serif', w: 700, color: '#ffffff', outline: false, box: false, glow: false, upper: false, shadow: true },
    caption: { l: 'Titulky', font: '"Inter Variable", "Segoe UI", system-ui, sans-serif', w: 700, color: '#ffffff', outline: false, box: true, glow: false, upper: false },
    meme: { l: 'Meme', font: 'Impact, "Arial Black", sans-serif', w: 400, color: '#ffffff', outline: true, box: false, glow: false, upper: true },
    neon: { l: 'Neón', font: '"Arial Black", "Segoe UI Black", sans-serif', w: 900, color: '#bf5af2', outline: false, box: false, glow: true, upper: true }
  };
  const COLORS = ['#ffffff', '#ffd60a', '#ff9f0a', '#ff453a', '#30d158', '#64d2ff', '#bf5af2', '#1d1d1f'];
  const ANIM_IN = [{ v: 'none', l: 'Žiadna' }, { v: 'fade', l: 'Objaví sa' }, { v: 'pop', l: 'Vyskočí' }, { v: 'slide', l: 'Zdola' }];
  const ANIM_OUT = [{ v: 'none', l: 'Žiadna' }, { v: 'fade', l: 'Zmizne' }];
  const IC = {
    trAdd: '<svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    trOn: '<svg viewBox="0 0 16 16"><path d="M3 3.5h4.5L5.5 8l2 4.5H3zM13 3.5H8.5L10.5 8l-2 4.5H13z" fill="currentColor"/></svg>',
    kf: '<svg viewBox="0 0 16 16"><path d="M8 2.2 13.8 8 8 13.8 2.2 8z" fill="currentColor"/></svg>',
    kfo: '<svg viewBox="0 0 16 16"><path d="M8 2.6 13.4 8 8 13.4 2.6 8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    kprev: '<svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    knext: '<svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    exp: '<svg viewBox="0 0 16 16"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    undo: '<svg viewBox="0 0 20 20"><path d="M7 5 3.5 8.5 7 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    redo: '<svg viewBox="0 0 20 20"><path d="M13 5l3.5 3.5L13 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 8.5H8.5a4.5 4.5 0 0 0 0 9H11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    sel: '<svg viewBox="0 0 16 16"><path d="M3 2l9 5-4 1.3L6.5 13z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    split: '<svg viewBox="0 0 16 16"><circle cx="4.5" cy="4.5" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="4.5" cy="11.5" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    del: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    text: '<svg viewBox="0 0 16 16"><path d="M3 4V2.8h10V4M8 2.8v10.4M6 13.2h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    music: '<svg viewBox="0 0 16 16"><path d="M6 12V3.5l7-1.5V10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4.3" cy="12" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11.3" cy="10.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    magnet: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5v5a4.5 4.5 0 0 0 9 0v-5M3.5 5h3M9.5 5h3M6.5 2.5v5a1.5 1.5 0 0 0 3 0v-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    prev: '<svg viewBox="0 0 16 16"><path d="M11 3 6 8l5 5M4 3v10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 16 16"><path d="M5 3l5 5-5 5M12 3v10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    link: '<svg viewBox="0 0 16 16"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 20 20"><rect x="6.5" y="6.5" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13.5 4.5v-.5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v7A1.5 1.5 0 0 0 5 12.5h.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const clamp01 = x => clamp(x, 0, 1);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const tc = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`; };
  const tShort = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zvuk';
  const easeBack = p => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);

  /* ---------- text: rovnaké kreslenie pre náhľad aj export ---------- */
  const mctx = document.createElement('canvas').getContext('2d');
  function textLook(it) { return { ...(STYLES[it.style] || STYLES.gamer), ...(it.color ? { color: it.color } : {}) }; }
  function textMetrics(it, H) {
    const st = textLook(it), size = Math.max(8, (it.size || 0.08) * H);
    const txt = st.upper ? String(it.text || '').toUpperCase() : String(it.text || '');
    const lines = txt.split('\n');
    mctx.font = `${st.w} ${size}px ${st.font}`;
    const w = Math.max(...lines.map(l => mctx.measureText(l || ' ').width));
    const lh = size * 1.15;
    return { st, size, lines, w, h: lh * lines.length, lh, padX: size * 0.42, padY: size * 0.24 };
  }
  function drawText(g, it, cx, cy, H) {
    const M = textMetrics(it, H), st = M.st;
    g.save();
    if (st.box) {
      const bw = M.w + M.padX * 2, bh = M.h + M.padY * 2;
      g.fillStyle = 'rgba(0,0,0,.62)'; g.beginPath(); g.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, M.size * 0.28); g.fill();
    }
    g.font = `${st.w} ${M.size}px ${st.font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    M.lines.forEach((ln, i) => {
      const y = cy - M.h / 2 + M.lh * (i + 0.5);
      if (st.shadow) { g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = M.size * 0.18; g.shadowOffsetY = M.size * 0.04; }
      if (st.outline) { g.lineWidth = Math.max(2, M.size * 0.14); g.strokeStyle = '#000'; g.strokeText(ln, cx, y); }
      if (st.glow) { g.shadowColor = st.color; g.shadowBlur = M.size * 0.35; g.fillStyle = st.color; g.fillText(ln, cx, y); }
      g.fillStyle = st.color; g.fillText(ln, cx, y);
      g.shadowBlur = 0; g.shadowOffsetY = 0;
    });
    g.restore();
    return M;
  }
  function animAt(it, time, H) {
    let op = 1, sc = 1, dy = 0;
    const ai = it.animIn || 'none';
    if (ai !== 'none') {
      op *= clamp01((time - it.start) / (ai === 'pop' ? 0.2 : 0.35));
      if (ai === 'pop') sc = 0.5 + 0.5 * easeBack(clamp01((time - it.start) / 0.35));
      if (ai === 'slide') dy = Math.pow(1 - clamp01((time - it.start) / 0.4), 3) * H * 0.05;
    }
    if (it.animOut === 'fade') op *= clamp01((it.end - time) / 0.3);
    return { op, sc, dy };
  }
  /* tesný PNG textu v rozlíšení exportu (stred = cx, cy) */
  function textPng(it, W, H) {
    const M = textMetrics(it, H), st = M.st;
    const extra = (st.glow ? M.size * 0.6 : 0) + (st.outline ? M.size * 0.14 : 0) + (st.shadow ? M.size * 0.3 : 0) + 4;
    const bw = (st.box ? M.w + M.padX * 2 : M.w) + extra * 2, bh = (st.box ? M.h + M.padY * 2 : M.h) + extra * 2;
    const c = document.createElement('canvas'); c.width = Math.ceil(bw / 2) * 2; c.height = Math.ceil(bh / 2) * 2;
    drawText(c.getContext('2d'), it, c.width / 2, c.height / 2, H);
    return { png: c.toDataURL('image/png'), cx: (it.x ?? 0.5) * W, cy: (it.y ?? 0.8) * H };
  }

  /* ---------- načítanie modulu ---------- */
  let editorOpen = false;

  /* input: { clips: [klip z knižnice], segs?, overlays?, mixer?, aspect?, t? } z jednoduchého editora alebo knižnice;
     opts: { projectId (otvoriť/pridať do existujúceho, inak nový projekt), library: () => klipy, fromRect, fromImage, onClose } */
  async function open(input = {}, opts = {}) {
    if (editorOpen) return;
    editorOpen = true;
    const lib = opts.library || (() => []);
    let P = { v: 1, name: 'Montáž', fmt: '16:9', fps: 60, lanes: [], items: [], sources: {} };
    const src = new Map();   // path → zdroj (metadáta + prehrávače)
    let kfSel = null; // vybraný keyframe { id, t }
    let trSel = null; // vybraný prechod = id klipu B
    let sel = new Set(), tab = 'klip', snapOn = true, t = 0, playing = false, raf = 0, clock0 = 0, t0 = 0;
    let pps = 40, W = 1920, H = 1080, exporting = false, closed = false;
    const undo = [], redo = [];

    /* ---------- DOM ---------- */
    const root = document.createElement('div');
    root.className = 'st-wrap';
    root.innerHTML = `
      <div class="st" id="stRoot" role="dialog" aria-label="Advanced editor">
        <header class="st-top">
          <button class="btn st-back" id="stClose" title="Zavrieť (projekt ostane uložený)">${IC.back}<span>Späť</span></button>
          <span class="st-brand">Advanced editor</span>
          <div class="st-hist">
            <button class="st-ico" id="stUndo" title="Späť (Ctrl+Z)" aria-label="Späť">${IC.undo}</button>
            <button class="st-ico" id="stRedo" title="Znova (Ctrl+Y)" aria-label="Znova">${IC.redo}</button>
          </div>
          <input class="st-name" id="stName" spellcheck="false" aria-label="Názov projektu">
          <div class="seg st-fmt" id="stFmt" role="group" aria-label="Formát videa">${Object.keys(FMT).map(f => `<button type="button" data-v="${f}" title="${FMT[f].sub}">${f}</button>`).join('')}</div>
          <button class="btn primary" id="stExport">${IC.exp}<span>Exportovať</span></button>
          <div class="st-win">
            <button class="st-ico" id="stMin" aria-label="Minimalizovať" title="Minimalizovať"><svg viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg></button>
            <button class="st-ico" id="stMax" aria-label="Maximalizovať" title="Maximalizovať"><svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg></button>
          </div>
        </header>
        <div class="st-mid">
          <aside class="st-left">
            <div class="seg st-ltabs" id="stLTabs" role="tablist"><button type="button" data-v="media" class="on">Médiá</button><button type="button" data-v="text">Text</button><button type="button" data-v="fx">Efekty</button></div>
            <div class="st-lpane" id="stMedia"></div>
            <div class="st-lpane" id="stTextLib" hidden></div>
            <div class="st-lpane" id="stFx" hidden></div>
          </aside>
          <div class="st-split v" data-s="mw" title="Ťahaj pre zmenu šírky (dvojklik = pôvodná)"></div>
          <div class="st-split v r" data-s="iw" title="Ťahaj pre zmenu šírky (dvojklik = pôvodná)"></div>
          <section class="st-stage" id="stStage">
            <div class="st-frame" id="stFrame">
              <div class="st-vids" id="stVids"></div>
              <div class="st-black" id="stBlack"></div>
              <canvas class="st-txt" id="stTxt"></canvas>
              <div class="st-empty" id="stEmpty">Pretiahni sem klip z ľavého panela<br><small>alebo daj „+“ pri klipe</small></div>
            </div>
            <div class="st-trans">
              <span class="st-tc" id="stTime">00:00.00</span>
              <button class="st-ico" id="stPrev" aria-label="Na začiatok">${IC.prev}</button>
              <button class="st-play" id="stPlay" aria-label="Prehrať (medzerník)">${I.play}</button>
              <button class="st-ico" id="stNext" aria-label="Na koniec">${IC.next}</button>
              <span class="st-tc dim" id="stDur">00:00.00</span>
              ${UI.volCtl()}
              <button class="st-ico" id="stFs" aria-label="Celá obrazovka (F)" title="Prehrať na celú obrazovku (F)"><svg viewBox="0 0 16 16"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
              <button class="st-hq${UI.previewFull() ? ' on' : ''}" id="stHq" title="Náhľad v plnej kvalite (inak rýchla kópia v 720p). Export je vždy v plnej kvalite.">HD</button>
            </div>
            <div class="st-fprog" id="stFprog"><i id="stFfill"></i></div>
          </section>
          <aside class="st-insp" id="stInsp"></aside>
        </div>
        <div class="st-tlbar">
          <div class="st-split h" data-s="th" title="Ťahaj pre zmenu výšky časovej osi (dvojklik = pôvodná)"></div>
          <button class="st-tool" id="stSplit" title="Rozdeliť na prehrávacej hlave (S)">${IC.split}<span>Rozdeliť</span><kbd>S</kbd></button>
          <button class="st-tool" id="stDel" title="Odstrániť vybrané (Delete, Shift+Delete zavrie medzeru)">${IC.del}<span>Odstrániť</span></button>
          <button class="st-tool" id="stAddText" title="Pridať text na prehrávaciu hlavu (T)">${IC.text}<span>Text</span></button>
          <button class="st-tool" id="stAddMusic" title="Pridať hudbu zo súboru">${IC.music}<span>Hudba</span></button>
          <span class="grow"></span>
          <span class="st-hint" id="stHint"></span>
          <button class="st-tool${snapOn ? ' on' : ''}" id="stSnap" title="Prichytávanie (N)">${IC.magnet}<span>Prichytávanie</span></button>
          <input type="range" id="stZoom" min="0" max="100" value="30" aria-label="Priblíženie časovej osi" title="Priblíženie (Ctrl + koliesko)">
        </div>
        <div class="st-tl" id="stTl">
          <div class="st-heads" id="stHeads"></div>
          <div class="st-scroll" id="stScroll">
            <div class="st-canvas" id="stCanvas">
              <div class="st-ruler" id="stRuler"></div>
              <div class="st-lanes" id="stLanes"></div>
              <div class="st-snap" id="stSnapLine" hidden></div>
              <div class="st-drop" id="stDrop" hidden></div>
              <div class="st-head" id="stHead"><i></i></div>
            </div>
          </div>
          <div class="st-hbar" id="stHbar"><i></i></div>
        </div>
        <div class="st-layer" id="stLayer" hidden></div>
      </div>`;
    document.body.appendChild(root);
    document.body.classList.add('st-open'); // ťahacia lišta okna pod editorom inak zhltne kliky (Electron app-region)
    const q = s => root.querySelector(s);
    const frame = q('#stFrame'), vids = q('#stVids'), txtCv = q('#stTxt'), stage = q('#stStage');
    const headEl = q('#stHead'), timeEl = q('#stTime'), fsFill = q('#stFfill');
    /* výplň posuvníka podľa hodnoty (predtým bola napevno v polovici) */
    function fillRange(r) { if (!r) return; const mn = Number(r.min || 0), mx = Number(r.max || 100), v = Number(r.value); r.style.setProperty('--f', String(clamp((v - mn) / ((mx - mn) || 1), 0, 1))); }
    const fillAll = el => $$('input[type=range]', el).forEach(fillRange);
    root.addEventListener('input', e => { if (e.target.matches && e.target.matches('input[type=range]')) fillRange(e.target); }, true);
    const scroll = q('#stScroll'), canvas = q('#stCanvas'), lanesEl = q('#stLanes'), heads = q('#stHeads'), ruler = q('#stRuler');

    /* ---------- projekt: stopy ---------- */
    const lane = id => P.lanes.find(l => l.id === id);
    function baseLanes() {
      if (!lane('v')) P.lanes.unshift({ id: 'v', kind: 'video', name: 'Video' });
      if (!lane('t')) P.lanes.splice(1, 0, { id: 't', kind: 'text', name: 'Text' });
    }
    function audioLaneFor(title, music) {
      const id = music ? 'music' : 'a:' + norm(title);
      let l = lane(id);
      if (!l) {
        const n = P.lanes.filter(x => x.kind === 'audio' && !x.music).length;
        l = { id, kind: 'audio', name: music ? 'Hudba' : title, vol: music ? 0.5 : 1, mute: false, solo: false, music: !!music, c: music ? '#ff9f0a' : AUDIO_C[n % AUDIO_C.length] };
        // hudba vždy úplne dole, ostatné zvuky nad ňou
        const mi = P.lanes.findIndex(x => x.music);
        if (music || mi < 0) P.lanes.push(l); else P.lanes.splice(mi, 0, l);
      }
      return l;
    }
    /* ktoré stopy z klipu použiť: Mix vynecháme, keď sú aj samostatné stopy (inak by bol zvuk dvakrát) */
    function usableTracks(s) {
      const tr = s.tracks || [];
      const only = tr.filter(x => !(/^mix/i.test(x.title || '') && tr.length > 1));
      return only.map(x => ({ ...x, title: tr.length === 1 && /^stopa/i.test(x.title || '') ? 'Zvuk' : x.title }));
    }

    /* ---------- čas ---------- */
    const sp = it => it.speed || 1;
    /* ---------- speed ramp: rýchlosť sa mení v čase (keyframy „speed“) ----------
       Zvuk prepojený s videom preberá krivku videa. Z krivky sa spočíta tabuľka: čas na osi → čas zdroja. */
    const rampSrc = it => it.kind === 'audio' && it.g ? (P.items.find(x => x.g === it.g && x.kind === 'video') || it) : it;
    const ramped = it => it.kind !== 'text' && KF.animated(rampSrc(it), 'speed');
    function spAt(it, T) { const r = rampSrc(it); return clamp(KF.at(r, 'speed', T + (it.start - r.start)), 0.1, 4); }
    const RT = 1 / 120, rampCache = new WeakMap();
    function rampTable(it) {
      const r = rampSrc(it), sig = JSON.stringify(r.kf && r.kf.speed) + '|' + (r.speed || 1) + '|' + it.in + '|' + it.out + '|' + (it.start - r.start);
      let c = rampCache.get(it); if (c && c.sig === sig) return c;
      const max = it.out - it.in, S = [0];
      let acc = 0, L = 0;
      for (let k = 0; k < 432000; k++) { // max 1 h
        const v = spAt(it, (k + 0.5) * RT), next = acc + v * RT;
        if (next >= max) { L = k * RT + (max - acc) / v; S.push(max); break; }
        acc = next; S.push(acc);
      }
      c = { sig, S, L: L || S.length * RT }; rampCache.set(it, c); return c;
    }
    /* čas zdroja pre čas T od začiatku položky (pri ramp z tabuľky, inak lineárne) */
    function srcPos(it, T) {
      if (!ramped(it)) return it.in + T * sp(it);
      const tb = rampTable(it), x = clamp(T, 0, tb.L) / RT, i = Math.floor(x), f = x - i;
      const a = tb.S[Math.min(i, tb.S.length - 1)], b = tb.S[Math.min(i + 1, tb.S.length - 1)];
      return it.in + a + (b - a) * f;
    }
    const len = it => it.kind === 'text' ? it.end - it.start : ramped(it) ? rampTable(it).L : (it.out - it.in) / sp(it);
    /* zdroj aj mimo položky (predĺženie pri prechode): okrajovou rýchlosťou, orezané na dĺžku zdroja */
    function srcAtRender(it, t) {
      const T = t - it.start, L = len(it), s = src.get(it.src), D = (s && s.duration) || it.out;
      if (T < 0) return Math.max(0, it.in + T * spAt(it, 0));
      if (T > L) return Math.min(D - 0.02, it.out + (T - L) * spAt(it, L));
      return srcPos(it, T);
    }
    const end = it => it.start + len(it);
    const duration = () => Math.max(0, ...P.items.map(end));
    const itemsOn = id => P.items.filter(it => it.lane === id).sort((a, b) => a.start - b.start);
    const fitMode = it => it.fit || (P.fmt === '16:9' ? 'fit' : 'cover');
    function outSize() {
      const v = P.items.find(i => i.kind === 'video'), s = v && src.get(v.src);
      const sh = (s && s.height) || 1080;
      if (P.fmt === '16:9') { const h = sh >= 1440 ? 1440 : 1080; return [Math.round(h * 16 / 9 / 2) * 2, h]; }
      if (P.fmt === '9:16') return [1080, 1920];
      return [1080, 1080];
    }

    /* ---------- zdroje ---------- */
    async function loadSource(meta, music) {
      if (src.has(meta.path)) return src.get(meta.path);
      const s = { path: meta.path, name: meta.name || meta.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''), duration: meta.duration || 0, width: meta.width || 0, height: meta.height || 0, fps: meta.fps || 60, tracks: [], levels: [], music: !!music, audio: new Map(), thumbs: [], ready: false };
      src.set(meta.path, s);
      try {
        const r = await api.action('extractTracks', { path: meta.path });
        s.duration = r.duration || s.duration; s.width = r.width || s.width; s.height = r.height || s.height; s.fps = r.fps || s.fps;
        s.tracks = r.tracks || [];
        s.levels = s.tracks.map(tr => { try { return tr.levels ? Uint8Array.from(atob(tr.levels), c => c.charCodeAt(0)) : null; } catch (e) { return null; } });
      } catch (e) {
        if (!music) throw e;
        // hudba v kontajneri, ktorý sa nedá skopírovať do m4a (napr. wav) → prehráme pôvodný súbor
        try { const pr = await api.action('probe', { path: meta.path }); s.duration = pr.duration || 0; } catch (x) { }
        s.tracks = [{ i: 0, title: 'Hudba', file: meta.path }];
      }
      if (closed) return s; // editor sa medzitým zavrel: nevyrábaj nové prehrávače (zvuk by hral na pozadí)
      if (music) s.tracks = s.tracks.slice(0, 1).map(x => ({ ...x, title: 'Hudba' }));
      if (!music) {
        const v = document.createElement('video');
        v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = fileUrl(s.path);
        v.addEventListener('loadedmetadata', () => { if (!s.width) { s.width = v.videoWidth; s.height = v.videoHeight; } if (!s.duration) s.duration = v.duration; }, { once: true });
        vids.appendChild(v); s.video = v;
        // náhľadová kópia (720p, kľúčová snímka každých 0,25 s, kóduje grafika): okamžité skoky a nízka záťaž;
        // náhľady na časovej osi sa robia z nej (rýchlejšie)
        UI.useProxy(v, s.path).then(() => makeThumbs(s)).catch(() => makeThumbs(s));
      }
      for (const tr of s.tracks) { const a = new Audio(fileUrl(tr.file)); a.preload = 'auto'; s.audio.set(tr.i, a); }
      s.ready = true;
      return s;
    }
    async function makeThumbs(s) {
      if (!s.duration) await new Promise(r => setTimeout(r, 300));
      const D = s.duration; if (!D) return;
      const n = Math.max(4, Math.min(80, Math.ceil(D / 2)));
      const fv = document.createElement('video'); fv.muted = true; fv.preload = 'auto'; fv.src = fileUrl((s.video && s.video._proxy) || s.path);
      try { await new Promise((res, rej) => { fv.addEventListener('loadeddata', res, { once: true }); fv.addEventListener('error', rej, { once: true }); }); } catch (e) { fv.removeAttribute('src'); fv.load(); return; }
      if (closed) { fv.removeAttribute('src'); fv.load(); return; }
      const th = 54, tw = Math.round(th * (fv.videoWidth || 16) / (fv.videoHeight || 9));
      s.thumbW = tw; s.thumbN = n;
      for (let k = 0; k < n && !closed; k++) {
        await new Promise(res => { const done = () => res(); fv.addEventListener('seeked', done, { once: true }); setTimeout(done, 1200); fv.currentTime = Math.min(D - 0.05, (k + 0.5) * D / n); });
        const c = document.createElement('canvas'); c.width = tw; c.height = th;
        try { c.getContext('2d').drawImage(fv, 0, 0, tw, th); s.thumbs[k] = c; } catch (e) { }
        if (k % 8 === 7 || k === n - 1) requestDraw();
      }
      s.thumbN = n;
      fv.removeAttribute('src'); fv.load();
    }

    /* ---------- položky ---------- */
    function addClipAt(s, start, opt = {}) {
      const g = uid(), D = s.duration || 0.1;
      const a = opt.in || 0, b = opt.out != null ? opt.out : D, speed = opt.speed || 1;
      const v = { id: uid(), lane: 'v', kind: 'video', src: s.path, start, in: a, out: b, speed, g, zoom: 1, cx: opt.cx ?? 0.5, cy: 0.5, fadeIn: !!opt.fadeIn, fadeOut: !!opt.fadeOut };
      P.items.push(v);
      for (const tr of usableTracks(s)) {
        const l = audioLaneFor(tr.title);
        P.items.push({ id: uid(), lane: l.id, kind: 'audio', src: s.path, ti: tr.i, start, in: a, out: b, speed, g, vol: 1, fadeIn: !!opt.fadeIn, fadeOut: !!opt.fadeOut });
      }
      return v;
    }
    /* vlož klip na čas `at`; keď by sa prekrýval s iným videom, posuň všetko za ním (ripple) */
    function insertClip(s, at, opt) {
      const D = ((opt && opt.out != null ? opt.out : s.duration) - ((opt && opt.in) || 0)) / ((opt && opt.speed) || 1);
      const vs = itemsOn('v');
      const hit = vs.find(it => at > it.start + 1e-3 && at < end(it) - 1e-3);
      if (hit) at = end(hit);
      const clash = vs.some(it => it.start < at + D - 1e-3 && end(it) > at + 1e-3);
      if (clash) for (const it of P.items) if (it.start >= at - 1e-3) { it.start += D; if (it.kind === 'text') it.end += D; }
      return addClipAt(s, Math.max(0, at), opt);
    }
    const group = it => it.g ? P.items.filter(x => x.g === it.g) : [it];

    /* ---------- história ---------- */
    const snapshot = () => JSON.stringify({ fmt: P.fmt, name: P.name, lanes: P.lanes, items: P.items });
    function commit() {
      undo.push(lastSnap); if (undo.length > 120) undo.shift();
      redo.length = 0; lastSnap = snapshot(); persist(); updHist();
    }
    let lastSnap = '';
    function restore(json) {
      const o = JSON.parse(json);
      P.fmt = o.fmt; P.name = o.name; P.lanes = o.lanes; P.items = o.items;
      sel = new Set([...sel].filter(id => P.items.some(i => i.id === id)));
      lastSnap = json; persist(); renderAll();
    }
    function doUndo() { if (!undo.length) return; redo.push(lastSnap); restore(undo.pop()); updHist(); }
    function doRedo() { if (!redo.length) return; undo.push(lastSnap); restore(redo.pop()); updHist(); }
    function updHist() { q('#stUndo').disabled = !undo.length; q('#stRedo').disabled = !redo.length; }
    let persistT = 0;
    const projectId = opts.projectId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    function projData() {
      const sources = {};
      for (const sr of src.values()) if (P.items.some(i => i.src === sr.path)) sources[sr.path] = { path: sr.path, name: sr.name, duration: sr.duration, music: sr.music };
      return { v: 1, name: P.name, fmt: P.fmt, fps: P.fps, lanes: P.lanes, items: P.items, sources, t, at: Date.now() };
    }
    /* projekt sa ukladá sám (súbor v AppData), pri zatvorení hneď */
    function persist(now) {
      clearTimeout(persistT);
      const go = () => { if (!P.items.length && !opts.projectId && !savedOnce) return; savedOnce = true; api.action('projSave', { id: projectId, data: projData() }).catch(e => console.warn('projSave', e)); };
      if (now) go(); else persistT = setTimeout(go, 600);
    }
    let savedOnce = false;

    /* ---------- vstup: z jednoduchého editora, z knižnice alebo uložený projekt ---------- */
    async function init() {
      if (opts.projectId) {
        try {
          const prev = await api.action('projLoad', { id: opts.projectId });
          P = { ...P, ...prev, sources: {} };
          savedOnce = true;
          const missing = [];
          for (const m of Object.values(prev.sources || {})) {
            try { await loadSource(m, m.music); } catch (e) { missing.push(m.name || m.path); P.items = P.items.filter(i => i.src !== m.path); }
            if (closed) return;
          }
          if (missing.length) toast('warn', 'Niektoré klipy chýbajú', missing.join(', '));
          t = clamp(prev.t || 0, 0, duration());
        } catch (e) { toast('error', 'Projekt sa nepodarilo otvoriť', e.message); }
      }
      baseLanes();
      if (input.clips && input.clips.length) {
        if (!opts.projectId) P.name = input.name || 'Montáž';
        if (!opts.projectId && input.aspect && FMT[input.aspect]) P.fmt = input.aspect;
        let at = Math.max(0, ...itemsOn('v').map(end));
        for (const c of input.clips) { try { await loadSource(c); } catch (e) { if (!closed) toast('error', 'Klip sa nepodarilo otvoriť', `${c.name || ''} ${e.message}`); } if (closed) return; }
        const segs = input.segs && input.segs.length ? input.segs : input.clips.map(c => ({ src: c.path }));
        const base = at;
        for (const sg of segs) {
          const sr = src.get(sg.src); if (!sr) continue;
          const v = addClipAt(sr, at, sg);
          at = end(v);
        }
        // nastavenie stôp z jednoduchého editora (hlasitosť, vypnuté stopy)
        for (const mx of input.mixer || []) {
          if (/^mix/i.test(mx.title || '')) continue;
          const l = lane('a:' + norm(mx.title)); if (!l) continue;
          l.vol = mx.vol ?? 1; l.mute = mx.on === false;
        }
        // text z jednoduchého editora (šípky zatiaľ nie)
        for (const o of input.overlays || []) {
          if (o.type !== 'text' || !String(o.text || '').trim()) continue;
          P.items.push({ id: uid(), lane: 't', kind: 'text', start: base + o.start, end: base + o.end, text: o.text, style: o.box ? 'caption' : o.font === 'impact' ? 'meme' : o.glow ? 'neon' : 'gamer', color: o.color || '#ffffff', size: clamp((o.size || 80) / (o.H || 1080), 0.03, 0.3), x: clamp01(o.x / (o.W || 1920)), y: clamp01(o.y / (o.H || 1080)), animIn: o.animIn || 'none', animOut: o.animOut || 'none' });
        }
        if (input.overlays && input.overlays.some(o => o.type === 'arrow')) toast('info', 'Šípky sa neprenášajú', 'Advanced editor zatiaľ šípky nemá, text áno.');
        if (opts.projectId) toast('ok', 'Pridané do projektu', `${input.clips.length} ${input.clips.length === 1 ? 'klip' : 'klipy'} na koniec`);
      }
      lastSnap = snapshot(); persist(true);
      [W, H] = outSize();
      renderAll();
      fitZoom();
      seek(t);
    }

    /* ---------- render: všetko ---------- */
    function renderAll() {
      [W, H] = outSize();
      q('#stName').value = P.name || 'Montáž';
      $$('#stFmt button', root).forEach(b => b.classList.toggle('on', b.dataset.v === P.fmt));
      layoutFrame(); renderMedia(); renderTimeline(); renderInsp(); updHist(); syncMedia(true); drawFrame();
      q('#stEmpty').hidden = P.items.some(i => i.kind === 'video');
      q('#stDur').textContent = tc(duration());
    }

    /* ---------- médiá (knižnica) ---------- */
    /* médiá: rovnaké filtre ako pri pridávaní klipu v jednoduchom editore (text, dátum, hra, zoradenie) */
    let mediaQ = '', mediaSort = 'new', mediaRange = null, mediaGame = '';
    const SORT = { new: 'Najnovšie', old: 'Najstaršie', long: 'Najdlhšie', name: 'Podľa názvu' };
    const CMP = { new: (x, y) => (y.mtime || 0) - (x.mtime || 0), old: (x, y) => (x.mtime || 0) - (y.mtime || 0), long: (x, y) => (y.duration || 0) - (x.duration || 0), name: (x, y) => String(x.name).localeCompare(String(y.name), 'sk', { numeric: true }) };
    const nz = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    function mediaList() {
      const words = nz(mediaQ).trim().split(/\s+/).filter(Boolean);
      return lib().filter(c => !/\.mkv$/i.test(c.path)).filter(c => {
        if (mediaGame && (c.game || '') !== mediaGame) return false;
        if (mediaRange && window.Cal && !Cal.inRange(c.mtime, mediaRange)) return false;
        if (!words.length) return true;
        const d = new Date(c.mtime || 0);
        const hay = nz([c.name, c.game, UI.dayLabel ? UI.dayLabel(c.mtime) : '', `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`].join(' '));
        return words.every(w => hay.includes(w));
      }).sort(CMP[mediaSort]);
    }
    function renderMedia() {
      const el = q('#stMedia');
      if (!el.querySelector('.st-mlist')) {
        el.innerHTML = `<div class="st-mh"><b>Médiá</b><button class="btn ghost small" id="stImport" title="Pridať video zo súboru">${IC.plus}<span>Zo súboru</span></button></div>
          <label class="st-sq">${I.search}<input id="stMq" placeholder="Hľadať názov, hru, dátum…" spellcheck="false" autocomplete="off" aria-label="Hľadať klip"><button class="st-qx" id="stMqx" aria-label="Vymazať" hidden>${I.x}</button></label>
          <div class="st-mf">
            <button class="st-chipb" id="stMDate" type="button">${I.cal}<span>Dátum</span></button>
            <button class="st-chipb" id="stMGame" type="button"><span>Hra</span></button>
            <button class="st-chipb" id="stMSort" type="button"><span>${SORT[mediaSort]}</span></button>
          </div>
          <div class="st-mcount" id="stMCount"></div>
          <div class="st-mlist" id="stMList"></div>
          <div id="stMusicList"></div>`;
        const qi = q('#stMq'), qx = q('#stMqx');
        qi.oninput = () => { mediaQ = qi.value; qx.hidden = !qi.value; paintMedia(); };
        qi.onkeydown = e => { if (e.key === 'Escape' && qi.value) { e.stopPropagation(); qx.click(); } };
        qx.onclick = () => { qi.value = ''; mediaQ = ''; qx.hidden = true; paintMedia(); qi.focus(); };
        q('#stImport').onclick = async () => {
          const files = await api.action('pickFiles', { kind: 'video' }).catch(() => []);
          for (const f of files) await addFromPath({ path: f }, Math.max(0, ...itemsOn('v').map(end)));
        };
        const dBtn = q('#stMDate');
        dBtn.onclick = e => {
          if (!window.Cal) return;
          if (e.target.closest('.dx')) { mediaRange = null; paintMedia(); return; }
          Cal.open(dBtn, { range: mediaRange, counts: () => Cal.countsOf(lib()) }, r => { mediaRange = r; paintMedia(); });
        };
        q('#stMGame').onclick = e => {
          const games = [...new Set(lib().map(c => c.game).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'sk'));
          menu(e.currentTarget, [{ label: 'Všetky hry', v: '', checked: !mediaGame }, ...(games.length ? [{ sep: true }] : []), ...games.map(g => ({ label: g, v: g, checked: g === mediaGame }))], it => { mediaGame = it.v; paintMedia(); });
        };
        q('#stMSort').onclick = e => menu(e.currentTarget, Object.entries(SORT).map(([v, l]) => ({ label: l, v, checked: v === mediaSort })), it => { mediaSort = it.v; paintMedia(); });
        const list = q('#stMList');
        list.addEventListener('click', e => {
          const b = e.target.closest('[data-add]'); if (!b) return;
          e.stopPropagation(); const c = lib().find(x => x.path === b.dataset.add); if (c) addFromPath(c, Math.max(0, ...itemsOn('v').map(end)));
        });
        list.addEventListener('dblclick', e => { const m = e.target.closest('.st-mi'); if (!m) return; const c = lib().find(x => x.path === m.dataset.path); if (c) addFromPath(c, t); });
        list.addEventListener('dragstart', e => { const m = e.target.closest('.st-mi'); if (!m) return; e.dataTransfer.setData('text/x-lat-clip', m.dataset.path); e.dataTransfer.effectAllowed = 'copy'; });
      }
      paintMedia();
    }
    let mediaSig = '';
    function paintMedia() {
      const used = new Set(P.items.map(i => i.src));
      // prekresli len keď sa niečo zmenilo (inak by náhľady blikali pri každej úprave)
      const sig = [mediaQ, mediaSort, JSON.stringify(mediaRange), mediaGame, [...used].sort().join('|'), lib().length, [...src.values()].filter(m => m.music).length].join('§');
      if (sig === mediaSig) return; mediaSig = sig;
      const all = lib().filter(c => !/\.mkv$/i.test(c.path)).length;
      const clips = mediaList();
      const dBtn = q('#stMDate');
      dBtn.classList.toggle('on', !!mediaRange);
      dBtn.innerHTML = `${I.cal}<span>${mediaRange && window.Cal ? esc(Cal.label(mediaRange)) : 'Dátum'}</span>${mediaRange ? `<i class="dx" title="Zrušiť">${I.x}</i>` : ''}`;
      const gB = q('#stMGame'); gB.classList.toggle('on', !!mediaGame); gB.querySelector('span').textContent = mediaGame || 'Hra';
      q('#stMSort span').textContent = SORT[mediaSort];
      q('#stMCount').textContent = clips.length === all ? `${all} ${all === 1 ? 'klip' : all < 5 ? 'klipy' : 'klipov'}` : `${clips.length} z ${all}`;
      q('#stMList').innerHTML = clips.slice(0, 300).map(c => `
          <div class="st-mi${used.has(c.path) ? ' used' : ''}" draggable="true" data-path="${esc(c.path)}" title="${esc(c.name)}${c.game ? ' · ' + esc(c.game) : ''} · pretiahni na časovú os">
            <div class="st-mt">${c.thumb ? `<img src="${esc(fileUrl(c.thumb))}" alt="" draggable="false" loading="lazy" decoding="async">` : ''}<span>${tShort(c.duration || 0)}</span></div>
            <div class="st-mn">${esc(c.name)}</div>
            <button class="st-madd" data-add="${esc(c.path)}" aria-label="Pridať na koniec" title="Pridať na koniec">${IC.plus}</button>
          </div>`).join('') || `<p class="st-note">${all ? 'Nič sa nenašlo. Skús iné slovo alebo zruš filter.' : 'Knižnica je prázdna.'}</p>`;
      const music = [...src.values()].filter(m => m.music);
      q('#stMusicList').innerHTML = music.length ? `<div class="st-mh sub"><b>Hudba v projekte</b></div>${music.map(m => `<div class="st-mu">${IC.music}<span>${esc(m.name)}</span></div>`).join('')}` : '';
    }
    async function addFromPath(c, at) {
      let s;
      try { s = await loadSource(c); } catch (e) { toast('error', 'Klip sa nepodarilo otvoriť', e.message); return; }
      const before0 = startsNow();
      const v = insertClip(s, at);
      setTimeout(() => glideFrom(before0), 0);
      sel = new Set([v.id]);
      commit(); renderAll();
      if (duration() * pps > scroll.clientWidth - 40) fitZoom(); // nový klip sa nezmestí → oddiaľ os
      flashItem(v.id);
    }

    /* ---------- náhľad ---------- */
    let fk = 1;
    function layoutFrame() {
      const fsOn = document.fullscreenElement === stage;
      const r = fsOn ? { w: stage.clientWidth, h: stage.clientHeight } : { w: stage.clientWidth - 32, h: stage.clientHeight - 70 };
      if (r.w <= 0) return;
      const A = W / H;
      let fw = r.w, fh = fw / A;
      if (fh > r.h) { fh = r.h; fw = fh * A; }
      frame.style.width = fw + 'px'; frame.style.height = fh + 'px';
      fk = fw / W;
      txtCv.width = Math.round(fw * devicePixelRatio); txtCv.height = Math.round(fh * devicePixelRatio);
      placeVideo(activeVideo());
    }
    const activeVideo = (time = t) => itemsOn('v').find(it => time >= it.start - 1e-4 && time < end(it) - 1e-4) || null;

    /* ---------- prechody medzi klipmi ----------
       it.tin = { type, d } na klipe B = prechod z predošlého susedného klipu A. Okno je okolo strihu [strih − d/2, strih + d/2].
       ov = klipy sa prekryjú (A pokračuje za strihom, B začne skôr — zábery za/pred strihom, inak zamrznutá snímka). */
    const TRANS = {
      fade: { l: 'Prelínanie', ov: true, d: 0.6 },
      black: { l: 'Cez čiernu', ov: false, d: 0.8 },
      white: { l: 'Záblesk', ov: false, d: 0.35 },
      pushL: { l: 'Posun doľava', ov: true, d: 0.5 },
      pushR: { l: 'Posun doprava', ov: true, d: 0.5 },
      up: { l: 'Posun hore', ov: true, d: 0.5 },
      zoom: { l: 'Priblíženie', ov: true, d: 0.5 }
    };
    function prevAdj(B) { return itemsOn('v').find(x => x !== B && Math.abs(end(x) - B.start) < 0.04) || null; }
    function transOf(B) {
      if (!B.tin || !TRANS[B.tin.type]) return null;
      const A = prevAdj(B); if (!A) return null;
      const d = clamp(B.tin.d || TRANS[B.tin.type].d, 0.1, Math.min(2, len(A) * 0.9, len(B) * 0.9));
      const cut = B.start;
      return { A, B, type: B.tin.type, ov: TRANS[B.tin.type].ov, d, cut, w0: cut - d / 2, w1: cut + d / 2 };
    }
    const smooth01 = p => { p = clamp(p, 0, 1); return p * p * (3 - 2 * p); };
    /* plán vykreslenia: pre každé video jeho skutočný rozsah (s predĺžením) a obálky prechodov.
       Rovnaký plán použije náhľad aj export, takže sedia. */
    function renderPlan() {
      const vs = itemsOn('v'), plan = new Map();
      for (const it of vs) plan.set(it.id, { it, rs: it.start, re: end(it), env: [] });
      for (const B of vs) {
        const tr = transOf(B); if (!tr) continue;
        const pa = plan.get(tr.A.id), pb = plan.get(B.id);
        if (tr.ov) { pa.re = Math.max(pa.re, tr.w1); pb.rs = Math.min(pb.rs, tr.w0); }
        pa.env.push({ role: 'A', ...tr }); pb.env.push({ role: 'B', ...tr });
      }
      return [...plan.values()];
    }
    /* stav vrstvy v čase t: priehľadnosť, posun, násobok priblíženia, farebné stmievanie */
    function layerState(p, time) {
      let a = 1, dx = 0, dy = 0, sm = 1, cf = null;
      for (const e of p.env) {
        const P2 = (time - e.w0) / e.d, E = smooth01(P2);
        if (e.ov) {
          if (time < e.w0 || time > e.w1) continue;
          if (e.type === 'fade') { if (e.role === 'B') a *= clamp(P2, 0, 1); }
          else if (e.type === 'pushL') dx += e.role === 'A' ? -E : 1 - E;
          else if (e.type === 'pushR') dx += e.role === 'A' ? E : -(1 - E);
          else if (e.type === 'up') dy += e.role === 'A' ? -E : 1 - E;
          else if (e.type === 'zoom') { if (e.role === 'A') sm *= 1 + 0.3 * E; else { a *= clamp(P2, 0, 1); sm *= 1.2 - 0.2 * E; } }
        } else {
          const c = e.type === 'white' ? '#fff' : '#000';
          if (e.role === 'A' && time >= e.w0 && time < e.cut) cf = { c, a: clamp((time - e.w0) / (e.cut - e.w0), 0, 1) };
          if (e.role === 'B' && time >= e.cut && time <= e.w1) cf = { c, a: 1 - clamp((time - e.cut) / (e.w1 - e.cut), 0, 1) };
        }
      }
      // obyčajné roztmievanie / stmievanie klipu (čierne)
      const it = p.it, D = len(it), F2 = Math.min(0.5, D / 3), tt = time - it.start;
      if (it.fadeIn && tt >= 0 && tt < F2) cf = { c: '#000', a: Math.max(cf && cf.c === '#000' ? cf.a : 0, 1 - tt / F2) };
      if (it.fadeOut && tt <= D && D - tt < F2) cf = { c: '#000', a: Math.max(cf && cf.c === '#000' ? cf.a : 0, 1 - (D - tt) / F2) };
      return { a, dx, dy, sm, cf };
    }
    /* prehrávač pre vrstvu: hlavný prehrávač zdroja, alebo druhý (keď sa pri prechode stretnú dve časti toho istého klipu) */
    function playerFor(s, used) {
      if (s.video && !used.has(s.video)) return s.video;
      if (!s.video2) {
        const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.playsInline = true;
        v.src = fileUrl((s.video && s.video._usingProxy && s.video._proxy) || s.path);
        v._orig = s.path; v._proxy = s.video && s.video._proxy; v._usingProxy = !!(s.video && s.video._usingProxy);
        vids.appendChild(v); s.video2 = v;
      }
      return used.has(s.video2) ? null : s.video2;
    }
    /* umiestnenie (Zmestiť/Vyplniť + výrez) a pohyb (keyframy + prechod) jedného prehrávača — rovnako ako export */
    function placeLayer(el, it, st, z) {
      const s = src.get(it.src); if (!s) return;
      const fw = W * fk, fh = H * fk, zz = clamp(it.zoom || 1, 1, 4);
      const sw0 = s.width || 1920, sh0 = s.height || 1080;
      const k = fitMode(it) === 'cover' ? Math.max(fw * zz / sw0, fh * zz / sh0) : Math.min(fw * zz / sw0, fh * zz / sh0);
      const sw = sw0 * k, sh = sh0 * k, cw = Math.min(sw, fw), ch = Math.min(sh, fh);
      const x = (fw - cw) / 2 - (sw - cw) * (it.cx ?? 0.5), y = (fh - ch) / 2 - (sh - ch) * (it.cy ?? 0.5);
      const T = clamp(t - it.start, 0, len(it));
      const sc = KF.at(it, 'scale', T) * st.sm, mx = KF.at(it, 'x', T) + st.dx, my = KF.at(it, 'y', T) + st.dy, r = KF.at(it, 'rot', T);
      // otočenie a priblíženie okolo stredu rámu, potom posun
      const tr = `translate(${mx * fw}px, ${my * fh}px) rotate(${r}deg) scale(${sc})`;
      const key = `${sw.toFixed(1)}|${sh.toFixed(1)}|${x.toFixed(1)}|${y.toFixed(1)}|${tr}|${st.a.toFixed(3)}|${z}`;
      if (el._pk === key) return; el._pk = key;
      Object.assign(el.style, { width: sw + 'px', height: sh + 'px', left: x + 'px', top: y + 'px', transformOrigin: `${fw / 2 - x}px ${fh / 2 - y}px`, transform: tr, opacity: String(st.a), zIndex: String(z), visibility: 'visible' });
    }
    /* vrstvy v čase t a ich prehrávače; vráti farbu stmievania pre prekrytie */
    let layersNow = [];
    function composeVideo(force) {
      const used = new Set(), layers = [];
      let cf = null;
      renderPlan().forEach((p, i) => {
        if (t < p.rs - 1e-4 || t >= p.re - 1e-4) return;
        const s = src.get(p.it.src); if (!s) return;
        const el = playerFor(s, used); if (!el) return;
        used.add(el);
        const st = layerState(p, t);
        if (st.cf && (!cf || st.cf.a > cf.a)) cf = st.cf;
        layers.push({ p, el, st, z: i + 1 });
      });
      layersNow = layers;
      for (const L of layers) {
        placeLayer(L.el, L.p.it, L.st, L.z);
        const it = L.p.it, v = L.el, want = srcAtRender(it, t), rate = spAt(it, clamp(t - it.start, 0, len(it)));
        if (playing) {
          if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
          if (v.paused) { UI.smoothSeek(v, want); v.play().catch(() => { }); }
          else if (Math.abs(v.currentTime - want) > 0.25 && !v.seeking) v.currentTime = want;
        } else {
          if (!v.paused) v.pause();
          const cur = v._want != null ? v._want : v.currentTime;
          if (Math.abs(cur - want) > 1e-3 || (force && v._want == null)) UI.smoothSeek(v, want);
        }
      }
      for (const s of src.values()) for (const v of [s.video, s.video2]) {
        if (!v || used.has(v)) continue;
        if (!v.paused) v.pause();
        if (v.style.visibility !== 'hidden') { v.style.visibility = 'hidden'; v._pk = ''; }
      }
      const bl = q('#stBlack');
      const op = cf ? cf.a.toFixed(3) : '0', bg = cf ? cf.c : '#000';
      if (bl.style.opacity !== op) bl.style.opacity = op;
      if (cf && bl.style.background !== bg) bl.style.background = bg;
    }
    function placeVideo() { composeVideo(false); }
    function applyMotion() { composeVideo(false); }
    let txtDrawn = false;
    function drawFrame() {
      const anyText = P.items.some(it => it.kind === 'text' && t >= it.start && t < it.end);
      if (!anyText && !txtDrawn) return; // nič na kreslenie → plátno netreba čistiť každú snímku
      txtDrawn = anyText;
      const g = txtCv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, txtCv.width, txtCv.height);
      const k = txtCv.width / W;
      g.setTransform(k, 0, 0, k, 0, 0);
      for (const it of itemsOn('t')) {
        if (t < it.start || t >= it.end || !String(it.text || '').trim()) continue;
        // pri úpravách (zastavené prehrávanie) je vybraný text vždy celý viditeľný, animácia beží len pri prehrávaní
        const a = !playing && sel.has(it.id) ? { op: 1, sc: 1, dy: 0 } : animAt(it, t, H);
        const T = t - it.start, ks = KF.at(it, 'scale', T), kr = KF.at(it, 'rot', T);
        const cx = KF.at(it, 'x', T) * W, cy = KF.at(it, 'y', T) * H + a.dy;
        g.save(); g.globalAlpha = a.op; g.translate(cx, cy); g.rotate(kr * Math.PI / 180); g.scale(a.sc * ks, a.sc * ks);
        const M = drawText(g, it, 0, 0, H);
        if (sel.has(it.id) && !playing) {
          const bw = (textLook(it).box ? M.w + M.padX * 2 : M.w) + 16, bh = (textLook(it).box ? M.h + M.padY * 2 : M.h) + 12;
          g.strokeStyle = '#ff9f0a'; g.lineWidth = 2 / k / ks; g.setLineDash([6 / k / ks, 4 / k / ks]); g.strokeRect(-bw / 2, -bh / 2, bw, bh);
        }
        g.restore();
      }
    }

    /* prehrávanie: hodiny editora riadia video aj všetky zvukové prvky */
    function audible(l) {
      if (!l) return false;
      const solo = P.lanes.some(x => x.kind === 'audio' && x.solo);
      return !l.mute && (!solo || l.solo);
    }
    function syncMedia(force) {
      if (closed) return;
      composeVideo(force);
      // zvuk: každý prvok (klip × stopa) hrá, keď je jeho položka pod hlavou
      const want = new Map();
      for (const it of P.items) {
        if (it.kind !== 'audio' || t < it.start || t >= end(it)) continue;
        const l = lane(it.lane); if (!audible(l)) continue;
        const s = src.get(it.src); if (!s) continue;
        const a = s.audio.get(it.ti); if (!a) continue;
        const D = len(it), F2 = Math.min(0.5, D / 3), tt = t - it.start;
        let fade = 1;
        if (it.fadeIn && tt < F2) fade *= tt / F2;
        if (it.fadeOut && D - tt < F2) fade *= (D - tt) / F2;
        want.set(a, { pos: srcPos(it, tt), rate: spAt(it, tt), vol: clamp((l.vol ?? 1) * KF.at(it, 'vol', tt) * fade, 0, 1) });
      }
      for (const s of src.values()) for (const a of s.audio.values()) {
        const w = want.get(a);
        if (w && playing) {
          a.volume = Math.min(1, w.vol * UI.pvol());
          if (a.playbackRate !== w.rate) a.playbackRate = w.rate;
          if (Math.abs(a.playbackRate - w.rate) > 0.01) a.playbackRate = w.rate;
          if (a.paused) { a.currentTime = w.pos; a.play().catch(() => { }); }
          else if (Math.abs(a.currentTime - w.pos) > 0.12) a.currentTime = w.pos;
        } else if (!a.paused) a.pause();
      }
    }
    function tick() {
      if (closed) return;
      raf = requestAnimationFrame(tick);
      t = t0 + (performance.now() - clock0) / 1000;
      const D = duration();
      if (t >= D) { t = D; pause(); }
      syncMedia(false); drawFrame(); updHead(true);
    }
    function play() {
      if (closed || playing || !P.items.length) return;
      if (t >= duration() - 0.03) t = 0;
      playing = true; t0 = t; clock0 = performance.now();
      q('#stPlay').innerHTML = I.pause; root.classList.add('playing');
      syncMedia(true); tick();
    }
    function pause() {
      if (!playing) return;
      playing = false; cancelAnimationFrame(raf);
      q('#stPlay').innerHTML = I.play; root.classList.remove('playing');
      syncMedia(true); drawFrame(); persist();
      if (sel.size || trSel) renderInsp(); // hodnoty v inšpektore podľa miesta, kde sa zastavilo
    }
    function seek(x, keepPlaying = true) {
      t = clamp(x, 0, Math.max(0, duration()));
      // hlava odišla z vybraného keyframu → výber keyframu zruš (posuvníky potom upravujú hodnotu na hlave)
      if (kfSel) { const ki = P.items.find(i => i.id === kfSel.id); if (!ki || Math.abs(ki.start + kfSel.t - t) > 0.02) kfSel = null; }
      if (playing && keepPlaying) { t0 = t; clock0 = performance.now(); }
      syncMedia(true); drawFrame(); updHead(false);
    }
    function updHead(follow) {
      const x = t * pps;
      headEl.style.transform = `translate3d(${x}px,0,0)`;
      const txt = tc(t); if (timeEl.textContent !== txt) timeEl.textContent = txt;
      if (fsFill && document.fullscreenElement === stage) { const dd = duration(); fsFill.style.width = (dd ? Math.min(100, t / dd * 100) : 0) + '%'; }
      if (follow) {
        const vw = scroll.clientWidth;
        if (x > sx + vw - 40) setSX(x - 80, true);
      }
    }

    /* ---------- časová os ---------- */
    function fitZoom() {
      const D = Math.max(10, duration() * 1.08);
      const vw = Math.max(200, scroll.clientWidth - 20);
      pps = clamp(vw / D, 2, 400);
      q('#stZoom').value = String(Math.round(Math.log(pps / 2) / Math.log(200) * 100)); fillRange(q('#stZoom'));
      renderTimeline();
    }
    function setZoom(v, anchorX) {
      const old = pps, ax = anchorX ?? scroll.clientWidth / 2;
      const at = (sx + ax) / old;
      pps = clamp(2 * Math.pow(200, v / 100), 2, 400);
      renderTimeline();
      setSX(at * pps - ax, true);
    }
    function rulerStep() { const want = 90 / pps; return [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => s >= want) || 600; }
    function renderTimeline() {
      const D = Math.max(duration() + 30, scroll.clientWidth / pps);
      contentW = Math.ceil(D * pps);
      canvas.style.width = contentW + 'px';
      setSX(sx, false);
      const step = rulerStep();
      let r = '';
      const lbl = x => step < 1 ? `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}` : tShort(x);
      for (let x = 0; x <= D + 1e-6; x += step) r += `<span style="left:${x * pps}px">${lbl(x)}</span>`;
      ruler.innerHTML = r;
      heads.innerHTML = `<div class="st-hr"></div>` + P.lanes.map(l => {
        const h = LANE_H[l.kind];
        if (l.kind !== 'audio') return `<div class="st-lh" style="height:${h}px"><i style="background:${l.kind === 'video' ? 'var(--blue)' : 'var(--lilac)'}"></i><span>${esc(l.name)}</span></div>`;
        return `<div class="st-lh${audible(l) ? '' : ' off'}" style="height:${h}px" data-lane="${esc(l.id)}">
          <i style="background:${l.c}"></i><span title="${esc(l.name)}">${esc(l.name)}</span>
          <button class="st-ms${l.mute ? ' on' : ''}" data-mute="${esc(l.id)}" title="Stlmiť stopu" aria-label="Stlmiť ${esc(l.name)}">M</button>
          <button class="st-ms solo${l.solo ? ' on' : ''}" data-solo="${esc(l.id)}" title="Počúvať len túto stopu" aria-label="Sólo ${esc(l.name)}">S</button>
        </div>`;
      }).join('');
      // položky sú ľahké DOM prvky (výber, ťahanie, popis); obsah (náhľady, priebeh zvuku) kreslí plátno stopy
      lanesEl.innerHTML = P.lanes.map(l => `<div class="st-lane ${l.kind}${l.kind === 'audio' && !audible(l) ? ' off' : ''}" style="height:${LANE_H[l.kind]}px" data-lane="${esc(l.id)}"><canvas class="st-lc"></canvas>${itemsOn(l.id).map(itemHtml).join('')}${l.kind === 'video' ? transMarks() : ''}</div>`).join('');
      $$('[data-mute]', heads).forEach(b => b.onclick = () => { const l = lane(b.dataset.mute); l.mute = !l.mute; commit(); renderTimeline(); renderInsp(); syncMedia(true); });
      $$('[data-solo]', heads).forEach(b => b.onclick = () => { const l = lane(b.dataset.solo); l.solo = !l.solo; commit(); renderTimeline(); renderInsp(); syncMedia(true); });
      updHead(false);
      q('#stDur').textContent = tc(duration());
      drawLanes();
    }
    /* značky na strihoch medzi susednými klipmi: klik = prechod */
    function transMarks() {
      return itemsOn('v').filter(B => prevAdj(B)).map(B => {
        const tr = transOf(B), on = !!tr, w = on ? tr.d * pps : 0;
        return `<div class="st-trw${on ? ' on' : ''}${trSel === B.id ? ' sel' : ''}" style="left:${B.start * pps}px;width:${w}px"></div><button type="button" class="st-tr${on ? ' on' : ''}${trSel === B.id ? ' sel' : ''}" data-tb="${B.id}" style="left:${B.start * pps}px" title="${on ? 'Prechod: ' + TRANS[tr.type].l : 'Pridať prechod'}" aria-label="Prechod">${on ? IC.trOn : IC.trAdd}</button>`;
      }).join('');
    }
    function itemHtml(it) {
      const x = it.start * pps, w = Math.max(3, len(it) * pps);
      const s = src.get(it.src), l = lane(it.lane);
      let label = '';
      if (it.kind === 'video') label = (s ? s.name : '') + (ramped(it) ? ' · speed ramp' : sp(it) !== 1 ? ` · ${String(sp(it)).replace('.', ',')}×` : '');
      else if (it.kind === 'audio') label = l && l.music ? (s ? s.name : 'Hudba') : '';
      else label = String(it.text || '').replace(/\n/g, ' ') || 'Text';
      const fades = `${it.fadeIn ? '<i class="fi"></i>' : ''}${it.fadeOut ? '<i class="fo"></i>' : ''}`;
      const kfs = KF.times(it).map(T => `<i class="st-kfd${kfSel && kfSel.id === it.id && Math.abs(kfSel.t - T) < 1 / 120 ? ' on' : ''}" data-kt="${T}" style="left:${T * pps}px" title="Keyframe ${tc(it.start + T)} · ťahaj pre posun, klik = skok"></i>`).join('');
      return `<div class="st-item ${it.kind}${sel.has(it.id) ? ' sel' : ''}${kfs ? ' haskf' : ''}" data-id="${it.id}" style="left:${x}px;width:${w}px">${fades}<span class="st-il">${esc(label)}</span>${kfs}<b class="st-e l"></b><b class="st-e r"></b></div>`;
    }
    /* kreslenie obsahu stôp: len viditeľná časť (šírka okna), takže zoom ani dĺžka nič nestoja */
    let drawQ = 0;
    function requestDraw() { if (!drawQ && !closed) drawQ = requestAnimationFrame(() => { drawQ = 0; drawLanes(); }); }
    const themeC = {};
    let themeKey = '';
    function readTheme() {
      const k = document.documentElement.dataset.scheme || '';
      if (k === themeKey && themeC['--ink']) return; themeKey = k;
      const cs = getComputedStyle(root);
      for (const k of ['--blue', '--lilac', '--ink', '--well']) themeC[k] = cs.getPropertyValue(k).trim();
    }
    function mixHex(a, b, f) { // a*f + b*(1-f), hex #rrggbb
      const p = h => { h = (h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0); };
      const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(v * f + B[i] * (1 - f))).join(',')})`;
    }
    /* plynulé presuny: pred zmenou si zapamätaj polohy, po nej položky 260 ms doplávajú (plátno aj DOM) */
    let glide = null;
    const startsNow = () => new Map(P.items.map(i => [i.id, i.start]));
    function glideFrom(before) {
      const from = new Map();
      for (const it of P.items) { const b = before.get(it.id); if (b != null && Math.abs(b - it.start) > 1e-3) from.set(it.id, b); }
      if (!from.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      glide = { from, t0: performance.now(), D: 280 };
      const step = () => {
        if (!glide || closed) return;
        const p = Math.min(1, (performance.now() - glide.t0) / glide.D);
        for (const [id, b] of glide.from) { const it = P.items.find(i => i.id === id); const n = lanesEl.querySelector(`[data-id="${id}"]`); if (it && n) n.style.left = dispStart(it) * pps + 'px'; }
        drawLanes();
        if (p < 1) requestAnimationFrame(step); else { glide = null; drawLanes(); }
      };
      requestAnimationFrame(step);
    }
    const easeG = p => 1 - Math.pow(1 - p, 3);
    function dispStart(it) {
      if (!glide || !glide.from.has(it.id)) return it.start;
      const p = Math.min(1, (performance.now() - glide.t0) / glide.D);
      const b = glide.from.get(it.id); return b + (it.start - b) * easeG(p);
    }
    function drawLanes() {
      if (closed) return;
      readTheme();
      const x0 = sx, vw = Math.max(1, scroll.clientWidth - 16), dpr = devicePixelRatio || 1;
      const t0v = x0 / pps, t1v = (x0 + vw) / pps;
      for (const laneEl of lanesEl.children) {
        const l = lane(laneEl.dataset.lane); if (!l) continue;
        const cv = laneEl.querySelector('.st-lc'); if (!cv) continue;
        const h = LANE_H[l.kind];
        if (cv.width !== Math.round(vw * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(vw * dpr); cv.height = Math.round(h * dpr); cv.style.width = vw + 'px'; cv.style.height = h + 'px'; }
        cv.style.transform = `translate3d(${x0}px,0,0)`;
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, vw, h);
        const base = l.kind === 'video' ? themeC['--blue'] : l.kind === 'text' ? themeC['--lilac'] : l.c;
        const body = mixHex(base, themeC['--ink'], l.kind === 'audio' ? 0.22 : 0.32);
        for (const it of itemsOn(l.id)) {
          const ds = dispStart(it), e = ds + len(it); if (e < t0v || ds > t1v) continue;
          const X = ds * pps - x0, Wd = Math.max(3, len(it) * pps), y = 2, H2 = h - 4;
          g.save();
          g.beginPath(); g.roundRect(X, y, Wd, H2, 6); g.clip();
          g.fillStyle = body; g.fillRect(X, y, Wd, H2);
          const vx0 = Math.max(X, 0), vx1 = Math.min(X + Wd, vw);
          const s = src.get(it.src);
          if (it.kind === 'video' && s && s.thumbs.length && s.thumbW) {
            const tw = s.thumbW * H2 / 54;
            const k0 = Math.max(0, Math.floor((vx0 - X) / tw)), k1 = Math.ceil((vx1 - X) / tw);
            g.globalAlpha = 0.9;
            for (let k = k0; k < k1; k++) {
              const tt = srcPos(it, k * tw / pps);
              const fi = clamp(Math.floor(tt / (s.duration || 1) * (s.thumbN || s.thumbs.length)), 0, s.thumbs.length - 1);
              const im = s.thumbs[fi] || s.thumbs.find(Boolean);
              if (im) g.drawImage(im, X + k * tw, y, tw, H2);
            }
          } else if (it.kind === 'audio' && s) {
            const lv = s.levels[s.tracks.findIndex(x => x.i === it.ti)];
            g.fillStyle = base; g.globalAlpha = 0.6;
            if (!lv) g.fillRect(vx0, y + H2 / 2 - 1, vx1 - vx0, 2);
            else {
              const per = Math.max(1, Math.ceil(3 / pps * 20 * (ramped(it) ? 4 : sp(it))));
              for (let px = Math.floor(vx0 - X); px < vx1 - X; px += 3) {
                const i = Math.floor(srcPos(it, px / pps) * 20);
                let pk = 0; for (let j = i; j < i + per; j++) pk = Math.max(pk, lv[j] || 0);
                // decibelová mierka (-42 dB … 0 dB) ako v strihových programoch, tiché stopy nezaniknú
                const db = 20 * Math.log10(Math.max(pk / 255, 1e-4)), bh = Math.max(1, clamp((db + 42) / 42, 0, 1) * (H2 - 6));
                g.fillRect(X + px, y + (H2 - bh) / 2, 2, bh);
              }
            }
          }
          g.restore();
        }
      }
    }
    function flashItem(id) { const el = lanesEl.querySelector(`[data-id="${id}"]`); if (el) { el.classList.add('land'); setTimeout(() => el.classList.remove('land'), 600); } }

    /* ---------- ťahanie položiek (presun, orez) ---------- */
    const timeAt = clientX => (clientX - canvas.getBoundingClientRect().left) / pps;
    function snapPoints(exclude) {
      const pts = [0, t];
      for (const it of P.items) if (!exclude.has(it.id)) pts.push(it.start, end(it));
      return pts;
    }
    function snapTo(time, pts, alt) {
      if (!snapOn || alt) return { t: time, hit: null };
      const th = 8 / pps;
      let best = null;
      for (const p of pts) { const d = Math.abs(p - time); if (d < th && (!best || d < best.d)) best = { d, p }; }
      return best ? { t: best.p, hit: best.p } : { t: time, hit: null };
    }
    function showSnap(x) { const l = q('#stSnapLine'); if (x == null) { l.hidden = true; return; } l.hidden = false; l.style.transform = `translateX(${x * pps}px)`; }

    lanesEl.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const trb = e.target.closest('.st-tr');
      if (trb) { e.preventDefault(); selectTrans(trb.dataset.tb); return; }
      const el = e.target.closest('.st-item');
      if (!el) { // klik do prázdna: zruš výber a skoč na čas
        if (!e.shiftKey) { sel.clear(); renderTimeline(); renderInsp(); drawFrame(); }
        scrub(e); return;
      }
      const it = P.items.find(i => i.id === el.dataset.id); if (!it) return;
      e.preventDefault();
      // kosoštvorec keyframu: klik = skok na neho, ťahanie = posun v čase
      const kd = e.target.closest('.st-kfd');
      if (kd) {
        trSel = null;
        const T0 = Number(kd.dataset.kt);
        sel = new Set([it.id]); kfSel = { id: it.id, t: T0 };
        renderTimelineSel(); seek(it.start + T0, false);
        $$('.st-kfd', lanesEl).forEach(x => x.classList.toggle('on', x === kd));
        const x0 = e.clientX; let cur = T0, moved = false;
        const others = KF.times(it).filter(x => Math.abs(x - T0) > 1 / 120);
        const move = ev => {
          let nt = clamp(T0 + (ev.clientX - x0) / pps, 0, len(it));
          if (Math.abs(ev.clientX - x0) < 3 && !moved) return;
          moved = true;
          const sn = snapTo(it.start + nt, [t, ...snapPoints(new Set([it.id]))], ev.altKey); nt = clamp(sn.t - it.start, 0, len(it));
          if (others.some(x => Math.abs(x - nt) < 1 / 60)) return; // nespájaj s iným keyframom
          KF.moveTime(it, cur, nt); cur = nt; kfSel.t = nt; kd.dataset.kt = nt; kd.style.left = nt * pps + 'px';
          seek(it.start + nt, false);
        };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) { commit(); renderTimeline(); } renderInsp(); };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
        return;
      }
      kfSel = null; if (trSel) { trSel = null; $$('.st-tr.sel, .st-trw.sel', lanesEl).forEach(x => x.classList.remove('sel')); }
      if (e.shiftKey || e.ctrlKey) { if (sel.has(it.id)) sel.delete(it.id); else sel.add(it.id); }
      else if (!sel.has(it.id)) sel = new Set([it.id]);
      const edge = e.target.classList.contains('st-e') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
      // čo sa hýbe: vybrané položky + ich skupiny (Alt = len táto položka bez prepojeného zvuku)
      let moving = new Set();
      const base = edge ? [it] : P.items.filter(i => sel.has(i.id));
      for (const b of base) for (const m of (e.altKey ? [b] : group(b))) moving.add(m);
      if (edge && !e.altKey) moving = new Set(group(it).filter(m => Math.abs(m.start - it.start) < 1e-3 && Math.abs(end(m) - end(it)) < 1e-3));
      const orig = new Map([...moving].map(m => [m.id, { start: m.start, in: m.in, out: m.out, end: m.end, kf: m.kf ? JSON.stringify(m.kf) : null }]));
      const x0 = e.clientX, pts = snapPoints(new Set([...moving].map(m => m.id)));
      let changed = false;
      renderTimelineSel();
      // hranice: susedia na tej istej stope, ktorí sa nehýbu
      const bounds = m => {
        const others = itemsOn(m.lane).filter(o => !moving.has(o));
        const o = orig.get(m.id), oEnd = o.start + len({ ...m, ...o });
        let lo = 0, hi = Infinity;
        for (const x of others) { if (end(x) <= o.start + 1e-3) lo = Math.max(lo, end(x)); if (x.start >= oEnd - 1e-3) hi = Math.min(hi, x.start); }
        return { lo, hi, oEnd };
      };
      const bmap = new Map([...moving].map(m => [m.id, bounds(m)]));
      // video sa dá presunúť pred alebo za iný klip: pustíš ho cez neho a ostatné sa odsunú (vloženie)
      const reorder = !edge && [...moving].some(m => m.kind === 'video');
      const vMove = [...moving].find(m => m.kind === 'video');
      let insertAt = null;
      if (reorder) for (const m of moving) { const n = lanesEl.querySelector(`[data-id="${m.id}"]`); if (n) n.classList.add('dragging'); }
      const move = ev => {
        const dt = (ev.clientX - x0) / pps;
        if (!changed && Math.abs(ev.clientX - x0) < 3) return;
        changed = true;
        if (!edge) {
          let d = dt;
          // prichytenie: začiatok alebo koniec položky, na ktorú sa kliklo
          const o = orig.get(it.id), L = len(it);
          const s1 = snapTo(o.start + d, pts, ev.altKey), s2 = snapTo(o.start + d + L, pts, ev.altKey);
          if (s1.hit != null && (s2.hit == null || Math.abs(s1.t - (o.start + d)) <= Math.abs(s2.t - (o.start + d + L)))) { d = s1.t - o.start; showSnap(s1.t); }
          else if (s2.hit != null) { d = s2.t - L - o.start; showSnap(s2.t); } else showSnap(null);
          if (reorder) {
            d = Math.max(d, -Math.min(...[...moving].map(m => orig.get(m.id).start)));
            for (const m of moving) { const om = orig.get(m.id); m.start = om.start + d; if (m.kind === 'text') m.end = om.end + d; }
            // kam sa vloží: klip pod stredom ťahaného videa → pred neho (ľavá polovica) alebo za neho
            const c = vMove.start + len(vMove) / 2;
            const others = itemsOn('v').filter(o => !moving.has(o));
            const hitV = others.find(o => c >= o.start && c < end(o)) || others.find(o => o.start < end(vMove) && end(o) > vMove.start);
            insertAt = hitV ? (c < hitV.start + len(hitV) / 2 ? hitV.start : end(hitV)) : null;
            const dr = q('#stDrop');
            if (insertAt != null) { dr.hidden = false; dr.style.transform = `translateX(${insertAt * pps}px)`; showSnap(null); } else dr.hidden = true;
          } else {
            let dLo = -Infinity, dHi = Infinity;
            for (const m of moving) { const b = bmap.get(m.id), om = orig.get(m.id); dLo = Math.max(dLo, b.lo - om.start); dHi = Math.min(dHi, b.hi - b.oEnd); }
            d = clamp(d, dLo, dHi);
            for (const m of moving) { const om = orig.get(m.id); m.start = om.start + d; if (m.kind === 'text') m.end = om.end + d; }
          }
        } else {
          const ordered = [...moving].sort((x, y) => (x.kind === 'video' ? 0 : 1) - (y.kind === 'video' ? 0 : 1));
          for (const m of ordered) {
            const om = orig.get(m.id), b = bmap.get(m.id), s = src.get(m.src), r = sp(m);
            // zvuk prepojený s videom so speed rampom: prevezme orez videa (rovnaká krivka)
            const rv = rampSrc(m);
            if (m.kind === 'audio' && rv !== m && moving.has(rv) && ramped(m)) { m.in = rv.in; m.out = rv.out; m.start = rv.start; continue; }
            const isRamp = m.kind !== 'text' && ramped(m);
            const tmpOf = outO => ({ ...m, start: om.start, in: om.in, out: outO != null ? outO : om.out, kf: om.kf ? JSON.parse(om.kf) : m.kf });
            if (edge === 'l') {
              let ns = snapTo(om.start + dt, pts, ev.altKey); showSnap(ns.hit);
              let st = ns.t;
              const tmp = isRamp ? tmpOf() : null;
              const minStart = m.kind === 'text' ? b.lo : Math.max(b.lo, om.start - om.in / (isRamp ? spAt(tmp, 0) : r));
              st = clamp(st, minStart, (m.kind === 'text' ? om.end : b.oEnd) - 0.1);
              if (m.kind === 'text') m.start = st;
              else if (isRamp) { const d = st - om.start; m.in = d >= 0 ? srcPos(tmp, d) : Math.max(0, om.in + d * spAt(tmp, 0)); m.start = st; }
              else { m.in = om.in + (st - om.start) * r; m.start = st; }
              // keyframy ostanú na svojom mieste na osi
              if (om.kf) { m.kf = JSON.parse(om.kf); KF.shift(m, om.start - st); }
            } else {
              const oEnd = b.oEnd;
              let ne = snapTo(oEnd + dt, pts, ev.altKey); showSnap(ne.hit);
              let en = ne.t;
              const full = isRamp ? tmpOf(s ? s.duration : om.out) : null;
              const maxEnd = m.kind === 'text' ? b.hi : Math.min(b.hi, om.start + (isRamp ? len(full) : ((s ? s.duration : om.out) - om.in) / r));
              en = clamp(en, om.start + 0.1, maxEnd);
              if (m.kind === 'text') m.end = en;
              else if (isRamp) m.out = srcPos(full, en - om.start);
              else m.out = om.in + (en - om.start) * r;
            }
          }
        }
        // rýchly prekreslenie: len pozície prvkov
        for (const m of moving) { const n = lanesEl.querySelector(`[data-id="${m.id}"]`); if (n) { n.style.left = m.start * pps + 'px'; n.style.width = Math.max(3, len(m) * pps) + 'px'; } }
        requestDraw();
        if (!playing) { syncMedia(true); drawFrame(); }
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up);
        showSnap(null); q('#stDrop').hidden = true;
        if (changed && reorder) {
          const before = new Map(P.items.map(i => [i.id, moving.has(i) ? i.start : i.start]));
          if (insertAt != null) insertMoving(moving, orig, insertAt);
          else resolveOverlaps(moving);
          commit(); renderTimeline(); glideFrom(before); syncMedia(true); drawFrame();
        } else if (changed) { commit(); renderTimeline(); syncMedia(true); drawFrame(); }
        renderInsp();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    /* vloženie presúvaných položiek na čas `at`: pôvodné miesto sa zavrie (ak je prázdne), na novom sa urobí miesto */
    function insertMoving(moving, orig, at) {
      const ms = [...moving];
      for (const m of ms) { const o = orig.get(m.id); const L0 = len(m); m.start = o.start; if (m.kind === 'text') m.end = o.start + L0; }
      const s0 = Math.min(...ms.map(m => m.start)), e0 = Math.max(...ms.map(end)), L = e0 - s0;
      const rest = P.items.filter(i => !moving.has(i));
      const shiftT = (i, d) => { i.start += d; if (i.kind === 'text') i.end += d; };
      // zavri pôvodnú medzeru, keď v nej nič iné nie je
      if (!rest.some(i => i.start < e0 - 1e-3 && end(i) > s0 + 1e-3)) {
        for (const i of rest) if (i.start >= e0 - 1e-3) shiftT(i, -L);
        if (at >= e0 - 1e-3) at -= L;
      }
      // urob miesto: všetko od `at` ďalej sa posunie o dĺžku vkladaných položiek
      for (const i of rest) if (i.start >= at - 1e-3) shiftT(i, L);
      for (const m of ms) shiftT(m, at - s0);
    }
    /* video pustené bez vloženia, no prekrýva sa na iných stopách (napr. zvuk) → posuň nasledujúce */
    function resolveOverlaps(moving) {
      const ms = [...moving];
      for (const m of ms) {
        const clash = itemsOn(m.lane).filter(o => !moving.has(o) && o.start < end(m) - 1e-3 && end(o) > m.start + 1e-3);
        if (!clash.length) continue;
        const push = end(m) - Math.min(...clash.map(o => o.start));
        for (const o of P.items) if (!moving.has(o) && o.start >= Math.min(...clash.map(c => c.start)) - 1e-3) { o.start += push; if (o.kind === 'text') o.end += push; }
      }
    }
    function renderTimelineSel() { $$('.st-item', lanesEl).forEach(n => n.classList.toggle('sel', sel.has(n.dataset.id))); drawFrame(); }
    function scrub(e) {
      const go = ev => seek(clamp(timeAt(ev.clientX), 0, duration()));
      go(e);
      const move = ev => go(ev);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    }
    ruler.addEventListener('pointerdown', e => { if (e.button === 0) scrub(e); });
    q('#stHead').addEventListener('pointerdown', e => { if (e.button === 0) scrub(e); });

    // pretiahnutie klipu z médií na os
    lanesEl.addEventListener('dragover', e => {
      if (![...e.dataTransfer.types].includes('text/x-lat-clip')) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      const d = q('#stDrop'); d.hidden = false; d.style.transform = `translateX(${Math.max(0, timeAt(e.clientX)) * pps}px)`;
    });
    lanesEl.addEventListener('dragleave', e => { if (!lanesEl.contains(e.relatedTarget)) q('#stDrop').hidden = true; });
    lanesEl.addEventListener('drop', e => {
      const p = e.dataTransfer.getData('text/x-lat-clip'); q('#stDrop').hidden = true;
      if (!p) return; e.preventDefault();
      const c = lib().find(x => x.path === p) || { path: p };
      let at = Math.max(0, timeAt(e.clientX));
      const sn = snapTo(at, snapPoints(new Set()), e.altKey); at = sn.t;
      addFromPath(c, at);
    });
    // klip pretiahnutý rovno na náhľad → na koniec
    stage.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-lat-clip')) { e.preventDefault(); frame.classList.add('drop'); } });
    stage.addEventListener('dragleave', () => frame.classList.remove('drop'));
    stage.addEventListener('drop', e => { frame.classList.remove('drop'); const p = e.dataTransfer.getData('text/x-lat-clip'); if (!p) return; e.preventDefault(); const c = lib().find(x => x.path === p) || { path: p }; addFromPath(c, Math.max(0, ...itemsOn('v').map(end))); });

    scroll.addEventListener('wheel', e => {
      if (e.ctrlKey) { e.preventDefault(); const z = Number(q('#stZoom').value) - Math.sign(e.deltaY) * 6; q('#stZoom').value = String(clamp(z, 0, 100)); fillRange(q('#stZoom')); setZoom(clamp(z, 0, 100), e.clientX - scroll.getBoundingClientRect().left); return; }
      // koliesko = posun v čase (Shift = hore/dole medzi stopami)
      if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      setSX(sx + d * (e.deltaMode === 1 ? 30 : 1), true);
    }, { passive: false });
    scroll.addEventListener('scroll', () => { heads.scrollTop = scroll.scrollTop; });
    /* vlastný posun osi do strán: jedno miesto, ktoré posunie obsah, plátna stôp aj posuvník naraz (žiadne zaostávanie) */
    let sx = 0, contentW = 0;
    function setSX(v, drawNow) {
      const vw = scroll.clientWidth;
      sx = clamp(v, 0, Math.max(0, contentW - vw + 20));
      canvas.style.transform = `translate3d(${-sx}px,0,0)`;
      const bar = q('#stHbar'), th = bar.firstElementChild;
      const frac = contentW > 0 ? Math.min(1, vw / contentW) : 1;
      bar.classList.toggle('hide', frac >= 0.999);
      const bw = bar.clientWidth;
      th.style.width = Math.max(30, frac * bw) + 'px';
      th.style.transform = `translate3d(${contentW > vw ? sx / (contentW - vw + 20) * (bw - Math.max(30, frac * bw)) : 0}px,0,0)`;
      if (drawNow) drawLanes(); else requestDraw();
    }
    q('#stHbar').addEventListener('pointerdown', e => {
      const bar = e.currentTarget, th = bar.firstElementChild, r = bar.getBoundingClientRect();
      const tw = th.getBoundingClientRect().width, range = r.width - tw, maxSx = Math.max(1, contentW - scroll.clientWidth + 20);
      let grab = e.target === th ? e.clientX - th.getBoundingClientRect().left : tw / 2;
      const go = ev => setSX(clamp((ev.clientX - r.left - grab) / Math.max(1, range), 0, 1) * maxSx, true);
      go(e); bar.setPointerCapture(e.pointerId); th.classList.add('on');
      const up = () => { bar.removeEventListener('pointermove', go); bar.removeEventListener('pointerup', up); th.classList.remove('on'); };
      bar.addEventListener('pointermove', go); bar.addEventListener('pointerup', up);
    });
    q('#stZoom').oninput = e => setZoom(Number(e.target.value));
    fillRange(q('#stZoom'));

    /* ---------- úpravy ---------- */
    function splitAt(time) {
      let targets = P.items.filter(i => sel.has(i.id) && time > i.start + 0.05 && time < end(i) - 0.05);
      // vybrané položky nie sú pod hlavou → rozdeľ to, čo pod ňou je
      if (!targets.length) targets = P.items.filter(i => i.kind !== 'text' && time > i.start + 0.05 && time < end(i) - 0.05);
      else { const gs = new Set(); for (const x of targets) for (const m of group(x)) gs.add(m); targets = [...gs]; }
      targets = targets.filter(i => time > i.start + 0.05 && time < end(i) - 0.05);
      if (!targets.length) { hint('Na prehrávacej hlave nie je čo rozdeliť'); return; }
      const newG = new Map(), added = [];
      for (const it of targets) {
        const b = { ...it, id: uid() };
        if (KF.anyKf(it)) { const [Lk, Rk] = KF.split(it, time - it.start); it.kf = Lk; b.kf = Rk; }
        if (it.tf) b.tf = { ...it.tf };
        delete b.tin; // pravá časť nededí prechod (bol by medzi polovicami)
        if (it.kind === 'text') { b.start = time; it.end = time; }
        else { const cut = srcPos(it, time - it.start); it.out = cut; b.in = cut; b.start = time; it.fadeOut = false; b.fadeIn = false; }
        if (it.g) { if (!newG.has(it.g)) newG.set(it.g, uid()); b.g = newG.get(it.g); }
        P.items.push(b); added.push(b);
      }
      sel = new Set(added.filter(x => x.kind !== 'audio' || !added.some(y => y.g === x.g && y.kind === 'video')).map(x => x.id));
      commit(); renderTimeline(); renderInsp();
    }
    function deleteSel(ripple) {
      if (!sel.size) return;
      const before0 = startsNow();
      const del = new Set();
      for (const it of P.items.filter(i => sel.has(i.id))) for (const m of (it.kind === 'video' ? group(it) : [it])) del.add(m);
      const span = [...del].reduce((a, m) => ({ s: Math.min(a.s, m.start), e: Math.max(a.e, end(m)) }), { s: Infinity, e: -Infinity });
      P.items = P.items.filter(i => !del.has(i));
      if (ripple && isFinite(span.s)) {
        // zavri medzeru: posuň všetko za vymazaným o jeho dĺžku, ak tam nič iné nie je
        const gap = span.e - span.s;
        const blocked = P.items.some(i => i.start < span.e - 1e-3 && end(i) > span.s + 1e-3);
        if (!blocked) for (const i of P.items) if (i.start >= span.e - 1e-3) { i.start -= gap; if (i.kind === 'text') i.end -= gap; }
      }
      sel.clear();
      dropUnusedLanes();
      commit(); renderAll(); glideFrom(before0);
    }
    function dropUnusedLanes() { P.lanes = P.lanes.filter(l => l.kind !== 'audio' || P.items.some(i => i.lane === l.id)); }
    function addText(style, y) {
      style = typeof style === 'string' && STYLES[style] ? style : 'gamer';
      const it = { id: uid(), lane: 't', kind: 'text', start: t, end: t + 3, text: 'Tvoj text', style, color: STYLES[style].color, size: 0.08, x: 0.5, y: y != null ? y : (P.fmt === '9:16' ? 0.62 : 0.8), animIn: 'pop', animOut: 'fade' };
      // nenechaj texty prekrývať sa na jednej stope: posuň za posledný, ktorý tam práve je
      const clash = itemsOn('t').find(o => o.start < it.end && o.end > it.start);
      if (clash) { it.start = clash.end; it.end = it.start + 3; }
      P.items.push(it); sel = new Set([it.id]); tab = 'text';
      commit(); renderTimeline(); renderInsp(); txtDrawn = true; drawFrame(); flashItem(it.id);
      setTimeout(() => { const ta = q('#stTxtIn'); if (ta) { ta.focus(); ta.select(); } }, 60);
    }
    async function addMusic() {
      const files = await api.action('pickFiles', { kind: 'audio' }).catch(e => { toast('error', 'Výber súboru zlyhal', e.message); return []; });
      for (const f of files) {
        let s; try { s = await loadSource({ path: f }, true); } catch (e) { toast('error', 'Hudbu sa nepodarilo otvoriť', e.message); continue; }
        const l = audioLaneFor('Hudba', true);
        const occupied = itemsOn(l.id);
        let at = t; const hit = occupied.find(o => at >= o.start && at < end(o)); if (hit) at = end(hit);
        const nextS = Math.min(...occupied.filter(o => o.start >= at).map(o => o.start), Infinity);
        const D = Math.min(s.duration || 30, nextS - at, Math.max(5, duration() - at) || s.duration || 30);
        const it = { id: uid(), lane: l.id, kind: 'audio', src: s.path, ti: s.tracks[0] ? s.tracks[0].i : 0, start: at, in: 0, out: Math.max(0.5, D), speed: 1, vol: 1, fadeIn: true, fadeOut: true };
        P.items.push(it); sel = new Set([it.id]); tab = 'zvuk';
      }
      if (files.length) { commit(); renderAll(); }
    }
    function setSpeed(it, r) {
      if (it.kf && it.kf.speed) delete it.kf.speed; // konštantná rýchlosť = bez speed rampu
      for (const m of group(it)) {
        const oldEnd = end(m), oldR = sp(m); m.speed = r;
        if (m.kf) KF.scaleTimes(m, oldR / r);
        // ak by sa predĺžený úsek prekryl s ďalším, posuň nasledujúce položky (všetky stopy)
        const grow = end(m) - oldEnd;
        if (grow > 0 && m.kind === 'video') {
          const next = itemsOn('v').find(o => o !== m && o.start >= oldEnd - 1e-3);
          if (next && next.start < end(m)) for (const o of P.items) if (o.start >= oldEnd - 1e-3 && !group(it).includes(o)) { o.start += grow; if (o.kind === 'text') o.end += grow; }
        }
      }
    }
    let hintT = 0;
    function hint(msg) { const h = q('#stHint'); h.textContent = msg; h.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => h.classList.remove('on'), 2200); }

    /* duplikát položky (aj s prepojeným zvukom) hneď za ňou; čo je za ňou, sa odsunie */
    function duplicateSel() {
      const base = P.items.filter(i => sel.has(i.id)); if (!base.length) return;
      const before0 = startsNow();
      const set = new Set(); for (const b of base) for (const m of (b.kind === 'video' ? group(b) : [b])) set.add(m);
      const items = [...set];
      const s0 = Math.min(...items.map(i => i.start)), e0 = Math.max(...items.map(end)), L = e0 - s0;
      const lanesHit = new Set(items.map(i => i.lane));
      const clash = P.items.some(o => !set.has(o) && lanesHit.has(o.lane) && o.start < e0 + L - 1e-3 && end(o) > e0 + 1e-3);
      if (clash) for (const o of P.items) if (o.start >= e0 - 1e-3) { o.start += L; if (o.kind === 'text') o.end += L; }
      const gmap = new Map(), added = [];
      for (const it of items) {
        const c = { ...it, id: uid(), start: it.start + L }; delete c.tin;
        if (it.kind === 'text') c.end = it.end + L;
        if (it.g) { if (!gmap.has(it.g)) gmap.set(it.g, uid()); c.g = gmap.get(it.g); }
        P.items.push(c); added.push(c);
      }
      sel = new Set(added.filter(x => x.kind !== 'audio' || !added.some(y => y.g === x.g && y.kind === 'video')).map(x => x.id));
      commit(); renderTimeline(); glideFrom(before0); renderInsp();
      for (const a of added) flashItem(a.id);
    }
    /* zvuk, ktorý patrí k videu (rovnaký klip, rovnaký čas), ale bol odpojený */
    /* zvuk, ktorý patrí k videu (ten istý klip, prekrýva sa alebo je blízko), ale je odpojený — nemusí byť zarovnaný */
    const orphanAudio = v => P.items.filter(a => a.kind === 'audio' && a.src === v.src && a.g !== v.g && group(a).length === 1 && a.start < end(v) + 3 && end(a) > v.start - 3);
    function relink(v) { if (!v.g) v.g = uid(); for (const a of orphanAudio(v)) a.g = v.g; }
    /* k akému videu pripojiť samostatný zvuk: najviac prekrývajúce sa video, prednostne z toho istého klipu */
    function videoFor(a) {
      const vs = itemsOn('v');
      const ov = v => Math.max(0, Math.min(end(v), end(a)) - Math.max(v.start, a.start));
      const score = v => ov(v) + (v.src === a.src ? 1000 : 0) - Math.abs(v.start - a.start) * 0.01;
      return vs.sort((x, y) => score(y) - score(x))[0] || null;
    }
    function linkItems(items) {
      const v = items.find(i => i.kind === 'video'); if (!v) return false;
      if (!v.g) v.g = uid();
      for (const i of items) if (i.kind === 'audio') i.g = v.g;
      return true;
    }
    lanesEl.addEventListener('contextmenu', e => {
      const el = e.target.closest('.st-item'); if (!el) return;
      e.preventDefault();
      const it = P.items.find(i => i.id === el.dataset.id); if (!it) return;
      const kd = e.target.closest('.st-kfd');
      if (kd) {
        const T = Number(kd.dataset.kt);
        sel = new Set([it.id]); kfSel = { id: it.id, t: T };
        renderTimelineSel(); $$('.st-kfd', lanesEl).forEach(x => x.classList.toggle('on', x === kd)); seek(it.start + T, false); renderInsp();
        const k0 = Object.values(it.kf || {}).map(tr => tr.find(x => Math.abs(x.t - T) < 1 / 120)).find(Boolean) || {};
        const last = KF.times(it).every(x => x <= T + 1 / 120);
        const at = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }), contains: () => false, classList: { contains: () => false, add() { }, remove() { } } };
        menu(at, [{ label: 'Odstrániť keyframe', v: 'del', sub: 'Delete' }, ...(last ? [] : [{ sep: true }, { head: 'Krivka do ďalšieho' }, ...Object.entries(KF.EASES).map(([key, x]) => ({ label: x.l, v: 'ease:' + key, checked: (k0.ease || 'linear') === key }))])], pick => {
          if (pick.v === 'del') deleteKeyAt(it, T);
          else if (pick.v.startsWith('ease:')) { KF.setEase(it, T, pick.v.slice(5)); commit(); renderInsp(); syncMedia(true); drawFrame(); }
        });
        return;
      }
      if (!sel.has(it.id)) { sel = new Set([it.id]); renderTimelineSel(); renderInsp(); }
      const under = t > it.start + 0.05 && t < end(it) - 0.05;
      const l = lane(it.lane);
      const items = [];
      if (it.kind === 'text') items.push({ label: 'Upraviť text', v: 'edit' });
      items.push({ label: 'Rozdeliť na prehrávacej hlave', v: 'split', sub: 'S', disabled: !under });
      items.push({ label: 'Duplikovať', v: 'dup', sub: 'Ctrl+D' });
      if (it.kind === 'video') {
        if (group(it).length > 1) items.push({ label: 'Odpojiť zvuk od videa', v: 'unlink' });
        else if (orphanAudio(it).length) items.push({ label: 'Pripojiť zvuk späť k videu', v: 'link' });
        items.push({ sep: true }, { head: 'Rýchlosť' }, ...SPEEDS.map(r => ({ label: String(r).replace('.', ',') + '×', v: 'spd:' + r, checked: sp(it) === r })));
      }
      if (it.kind === 'audio' && group(it).length > 1) items.push({ label: 'Odpojiť od videa', v: 'unlinkA' });
      if (it.kind === 'audio' && group(it).length === 1 && !lane(it.lane).music && videoFor(it)) items.push({ label: 'Pripojiť k videu', v: 'linkA' });
      const pickedNow = P.items.filter(i => sel.has(i.id));
      if (pickedNow.length > 1 && pickedNow.some(i => i.kind === 'video') && pickedNow.some(i => i.kind === 'audio')) items.unshift({ label: 'Prepojiť vybrané (zvuk sa bude hýbať s videom)', v: 'linkSel' }, { sep: true });
      if (it.kind !== 'text') items.push({ sep: true }, { label: it.kind === 'audio' ? 'Zosilnenie na začiatku' : 'Roztmievanie na začiatku', v: 'fadeIn', checked: !!it.fadeIn }, { label: it.kind === 'audio' ? 'Stíšenie na konci' : 'Stmievanie na konci', v: 'fadeOut', checked: !!it.fadeOut });
      if (it.kind === 'audio' && l) items.push({ label: `${l.mute ? 'Zapnúť' : 'Stlmiť'} stopu ${l.name}`, v: 'mute' });
      items.push({ sep: true }, { label: 'Odstrániť', v: 'del', sub: 'Delete' }, { label: 'Odstrániť a zavrieť medzeru', v: 'ripple', sub: 'Shift+Del' });
      const at = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }), contains: () => false, classList: { contains: () => false, add() { }, remove() { } } };
      menu(at, items, pick => {
        const v = pick.v;
        if (v === 'edit') { tab = 'text'; renderInsp(); setTimeout(() => { const ta = q('#stTxtIn'); if (ta) { ta.focus(); ta.select(); } }, 30); }
        else if (v === 'split') splitAt(t);
        else if (v === 'dup') duplicateSel();
        else if (v === 'unlink' || v === 'unlinkA') { const gid = it.g; for (const m of P.items.filter(x => x.g === gid)) m.g = uid(); commit(); renderInsp(); hint('Zvuk je odpojený, môžeš ho strihať a posúvať zvlášť'); }
        else if (v === 'link') { relink(it); commit(); renderInsp(); hint('Zvuk je zase spojený s videom'); }
        else if (v === 'linkA') { const vv = videoFor(it); if (vv) { if (!vv.g) vv.g = uid(); it.g = vv.g; commit(); renderInsp(); hint('Zvuk je spojený s videom „' + ((src.get(vv.src) || {}).name || 'klip') + '“'); } }
        else if (v === 'linkSel') { if (linkItems(P.items.filter(i => sel.has(i.id)))) { commit(); renderInsp(); hint('Prepojené, hýbu sa spolu'); } }
        else if (v.startsWith('spd:')) { setSpeed(it, Number(v.slice(4))); commit(); renderAll(); }
        else if (v === 'fadeIn' || v === 'fadeOut') { const nv = !it[v]; for (const m of (it.kind === 'video' ? group(it) : [it])) m[v] = nv; commit(); renderTimeline(); renderInsp(); drawFrame(); }
        else if (v === 'mute') { l.mute = !l.mute; commit(); renderTimeline(); renderInsp(); syncMedia(true); }
        else if (v === 'del') deleteSel(false);
        else if (v === 'ripple') deleteSel(true);
      });
    });

    function deleteKeyAt(it, T) {
      for (const p of KF.propsOf(it)) KF.removeKey(it, p.k, T);
      if (kfSel && kfSel.id === it.id) kfSel = null;
      commit(); renderTimeline(); renderInsp(); syncMedia(true); txtDrawn = true; drawFrame();
      hint('Keyframe odstránený');
    }
    function selectTrans(bid) {
      const B = P.items.find(i => i.id === bid); if (!B) return;
      trSel = bid; sel = new Set(); kfSel = null;
      renderTimeline(); renderInsp();
      const tr = transOf(B); seek(tr ? tr.w0 - 0.3 : B.start - 0.5, false);
    }
    function setTrans(B, type, d) {
      if (!type) { delete B.tin; }
      else B.tin = { type, d: d || (B.tin && B.tin.type ? B.tin.d : TRANS[type].d) || TRANS[type].d };
      commit(); renderTimeline(); renderInsp(); syncMedia(true); drawFrame();
    }
    /* prechod na strih najbližší k hlave (alebo na začiatok vybraného klipu) */
    function cutNear() {
      const pk = P.items.find(i => sel.has(i.id) && i.kind === 'video');
      if (pk && prevAdj(pk)) return pk;
      const cands = itemsOn('v').filter(B => prevAdj(B));
      return cands.sort((x, y) => Math.abs(x.start - t) - Math.abs(y.start - t))[0] || null;
    }
    function previewTrans(B) {
      const tr = transOf(B); if (!tr) return;
      seek(Math.max(0, tr.w0 - 0.6)); play();
      setTimeout(() => { if (playing) pause(); }, (tr.d + 1.2) * 1000);
    }
    function transPanel() {
      const B = P.items.find(i => i.id === trSel); if (!B) return '<p class="st-note">Prechod nie je k dispozícii.</p>';
      const tr = transOf(B), cur = tr ? tr.type : null;
      const d = tr ? tr.d : 0.5, maxD = Math.min(2, len(B) * 0.9, prevAdj(B) ? len(prevAdj(B)) * 0.9 : 2);
      return `<div class="st-ih"><b>Prechod</b><span>Strih v ${tc(B.start)} · ${esc((src.get(prevAdj(B).src) || {}).name || 'klip')} → ${esc((src.get(B.src) || {}).name || 'klip')}</span></div>
        <div class="st-trg">${Object.entries(TRANS).map(([k, x]) => `<button type="button" class="st-trc${cur === k ? ' on' : ''}" data-tt="${k}"><i class="st-trp tp-${k}"><b></b><em></em></i><span>${x.l}</span></button>`).join('')}</div>
        ${tr ? `<div class="st-f"><div class="st-row"><label class="lbl" for="stTd">Dĺžka</label><span class="st-tc">${d.toFixed(2).replace('.', ',')} s</span></div><input type="range" id="stTd" min="0.1" max="${maxD.toFixed(2)}" step="0.05" value="${d}"></div>
        <div class="st-row2"><button type="button" class="btn" data-ta="play">${I.play}<span>Prehrať</span></button><button type="button" class="btn danger" data-ta="del">Odstrániť</button></div>
        ${TRANS[cur].ov ? `<p class="st-note sm">Pri prelínaní a posunoch klipy pokračujú za strihom. Keď za strihom nie je záber, podrží sa posledná snímka.</p>` : ''}`
        : `<p class="st-note">Vyber druh prechodu. Pri prejdení myšou ukážka ukáže, ako vyzerá.</p>`}`;
    }
    function bindTrans(el) {
      const B = P.items.find(i => i.id === trSel); if (!B) return;
      $$('[data-tt]', el).forEach(b => b.onclick = () => { setTrans(B, b.dataset.tt); previewTrans(B); });
      const r = el.querySelector('#stTd');
      if (r) {
        r.oninput = () => { B.tin.d = Number(r.value); const v = el.querySelector('.st-tc'); if (v) v.textContent = Number(r.value).toFixed(2).replace('.', ',') + ' s'; requestDraw(); if (!playing) syncMedia(true); };
        r.onchange = () => { commit(); renderTimeline(); };
      }
      const pl = el.querySelector('[data-ta=play]'); if (pl) pl.onclick = () => previewTrans(B);
      const dl = el.querySelector('[data-ta=del]'); if (dl) dl.onclick = () => { setTrans(B, null); hint('Prechod odstránený'); };
    }
    /* ---------- speed ramp: predvoľby ---------- */
    const RAMPS = [
      { id: 'none', l: 'Bez rampu' },
      { id: 'slowHead', l: 'Spomalenie na hlave' },
      { id: 'hero', l: 'Hrdina' },
      { id: 'montage', l: 'Montáž' },
      { id: 'up', l: 'Zrýchlenie' },
      { id: 'down', l: 'Spomalenie' }
    ];
    function rampId(v) { return v.rampPreset && ramped(v) ? v.rampPreset : 'none'; }
    /* zmena dĺžky klipu (rýchlosť): nasledujúce položky, ktoré naň nadväzovali alebo by sa prekryli, sa posunú */
    function afterLenChange(it, oldEnd) {
      const nd = end(it), delta = nd - oldEnd; if (Math.abs(delta) < 1e-3) return;
      const grp = new Set(group(it));
      const adj = P.items.some(o => !grp.has(o) && o.kind === 'video' && Math.abs(o.start - oldEnd) < 0.04);
      if (delta > 0 || adj) for (const o of P.items) if (!grp.has(o) && o.start >= oldEnd - 0.04) { o.start += delta; if (o.kind === 'text') o.end += delta; }
    }
    function applyRamp(v, id) {
      const oldEnd = end(v), before0 = startsNow();
      if (v.kf && v.kf.speed) delete v.kf.speed;
      const s0 = sp(v), L = len(v), T = clamp(t - v.start, 0, L);
      const put = pts => { for (const [tt, val, e] of pts) KF.setKey(v, 'speed', clamp(tt, 0, L), clamp(val, 0.1, 4), e || 'inout'); };
      if (id === 'slowHead') put([[T - 0.35, s0], [T, s0 * 0.25, 'hold'], [T + 0.9, s0 * 0.25], [T + 1.25, s0]].filter(x => x[0] >= 0 && x[0] <= L));
      if (id === 'hero') put([[0, s0], [L * 0.35, s0], [L * 0.45, s0 * 0.3, 'hold'], [L * 0.6, s0 * 0.3], [L * 0.7, s0]]);
      if (id === 'montage') put([[0, s0 * 2], [L * 0.38, s0 * 2], [L * 0.46, s0 * 0.4], [L * 0.58, s0 * 0.4], [L * 0.66, s0 * 2]]);
      if (id === 'up') put([[0, s0 * 0.5], [L, s0 * 2]]);
      if (id === 'down') put([[0, s0 * 2], [L, s0 * 0.5]]);
      v.rampPreset = id === 'none' ? null : id;
      afterLenChange(v, oldEnd);
      commit(); renderTimeline(); glideFrom(before0); renderInsp(); syncMedia(true); drawFrame();
      if (id !== 'none') { hint(`${RAMPS.find(r => r.id === id).l}: rýchlosť ako keyframy, doladíš v sekcii Pohyb`); seek(Math.max(v.start, id === 'slowHead' ? v.start + T - 0.6 : v.start)); play(); setTimeout(() => { if (playing) pause(); }, Math.min(4000, (id === 'slowHead' ? 3 : len(v)) * 1000)); }
    }
    /* ---------- keyframy v inšpektore ---------- */
    const itT = it => clamp(t - it.start, 0, len(it));
    // čas keyframu, s ktorým sa pracuje: vybraný na osi, inak ten pod prehrávacou hlavou
    function curKeyT(it) {
      if (kfSel && kfSel.id === it.id) return kfSel.t;
      const T = itT(it); const k = KF.times(it).find(x => Math.abs(x - T) < 1 / 60); return k != null ? k : null;
    }
    function motionHtml(it, keys) {
      const T = itT(it), props = KF.propsOf(it).filter(p => !keys || keys.includes(p.k));
      const times = KF.times(it), outside = t < it.start || t > end(it);
      const kt = curKeyT(it);
      const rows = props.map(p => {
        const v = KF.at(it, p.k, T), on = !!KF.keyAt(it, p.k, T), anim = KF.animated(it, p.k);
        const pct = (v - p.min) / (p.max - p.min) * 100;
        return `<div class="st-kr${anim ? ' anim' : ''}" data-row="${p.k}">
          <div class="st-row"><span class="lbl">${p.l}</span><span class="st-tc" data-val="${p.k}">${p.fmt(v)}</span>
            <button type="button" class="st-kb${on ? ' on' : ''}" data-kb="${p.k}" title="${on ? 'Odstrániť keyframe' : 'Pridať keyframe na prehrávaciu hlavu'}" aria-label="Keyframe ${p.l}">${on ? IC.kf : IC.kfo}</button></div>
          <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" data-kp="${p.k}" style="--p:${pct}%" aria-label="${p.l}"></div>`;
      }).join('');
      const idx = kt == null ? -1 : times.findIndex(x => Math.abs(x - kt) < 1 / 120);
      const prev = times.filter(x => x < T - 1 / 120).pop(), next = times.find(x => x > T + 1 / 120);
      let curve = '';
      if (idx >= 0 && idx < times.length - 1) {
        const k0 = Object.values(it.kf || {}).map(tr => tr.find(x => Math.abs(x.t - kt) < 1 / 120)).find(Boolean) || {};
        curve = curveHtml(k0);
      } else if (times.length > 1) curve = `<p class="st-note sm">Krivku nastavíš na keyframe, za ktorým nasleduje ďalší. Klikni na kosoštvorec na osi.</p>`;
      return `<div class="st-mo">
        <div class="st-row st-moh"><b>Pohyb</b>
          <span class="st-kn">
            <button type="button" class="st-ico sm" data-kn="prev" ${prev == null ? 'disabled' : ''} title="Predošlý keyframe" aria-label="Predošlý keyframe">${IC.kprev}</button>
            <span class="st-kc">${times.length ? `${times.length} ${times.length === 1 ? 'keyframe' : times.length < 5 ? 'keyframy' : 'keyframov'}` : 'bez animácie'}</span>
            <button type="button" class="st-ico sm" data-kn="next" ${next == null ? 'disabled' : ''} title="Ďalší keyframe" aria-label="Ďalší keyframe">${IC.knext}</button>
          </span></div>
        ${outside ? `<p class="st-note sm">Prehrávacia hlava je mimo tejto položky, keyframe sa pridá na jej okraj.</p>` : ''}
        ${kt != null ? `<div class="st-ksel"><span>${IC.kf}Keyframe v ${tc(it.start + kt)}</span><button type="button" class="btn small danger" data-kn="delk">Odstrániť</button></div>` : ''}
        ${rows}
        ${curve}
        ${times.length ? `<p class="st-note sm">Kosoštvorec na osi: klik = vybrať, ťahanie = posun, Delete = zmazať, pravý klik = krivka.</p><button type="button" class="btn ghost small st-kclear" data-kn="clear">Zrušiť celú animáciu</button>` : `<p class="st-note sm">1. Klikni na ◇ pri hodnote (vznikne keyframe).<br>2. Posuň hlavu inam a zmeň hodnotu, druhý keyframe sa pridá sám.<br>Medzi nimi vznikne pohyb.</p>`}
      </div>`;
    }
    function curveHtml(k) {
      const bz = KF.curveOf(k), hold = k.ease === 'hold';
      const X = x => 14 + x * 172, Y = y => 104 - (y + 0.0) * 84; // y 0 dole, 1 hore (prekmit mimo)
      let path = '';
      if (hold) path = `M${X(0)},${Y(0)} H${X(1)} V${Y(1)}`;
      else { const f = KF.bezier(...bz); for (let i = 0; i <= 48; i++) { const x = i / 48; path += `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(f(x)).toFixed(1)}`; } }
      const tf = hold ? 'steps(1, end)' : `cubic-bezier(${bz.map(v => +v.toFixed(3)).join(',')})`;
      return `<div class="st-cv">
        <div class="st-row"><span class="lbl">Krivka do ďalšieho keyframu</span></div>
        <div class="st-cchips">${Object.entries(KF.EASES).map(([key, e]) => `<button type="button" class="st-cchip${(k.ease || 'linear') === key ? ' on' : ''}" data-ease="${key}">${e.l}</button>`).join('')}${k.ease === 'custom' ? '<button type="button" class="st-cchip on" disabled>Vlastná</button>' : ''}</div>
        <svg class="st-csvg" viewBox="0 0 200 120" aria-label="Krivka">
          <path class="g" d="M${X(0)},${Y(0)} H${X(1)} M${X(0)},${Y(1)} H${X(1)}"/>
          ${hold ? '' : `<path class="h" d="M${X(0)},${Y(0)} L${X(bz[0])},${Y(bz[1])} M${X(1)},${Y(1)} L${X(bz[2])},${Y(bz[3])}"/>`}
          <path class="c" id="stCPath" d="${path}"/>
          ${hold ? '' : `<circle class="p" data-h="1" cx="${X(bz[0])}" cy="${Y(bz[1])}" r="6"/><circle class="p" data-h="2" cx="${X(bz[2])}" cy="${Y(bz[3])}" r="6"/>`}
        </svg>
        <div class="st-cprev" title="Náhľad pohybu"><i style="animation-timing-function:${tf}"></i></div>
      </div>`;
    }
    /* väzby sekcie Pohyb; it = položka */
    function bindMotion(el, it) {
      const T = () => itT(it);
      $$('[data-kp]', el).forEach(r => {
        const k = r.dataset.kp, p = KF.propsOf(it).find(x => x.k === k);
        r.oninput = () => {
          if (k === 'speed' && r._oldEnd == null) r._oldEnd = end(it);
          const v = Number(r.value); KF.set(it, k, T(), v);
          r.style.setProperty('--p', (v - p.min) / (p.max - p.min) * 100 + '%');
          const val = el.querySelector(`[data-val="${k}"]`); if (val) val.textContent = p.fmt(v);
          if (!playing) { syncMedia(false); txtDrawn = true; drawFrame(); }
        };
        r.onchange = () => { if (k === 'speed' && r._oldEnd != null) { afterLenChange(it, r._oldEnd); r._oldEnd = null; it.rampPreset = null; } commit(); renderTimeline(); renderInsp(); };
        r.ondblclick = () => { KF.set(it, k, T(), p.def != null && !(it.kind === 'text' && (k === 'x' || k === 'y')) ? p.def : KF.at(it, k, T())); commit(); renderInsp(); syncMedia(true); txtDrawn = true; drawFrame(); };
      });
      $$('[data-kb]', el).forEach(b => b.onclick = () => {
        const k = b.dataset.kb, Tn = T();
        const oe = end(it);
        if (KF.keyAt(it, k, Tn)) KF.removeKey(it, k, Tn); else { KF.setKey(it, k, Tn, KF.at(it, k, Tn)); kfSel = { id: it.id, t: Tn }; }
        if (k === 'speed') afterLenChange(it, oe);
        commit(); renderTimeline(); renderInsp(); syncMedia(true); txtDrawn = true; drawFrame();
      });
      $$('[data-kn]', el).forEach(b => b.onclick = () => {
        const times = KF.times(it), Tn = T();
        if (b.dataset.kn === 'prev') { const x = times.filter(v => v < Tn - 1 / 120).pop(); if (x != null) { kfSel = { id: it.id, t: x }; seek(it.start + x, false); } }
        if (b.dataset.kn === 'next') { const x = times.find(v => v > Tn + 1 / 120); if (x != null) { kfSel = { id: it.id, t: x }; seek(it.start + x, false); } }
        if (b.dataset.kn === 'delk') { const kt2 = curKeyT(it); if (kt2 != null) deleteKeyAt(it, kt2); return; }
        if (b.dataset.kn === 'clear') { for (const k of Object.keys(it.kf || {})) { const v = KF.at(it, k, Tn); delete it.kf[k]; KF.setStatic(it, k, v); } kfSel = null; commit(); }
        renderTimeline(); renderInsp(); syncMedia(true); txtDrawn = true; drawFrame();
      });
      const kt = curKeyT(it);
      $$('[data-ease]', el).forEach(b => b.onclick = () => { if (kt == null) return; KF.setEase(it, kt, b.dataset.ease); commit(); renderInsp(); syncMedia(true); drawFrame(); });
      const svg = el.querySelector('.st-csvg');
      if (svg && kt != null) {
        $$('circle[data-h]', svg).forEach(c => c.addEventListener('pointerdown', e => {
          e.preventDefault(); c.setPointerCapture(e.pointerId);
          const k0 = Object.values(it.kf || {}).map(tr => tr.find(x => Math.abs(x.t - kt) < 1 / 120)).find(Boolean); if (!k0) return;
          const bz = KF.curveOf(k0).slice(), h = c.dataset.h === '1' ? 0 : 2;
          const move = ev => {
            const r = svg.getBoundingClientRect(), sx = 200 / r.width, sy = 120 / r.height;
            const x = clamp(((ev.clientX - r.left) * sx - 14) / 172, 0, 1), y = clamp((104 - (ev.clientY - r.top) * sy) / 84, -0.6, 1.6);
            bz[h] = +x.toFixed(3); bz[h + 1] = +y.toFixed(3);
            KF.setEase(it, kt, 'custom', bz);
            c.setAttribute('cx', 14 + x * 172); c.setAttribute('cy', 104 - y * 84);
            const f = KF.bezier(...bz); let d = ''; for (let i = 0; i <= 48; i++) { const xx = i / 48; d += `${i ? 'L' : 'M'}${(14 + xx * 172).toFixed(1)},${(104 - f(xx) * 84).toFixed(1)}`; }
            svg.querySelector('#stCPath').setAttribute('d', d);
            svg.querySelector('path.h').setAttribute('d', `M14,104 L${14 + bz[0] * 172},${104 - bz[1] * 84} M186,20 L${14 + bz[2] * 172},${104 - bz[3] * 84}`);
            const pv = el.querySelector('.st-cprev i'); if (pv) pv.style.animationTimingFunction = `cubic-bezier(${bz.join(',')})`;
            if (!playing) { syncMedia(false); drawFrame(); }
          };
          const up = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); commit(); renderInsp(); };
          c.addEventListener('pointermove', move); c.addEventListener('pointerup', up);
        }));
      }
    }
    /* počas ťahania v náhľade aktualizuj hodnoty v sekcii Pohyb bez prekreslenia */
    function liveMotion() {
      const it = P.items.find(i => sel.has(i.id)); if (!it) return;
      const el = q('#stInsp'), T = itT(it);
      for (const p of KF.propsOf(it)) {
        const v = KF.at(it, p.k, T), r = el.querySelector(`[data-kp="${p.k}"]`), val = el.querySelector(`[data-val="${p.k}"]`);
        if (r) { r.value = v; r.style.setProperty('--p', (v - p.min) / (p.max - p.min) * 100 + '%'); }
        if (val) val.textContent = p.fmt(v);
      }
    }

    /* ---------- inšpektor ---------- */
    let inspKey = '';
    function renderInsp() {
      if (ltab === 'fx') renderFx();
      const el = q('#stInsp');
      const picked = P.items.filter(i => sel.has(i.id));
      const v = picked.find(i => i.kind === 'video') || null;
      const a = picked.find(i => i.kind === 'audio') || null;
      const tx = picked.find(i => i.kind === 'text') || null;
      if (tx && tab === 'klip' && !v) tab = 'text';
      const tabs = [['klip', 'Klip'], ['zvuk', 'Zvuk'], ['text', 'Text']];
      let body = '';
      if (trSel) {
        const key = 'tr|' + trSel, fresh = key !== inspKey; inspKey = key;
        el.innerHTML = `<div class="st-ib${fresh ? ' anim' : ''}">${transPanel()}</div>`;
        fillAll(el); bindTrans(el); return;
      }
      if (tab === 'klip') {
        if (!v) body = `<p class="st-note">Vyber video na časovej osi.<br>Tu nastavíš rýchlosť, priblíženie, výrez a roztmievanie.</p>`;
        else {
          const s = src.get(v.src) || {};
          const cov = fitMode(v) === 'cover' || (v.zoom || 1) > 1;
          body = `<div class="st-ih"><b>${esc(s.name || 'Klip')}</b><span>${tc(v.start)} – ${tc(end(v))} · zo zdroja ${tc(v.in)} – ${tc(v.out)}</span></div>
            <div class="st-f"><span class="lbl">Rýchlosť</span><div class="seg" data-k="speed">${SPEEDS.map(r => `<button type="button" data-v="${r}" class="${!ramped(v) && sp(v) === r ? 'on' : ''}">${String(r).replace('.', ',')}×</button>`).join('')}</div></div>
            <div class="st-f"><span class="lbl">Speed ramp</span><div class="st-cchips">${RAMPS.map(r => `<button type="button" class="st-cchip${rampId(v) === r.id ? ' on' : ''}" data-ramp="${r.id}">${r.l}</button>`).join('')}</div>${ramped(v) ? `<p class="st-note sm">Krivku rýchlosti doladíš v sekcii Pohyb (riadok Rýchlosť).</p>` : ''}</div>
            ${prevAdj(v) ? `<button type="button" class="btn st-wide" data-act="trin">${IC.trOn}<span>${transOf(v) ? 'Prechod: ' + TRANS[transOf(v).type].l : 'Pridať prechod pred klip'}</span></button>` : ''}
            <div class="st-f"><span class="lbl">Prispôsobenie do rámu</span><div class="seg" data-k="fit"><button type="button" data-v="fit" class="${fitMode(v) === 'fit' ? 'on' : ''}">Zmestiť</button><button type="button" data-v="cover" class="${fitMode(v) === 'cover' ? 'on' : ''}">Vyplniť</button></div></div>
            ${(v.zoom || 1) > 1 ? `<div class="st-f"><div class="st-row"><label class="lbl" for="stZm">Priblíženie výrezu</label><span class="st-tc">${Math.round((v.zoom || 1) * 100)} %</span></div><input type="range" id="stZm" min="100" max="300" value="${Math.round((v.zoom || 1) * 100)}" data-k="zoom"></div>` : ''}
            ${cov ? `<div class="st-f"><div class="st-row"><label class="lbl" for="stCx">Výrez vodorovne</label><span class="st-tc">${Math.round((v.cx ?? 0.5) * 100)} %</span></div><input type="range" id="stCx" min="0" max="100" value="${Math.round((v.cx ?? 0.5) * 100)}" data-k="cx"></div>
            <div class="st-f"><div class="st-row"><label class="lbl" for="stCy">Výrez zvisle</label><span class="st-tc">${Math.round((v.cy ?? 0.5) * 100)} %</span></div><input type="range" id="stCy" min="0" max="100" value="${Math.round((v.cy ?? 0.5) * 100)}" data-k="cy"></div>
            <p class="st-note sm">Tip: výrez posunieš aj ťahaním priamo v náhľade.</p>` : ''}
            ${motionHtml(v)}
            <div class="st-f st-tg"><label class="toggle"><input type="checkbox" data-k="fadeIn"${v.fadeIn ? ' checked' : ''}><span>Roztmievanie na začiatku</span></label><label class="toggle"><input type="checkbox" data-k="fadeOut"${v.fadeOut ? ' checked' : ''}><span>Stmievanie na konci</span></label></div>
            ${group(v).length > 1 ? `<button class="btn st-unlink" data-act="unlink">${IC.link}<span>Odpojiť zvuk od videa</span></button>` : orphanAudio(v).length ? `<button class="btn st-unlink" data-act="relink">${IC.link}<span>Pripojiť zvuk späť k videu</span></button>` : ''}`;
        }
      } else if (tab === 'zvuk') {
        const ls = P.lanes.filter(l => l.kind === 'audio');
        body = `${a ? `<div class="st-ih"><b>${esc(lane(a.lane) ? lane(a.lane).name : 'Zvuk')}</b><span>${tc(a.start)} – ${tc(end(a))}</span></div>
            ${motionHtml(a).replace('<b>Pohyb</b>', '<b>Hlasitosť úseku</b>')}
            <div class="st-f st-tg"><label class="toggle"><input type="checkbox" data-k="afadeIn"${a.fadeIn ? ' checked' : ''}><span>Zosilnenie na začiatku</span></label><label class="toggle"><input type="checkbox" data-k="afadeOut"${a.fadeOut ? ' checked' : ''}><span>Stíšenie na konci</span></label></div>
            <div class="st-sep"></div>` : ''}
          <div class="st-ih"><b>Stopy</b><span>Hlasitosť celej stopy. Nad 100 % počuť až v exporte.</span></div>
          ${ls.map(l => `<div class="st-f st-lv${audible(l) ? '' : ' off'}"><div class="st-row"><span class="st-ln"><i style="background:${l.c}"></i>${esc(l.name)}${l.mute ? ' <em>stlmené</em>' : ''}</span><span class="st-tc">${Math.round((l.vol ?? 1) * 100)} %</span></div>
            <input type="range" min="0" max="200" value="${Math.round((l.vol ?? 1) * 100)}" data-lvol="${esc(l.id)}" aria-label="Hlasitosť ${esc(l.name)}"></div>`).join('') || '<p class="st-note">Zatiaľ žiadny zvuk.</p>'}
          <button class="btn st-wide" data-act="music">${IC.music}<span>Pridať hudbu</span></button>`;
      } else {
        if (!tx) body = `<p class="st-note">Text pridáš tlačidlom nižšie alebo klávesom T. Objaví sa na prehrávacej hlave.</p><button class="btn primary st-wide" data-act="text">${IC.text}<span>Pridať text</span></button>`;
        else body = `<div class="st-f"><label class="lbl" for="stTxtIn">Text</label><textarea id="stTxtIn" rows="2" spellcheck="false">${esc(tx.text || '')}</textarea></div>
            <div class="st-f"><span class="lbl">Štýl</span><div class="st-chips">${Object.entries(STYLES).map(([k, s]) => `<button type="button" class="st-chip${tx.style === k ? ' on' : ''}" data-style="${k}" style="font-family:${esc(s.font)};font-weight:${s.w}">${s.l}</button>`).join('')}</div></div>
            <div class="st-f"><span class="lbl">Farba</span><div class="st-sw">${COLORS.map(c => `<button type="button" class="${(tx.color || '#ffffff') === c ? 'on' : ''}" data-color="${c}" style="--sw:${c}" aria-label="Farba ${c}"></button>`).join('')}</div></div>
            <div class="st-f"><div class="st-row"><label class="lbl" for="stTs">Veľkosť</label><span class="st-tc">${Math.round((tx.size || 0.08) * 100)}</span></div><input type="range" id="stTs" min="3" max="25" value="${Math.round((tx.size || 0.08) * 100)}" data-k="tsize"></div>
            <div class="st-f"><span class="lbl">Poloha</span><div class="seg" data-k="pos"><button type="button" data-v="0.15">Hore</button><button type="button" data-v="0.5">Stred</button><button type="button" data-v="${P.fmt === '9:16' ? 0.62 : 0.8}">Dole</button></div><p class="st-note sm">Alebo text potiahni priamo v náhľade.</p></div>
            ${motionHtml(tx)}
            <div class="st-f"><span class="lbl">Animácia pri objavení</span><div class="st-row2">${UI.pb((ANIM_IN.find(x => x.v === (tx.animIn || 'none')) || ANIM_IN[0]).l, () => ANIM_IN.map(x => ({ label: x.l, v: x.v, checked: x.v === (tx.animIn || 'none') })), it => { tx.animIn = it.v; commit(); renderInsp(); drawFrame(); }, 'title="Ako sa text objaví"')}${UI.pb((ANIM_OUT.find(x => x.v === (tx.animOut || 'none')) || ANIM_OUT[0]).l, () => ANIM_OUT.map(x => ({ label: x.l, v: x.v, checked: x.v === (tx.animOut || 'none') })), it => { tx.animOut = it.v; commit(); renderInsp(); drawFrame(); }, 'title="Ako text zmizne"')}</div></div>
            <button class="btn st-wide" data-act="text">${IC.plus}<span>Ďalší text</span></button>`;
      }
      const key = tab + '|' + [...sel].sort().join(','), oldIb = el.querySelector('.st-ib'), keepScroll = oldIb && key === inspKey ? oldIb.scrollTop : 0;
      el.innerHTML = `<div class="seg st-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="st-ib${key !== inspKey ? ' anim' : ''}">${body}</div>`;
      inspKey = key;
      const ib = el.querySelector('.st-ib'); if (keepScroll) ib.scrollTop = keepScroll;
      fillAll(el);
      // väzby
      $$('[data-tab]', el).forEach(b => b.onclick = () => { tab = b.dataset.tab; renderInsp(); });
      const live = (fn, final) => e => { fn(e); if (!playing) { syncMedia(true); drawFrame(); } if (final) { commit(); renderTimeline(); renderInsp(); } else { const n = e.target.closest('.st-f'); const tcEl = n && n.querySelector('.st-tc'); if (tcEl) tcEl.textContent = e.target.dataset.k === 'tsize' ? e.target.value : e.target.value + ' %'; } };
      if (v) {
        $$('[data-k=speed] button', el).forEach(b => b.onclick = () => { setSpeed(v, Number(b.dataset.v)); v.rampPreset = null; commit(); renderAll(); });
        $$('[data-ramp]', el).forEach(b => b.onclick = () => applyRamp(v, b.dataset.ramp));
        const ti = el.querySelector('[data-act=trin]'); if (ti) ti.onclick = () => selectTrans(v.id);
        $$('[data-k=fit] button', el).forEach(b => b.onclick = () => { v.fit = b.dataset.v; commit(); renderInsp(); syncMedia(true); });
        for (const k of ['zoom', 'cx', 'cy']) { const r = el.querySelector(`[data-k=${k}]`); if (!r) continue; const set = e => { const val = Number(e.target.value) / 100; v[k] = val; }; r.oninput = live(set); r.onchange = live(set, true); }
        $$('input[type=checkbox][data-k^=fade]', el).forEach(c => c.onchange = () => { for (const m of group(v)) m[c.dataset.k] = c.checked; commit(); renderTimeline(); drawFrame(); });
        const rl = el.querySelector('[data-act=relink]'); if (rl) rl.onclick = () => { relink(v); commit(); renderInsp(); hint('Zvuk je zase spojený s videom'); };
        bindMotion(el, v);
        const ul = el.querySelector('[data-act=unlink]'); if (ul) ul.onclick = () => { for (const m of group(v)) if (m !== v) m.g = uid(); v.g = uid(); commit(); renderInsp(); hint('Zvuk je odpojený, môžeš ho strihať a posúvať zvlášť'); };
      }
      if (a) {
        bindMotion(el, a);
        $$('input[type=checkbox][data-k^=afade]', el).forEach(c => c.onchange = () => { a[c.dataset.k === 'afadeIn' ? 'fadeIn' : 'fadeOut'] = c.checked; commit(); renderTimeline(); });
      }
      $$('[data-lvol]', el).forEach(r => { const l = lane(r.dataset.lvol); const set = e => { l.vol = Number(e.target.value) / 100; }; r.oninput = live(set); r.onchange = live(set, true); });
      if (tx) {
        const ta = el.querySelector('#stTxtIn');
        ta.oninput = () => { tx.text = ta.value; drawFrame(); const n = lanesEl.querySelector(`[data-id="${tx.id}"] .st-il`); if (n) n.textContent = ta.value.replace(/\n/g, ' ') || 'Text'; };
        ta.onchange = () => commit();
        $$('[data-style]', el).forEach(b => b.onclick = () => { tx.style = b.dataset.style; tx.color = STYLES[tx.style].color; commit(); renderInsp(); drawFrame(); });
        $$('[data-color]', el).forEach(b => b.onclick = () => { tx.color = b.dataset.color; commit(); renderInsp(); drawFrame(); });
        const ts = el.querySelector('[data-k=tsize]'); const set = e => { tx.size = Number(e.target.value) / 100; }; ts.oninput = live(set); ts.onchange = live(set, true);
        $$('[data-k=pos] button', el).forEach(b => b.onclick = () => { const T = itT(tx); KF.set(tx, 'y', T, Number(b.dataset.v)); KF.set(tx, 'x', T, 0.5); commit(); renderInsp(); txtDrawn = true; drawFrame(); });
        bindMotion(el, tx);
      }
      $$('[data-act=text]', el).forEach(b => b.onclick = () => addText());
      $$('[data-act=music]', el).forEach(b => b.onclick = addMusic);
    }

    /* ---------- ťahanie v náhľade: text (posun) a video (výrez) ---------- */
    frame.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = frame.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W, py = (e.clientY - r.top) / r.height * H;
      // text pod kurzorom (navrchu posledný)
      const texts = itemsOn('t').filter(it => t >= it.start && t < it.end && String(it.text || '').trim()).reverse();
      let hit = null;
      for (const it of texts) { const T = t - it.start, ks = KF.at(it, 'scale', T), M = textMetrics(it, H); const cx = KF.at(it, 'x', T) * W, cy = KF.at(it, 'y', T) * H; if (Math.abs(px - cx) < (M.w / 2 + M.padX) * ks && Math.abs(py - cy) < (M.h / 2 + M.padY) * ks) { hit = it; break; } }
      if (hit) {
        e.preventDefault(); if (playing) pause();
        sel = new Set([hit.id]); tab = 'text'; renderTimelineSel(); renderInsp();
        const T = clamp(t - hit.start, 0, len(hit));
        const ox = KF.at(hit, 'x', T), oy = KF.at(hit, 'y', T), x0 = e.clientX, y0 = e.clientY;
        let moved = false;
        const move = ev => {
          moved = true;
          let nx = clamp01(ox + (ev.clientX - x0) / r.width), ny = clamp01(oy + (ev.clientY - y0) / r.height);
          if (Math.abs(nx - 0.5) < 0.015) nx = 0.5; // prichytenie na stred
          KF.set(hit, 'x', T, nx); KF.set(hit, 'y', T, ny); drawFrame(); liveMotion();
        };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) { commit(); renderTimeline(); renderInsp(); } };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
        return;
      }
      const v = activeVideo();
      // posun obrazu (poloha X/Y, aj keyframy): keď je obraz zmenšený, posunutý, animovaný alebo v režime Zmestiť
      const T0 = v ? clamp(t - v.start, 0, len(v)) : 0;
      if (v && (KF.anyKf(v) || KF.at(v, 'scale', T0) !== 1 || KF.at(v, 'x', T0) || KF.at(v, 'y', T0) || (fitMode(v) === 'fit' && !((v.zoom || 1) > 1)))) {
        e.preventDefault(); if (playing) pause();
        sel = new Set([v.id]); tab = 'klip'; renderTimelineSel(); renderInsp();
        const ox = KF.at(v, 'x', T0), oy = KF.at(v, 'y', T0), x0 = e.clientX, y0 = e.clientY;
        let moved = false;
        const move = ev => {
          moved = true;
          let nx = ox + (ev.clientX - x0) / r.width, ny = oy + (ev.clientY - y0) / r.height;
          if (Math.abs(nx) < 0.012) nx = 0; if (Math.abs(ny) < 0.012) ny = 0; // prichytenie na stred
          KF.set(v, 'x', T0, clamp(nx, -1, 1)); KF.set(v, 'y', T0, clamp(ny, -1, 1)); applyMotion(v); liveMotion();
        };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) { commit(); renderTimeline(); renderInsp(); } };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
        return;
      }
      if (v && (fitMode(v) === 'cover' || (v.zoom || 1) > 1)) {
        e.preventDefault(); if (playing) pause();
        sel = new Set([v.id]); tab = 'klip'; renderTimelineSel(); renderInsp();
        const s = src.get(v.src), ocx = v.cx ?? 0.5, ocy = v.cy ?? 0.5, x0 = e.clientX, y0 = e.clientY;
        // koľko px sa dá posunúť: rozdiel medzi veľkosťou zväčšeného zdroja a rámom
        const fw = W * fk, fh = H * fk, z = v.zoom || 1, sw0 = s.width || 1920, sh0 = s.height || 1080;
        const k = fitMode(v) === 'cover' ? Math.max(fw * z / sw0, fh * z / sh0) : Math.min(fw * z / sw0, fh * z / sh0);
        const ex = Math.max(1, sw0 * k - fw), ey = Math.max(1, sh0 * k - fh);
        let moved = false;
        const move = ev => { moved = true; v.cx = clamp01(ocx - (ev.clientX - x0) / ex); v.cy = clamp01(ocy - (ev.clientY - y0) / ey); placeVideo(v); };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) { commit(); renderInsp(); } };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      }
    });

    /* ---------- export ---------- */
    function layer(html, cls = '') { const l = q('#stLayer'); l.className = 'st-layer ' + cls + (!document.hasFocus() || document.hidden ? ' noanim' : ''); l.innerHTML = html; l.hidden = false; return l; }
    function hideLayer() { const l = q('#stLayer'); l.hidden = true; l.innerHTML = ''; }
    function exportDialog() {
      if (!P.items.length) { hint('Časová os je prázdna'); return; }
      pause();
      const [w0, h0] = outSize();
      const res = P.fmt === '16:9' ? [[w0, h0], ...[[1920, 1080], [1280, 720]].filter(x => x[1] < h0)] : P.fmt === '9:16' ? [[1080, 1920], [720, 1280]] : [[1080, 1080], [720, 720]];
      const v0 = P.items.find(i => i.kind === 'video'), fps0 = Math.min(60, Math.round((v0 && src.get(v0.src) && src.get(v0.src).fps) || 60));
      let o = { res: 0, fps: fps0 >= 50 ? 60 : 30, mb: 0, keep: false };
      try { o = { ...o, ...JSON.parse(localStorage.getItem('studio.export') || '{}'), res: 0 }; } catch (e) { }
      const sizes = [{ v: 0, l: 'Pôvodná kvalita' }, { v: 20, l: '20 MB · Discord' }, { v: 10, l: '10 MB' }, { v: 50, l: '50 MB · Nitro Basic' }, { v: 100, l: '100 MB · Nitro' }];
      const l = layer(`<div class="st-exp">
        <h3>Exportovať video</h3>
        <p class="st-note">${tc(duration())} · ${P.fmt} · uloží sa do knižnice</p>
        <div class="st-f"><label class="lbl" for="stEn">Názov</label><input id="stEn" class="st-in" value="${esc(P.name || 'Montáž')}" spellcheck="false"></div>
        <div class="st-f"><span class="lbl">Rozlíšenie</span><div class="seg" data-e="res">${res.map((r, i) => `<button type="button" data-v="${i}" class="${i === o.res ? 'on' : ''}">${r[0]}×${r[1]}</button>`).join('')}</div></div>
        <div class="st-f"><span class="lbl">Snímky za sekundu</span><div class="seg" data-e="fps"><button type="button" data-v="60" class="${o.fps === 60 ? 'on' : ''}">60</button><button type="button" data-v="30" class="${o.fps === 30 ? 'on' : ''}">30</button></div></div>
        <div class="st-f"><span class="lbl">Veľkosť</span><div class="st-pb">${UI.pb(sizes.find(x => x.v === o.mb).l, () => sizes.map(x => ({ label: x.l, v: x.v, checked: x.v === o.mb })), it => { o.mb = it.v; l.querySelector('.st-pb').firstChild.querySelector('span').textContent = sizes.find(x => x.v === o.mb).l; l.querySelector('#stKeepRow').hidden = !!o.mb; })}</div></div>
        <label class="toggle st-keep" id="stKeepRow"${o.mb ? ' hidden' : ''}><input type="checkbox" id="stKeep"${o.keep ? ' checked' : ''}><span>Pridať aj každú zvukovú stopu zvlášť (pre DaVinci, Premiere)</span></label>
        <div class="st-acts"><button class="btn" data-a="x">Zrušiť</button><button class="btn primary" data-a="go">${IC.exp}<span>Exportovať</span></button></div>
      </div>`, 'center');
      fillAll(l);
      UI.onSeg(l.firstElementChild, (k, val) => { o[k] = Number(val); });
      l.querySelector('[data-a=x]').onclick = hideLayer;
      l.querySelector('[data-a=go]').onclick = () => {
        o.keep = l.querySelector('#stKeep').checked;
        const name = l.querySelector('#stEn').value.trim() || 'Montáž';
        P.name = name; q('#stName').value = name; persist();
        try { localStorage.setItem('studio.export', JSON.stringify({ fps: o.fps, mb: o.mb, keep: o.keep })); } catch (e) { }
        runExport(name, res[o.res] || res[0], o);
      };
    }
    /* ---------- export: jedno video podľa plánu (rovnaké výpočty ako náhľad) ---------- */
    const n4 = x => { const v = Number(x).toFixed(4); return v === '-0.0000' ? '0' : v; };
    function exportVideo(p) {
      const it = p.it, s = src.get(it.src) || {}, Dsrc = s.duration || it.out;
      const T = `(t-${n4(it.start)})`;
      let X = KF.exprOf(it, 'x', T), Y = KF.exprOf(it, 'y', T), S = KF.exprOf(it, 'scale', T), R = KF.exprOf(it, 'rot', T);
      const colorFades = [], alpha = [];
      const D = len(it), F2 = Math.min(0.5, D / 3);
      if (it.fadeIn) colorFades.push({ t: 'in', st: it.start, d: F2, c: 'black' });
      if (it.fadeOut) colorFades.push({ t: 'out', st: it.start + D - F2, d: F2, c: 'black' });
      for (const e of p.env) {
        const E = `(3*pow(clip((t-${n4(e.w0)})/${n4(e.d)},0,1),2)-2*pow(clip((t-${n4(e.w0)})/${n4(e.d)},0,1),3))`;
        if (!e.ov) {
          const c = e.type === 'white' ? 'white' : 'black';
          if (e.role === 'A') colorFades.push({ t: 'out', st: e.w0, d: e.cut - e.w0, c });
          else colorFades.push({ t: 'in', st: e.cut, d: e.w1 - e.cut, c });
          continue;
        }
        if (e.type === 'fade' && e.role === 'B') alpha.push({ st: e.w0, d: e.d });
        if (e.type === 'pushL') X = `(${X})+(${e.role === 'A' ? '-' + E : '(1-' + E + ')'})`;
        if (e.type === 'pushR') X = `(${X})+(${e.role === 'A' ? E : '-(1-' + E + ')'})`;
        if (e.type === 'up') Y = `(${Y})+(${e.role === 'A' ? '-' + E : '(1-' + E + ')'})`;
        if (e.type === 'zoom') { if (e.role === 'A') S = `(${S})*(1+0.3*${E})`; else { S = `(${S})*(1.2-0.2*${E})`; alpha.push({ st: e.w0, d: e.d }); } }
      }
      // rozsah zo zdroja vrátane predĺženia; čo za zdrojom chýba, sa podrží (tpad)
      const sp0 = spAt(it, 0), spL = spAt(it, D);
      let inR = it.in - (it.start - p.rs) * sp0, outR = it.out + (p.re - end(it)) * spL, fh = 0, ft = 0;
      if (inR < 0) { fh = -inR / sp0; inR = 0; }
      if (outR > Dsrc) { ft = (outR - Dsrc) / spL; outR = Dsrc; }
      let map = null;
      if (ramped(it)) {
        // výstupný čas ako funkcia času zdroja (po kúskoch lineárne, rovnaké úseky sa zlúčia)
        const pts = [];
        for (let tl = p.rs + fh; tl <= p.re - ft + 1e-6; tl += 1 / 30) pts.push([srcAtRender(it, tl) - inR, tl - p.rs - fh]);
        pts.push([outR - inR, p.re - ft - p.rs - fh]);
        const simp = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
          const a = simp[simp.length - 1], b = pts[i], c = pts[i + 1];
          const k1 = (b[1] - a[1]) / Math.max(1e-6, b[0] - a[0]), k2 = (c[1] - b[1]) / Math.max(1e-6, c[0] - b[0]);
          if (Math.abs(k1 - k2) > 1e-3) simp.push(b);
        }
        simp.push(pts[pts.length - 1]);
        const parts = [];
        for (let i = 0; i < simp.length - 1; i++) {
          const [s0, o0] = simp[i], [s1, o1] = simp[i + 1]; if (s1 - s0 < 1e-5) continue;
          parts.push(`gte(T,${n4(s0)})*lt(T,${n4(s1)})*(${n4(o0)}+(T-${n4(s0)})*${n4((o1 - o0) / (s1 - s0))})`);
        }
        const last = simp[simp.length - 1];
        map = `if(gte(T,${n4(last[0])}),${n4(last[1])}+(T-${n4(last[0])})*${n4(1 / spL)},${parts.join('+') || '0'})`;
      }
      return { file: it.src, start: p.rs, in: inR, out: outR, speed: ramped(it) ? 1 : sp(it), map, freezeHead: fh, freezeTail: ft,
        srcW: s.width || 0, srcH: s.height || 0, fit: fitMode(it), zoom: it.zoom || 1, cx: it.cx ?? 0.5, cy: it.cy ?? 0.5,
        fadeIn: false, fadeOut: false, colorFades, alpha, motion: { s: S, x: X, y: Y, r: R } };
    }
    /* zvuk so speed rampom: úseky po 0,1 s s vlastným tempom (atempo), rovnaké tempá sa zlúčia */
    function audioChunks(it) {
      const L = len(it), out = [];
      for (let T0 = 0; T0 < L - 1e-6; T0 += 0.1) {
        const T1 = Math.min(L, T0 + 0.1), s0 = srcPos(it, T0) - it.in, s1 = srcPos(it, T1) - it.in;
        const r = clamp((s1 - s0) / Math.max(1e-6, T1 - T0), 0.25, 4);
        const prev = out[out.length - 1];
        if (prev && Math.abs(prev.r - r) < 0.01) prev.s1 = s1; else out.push({ s0, s1, r });
      }
      return out;
    }
    async function runExport(name, [EW, EH], o) {
      exporting = true;
      const l = layer(`<div class="st-exp prog"><div class="sv-ring"><svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="27"/><circle class="fg" id="stRing" cx="32" cy="32" r="27"/></svg><b id="stPct">0 %</b></div><h3>Exportujem…</h3><p class="st-note">${esc(name)} · ${EW}×${EH} · ${o.fps} fps</p></div>`, 'center locked');
      const setP = v => { const r = l.querySelector('#stRing'), p = l.querySelector('#stPct'); if (r) r.style.strokeDashoffset = String(170 * (1 - v)); if (p) p.textContent = Math.round(v * 100) + ' %'; };
      Studio._onEvent = ev => { if (ev.type === 'exportProgress') setP(ev.value); };
      try {
        const D = duration();
        // pohyb (keyframy) ako ffmpeg výrazy v čase osi: T = (t - začiatok položky)
        const motionOf = it => { const T = `(t-${it.start.toFixed(4)})`; return { s: KF.exprOf(it, 'scale', T), x: KF.exprOf(it, 'x', T), y: KF.exprOf(it, 'y', T), r: KF.exprOf(it, 'rot', T) }; };
        const video = renderPlan().map(p => exportVideo(p));
        const audio = [];
        for (const it of P.items) {
          if (it.kind !== 'audio') continue;
          const ln = lane(it.lane); if (!audible(ln)) continue;
          const s = src.get(it.src); if (!s) continue;
          const animVol = KF.animated(it, 'vol');
          const vol = (ln.vol ?? 1) * (animVol ? 1 : (it.vol ?? 1)); if (vol <= 0) continue;
          // hudba: pôvodný súbor; klipy: zvuková stopa č. ti v pôvodnom klipe; hlasitosť z keyframov ako výraz (t = čas od začiatku úseku)
          audio.push({ file: s.music ? s.path : it.src, stream: s.music ? 0 : it.ti, lane: ln.id, start: it.start, in: it.in, out: it.out, speed: ramped(it) ? 1 : sp(it), chunks: ramped(it) ? audioChunks(it) : null, dur: len(it), vol, volE: animVol ? KF.exprOf(it, 'vol', 't') : null, fadeIn: !!it.fadeIn, fadeOut: !!it.fadeOut });
        }
        const overlays = itemsOn('t').filter(it => String(it.text || '').trim() && it.end > it.start).map(it => { const m = motionOf(it); return { ...textPng(it, EW, EH), start: it.start, end: it.end, animIn: it.animIn || 'none', animOut: it.animOut || 'none', xe: m.x, ye: m.y, se: m.s, re: m.r }; });
        const out = await api.action('exportProject', {
          name, W: EW, H: EH, fps: o.fps, duration: D, targetMB: o.mb, keepTracks: !!o.keep && !o.mb,
          video, audio, overlays, lanes: P.lanes.filter(x => x.kind === 'audio').map(x => ({ id: x.id, title: x.name }))
        });
        exporting = false;
        const fname = String(out).split(/[\\/]/).pop();
        api.action('attention').catch(() => { });
        const d = layer(`<div class="st-exp done">
          <svg class="cmp-check" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24"/><path d="M21 33l7.5 7L43 25"/></svg>
          <h3>Hotovo</h3><p class="st-note" title="${esc(out)}">${esc(fname)}</p>
          <div class="st-acts"><button class="btn" data-a="copy">${IC.copy}<span>Kopírovať pre Discord</span></button><button class="btn" data-a="reveal">${I.folder}<span>Ukázať v priečinku</span></button></div>
          <div class="st-acts"><button class="btn ghost" data-a="more">Upravovať ďalej</button><button class="btn primary" data-a="close">Zavrieť editor</button></div></div>`, 'center');
        const cb = d.querySelector('[data-a=copy]');
        cb.onclick = async () => { try { await api.action('copyFile', { path: out }); cb.querySelector('span').textContent = 'Skopírované, vlož cez Ctrl+V'; } catch (er) { toast('error', 'Kopírovanie zlyhalo', er.message); } };
        d.querySelector('[data-a=reveal]').onclick = () => api.action('reveal', { path: out });
        d.querySelector('[data-a=more]').onclick = hideLayer;
        d.querySelector('[data-a=close]').onclick = () => close();
      } catch (e) {
        exporting = false; hideLayer();
        toast('error', 'Export zlyhal', e.message);
      }
      Studio._onEvent = null;
    }

    /* ---------- klávesy ---------- */
    function onKey(e) {
      if (closed) return;
      if (document.querySelector('.pop-menu')) return;  // otvorené menu si Esc a šípky rieši samo
      e.stopPropagation();                             // knižnica pod editorom nesmie reagovať (napr. Delete)
      if (exporting) return;
      if (document.fullscreenElement && e.key === 'Escape') { document.exitFullscreen().catch(() => { }); return; }
      if (e.target.closest('input, textarea') && e.key !== 'Escape') return;
      if (!q('#stLayer').hidden) { if (e.key === 'Escape') hideLayer(); return; }
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
      if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); return; }
      if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); return; }
      if (k === 'f' && !e.ctrlKey) { e.preventDefault(); toggleFs(); return; }
      if (k === 'm' && !e.ctrlKey) { e.preventDefault(); volApi.toggleMute(); hint('Zvuk náhľadu prepnutý'); return; }
      if (k === 'z' && !e.ctrlKey) { e.preventDefault(); fitZoom(); setSX(0, true); hint('Celá časová os'); return; }
      if (k === 'k' && !e.ctrlKey) { e.preventDefault(); playing ? pause() : play(); return; }
      if ((k === 'j' || k === 'l') && !e.ctrlKey) { e.preventDefault(); seek(t + (k === 'j' ? -5 : 5)); return; }
      if (k === 'a' && e.ctrlKey) { e.preventDefault(); P.items.forEach(i => sel.add(i.id)); renderTimelineSel(); renderInsp(); return; }
      if (k === 's' && !e.ctrlKey) { e.preventDefault(); splitAt(t); return; }
      if (k === 't' && !e.ctrlKey) { e.preventDefault(); addText(); return; }
      if (k === 'd' && e.ctrlKey) { e.preventDefault(); duplicateSel(); return; }
      if (k === 'n' && !e.ctrlKey) { toggleSnap(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (trSel) { const B = P.items.find(i => i.id === trSel); if (B && B.tin) { setTrans(B, null); hint('Prechod odstránený'); } trSel = null; renderInsp(); return; }
        const kit = kfSel && P.items.find(i => i.id === kfSel.id);
        if (kit) { deleteKeyAt(kit, kfSel.t); return; } // vybraný kosoštvorec → zmaž len ten keyframe
        deleteSel(e.shiftKey); return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const st = e.shiftKey ? 1 : 1 / (P.fps || 60); seek(t + (e.key === 'ArrowLeft' ? -st : st)); return; }
      if (e.key === 'Home') { seek(0); return; }
      if (e.key === 'End') { seek(duration()); return; }
      if (e.key === '+' || e.key === '=') { const z = clamp(Number(q('#stZoom').value) + 8, 0, 100); q('#stZoom').value = String(z); fillRange(q('#stZoom')); setZoom(z); return; }
      if (e.key === '-') { const z = clamp(Number(q('#stZoom').value) - 8, 0, 100); q('#stZoom').value = String(z); fillRange(q('#stZoom')); setZoom(z); return; }
      if (e.key === 'Escape' && trSel) { trSel = null; renderTimeline(); renderInsp(); return; }
      if (e.key === 'Escape' && kfSel) { kfSel = null; $$('.st-kfd.on', lanesEl).forEach(x => x.classList.remove('on')); renderInsp(); return; }
      if (e.key === 'Escape') { if (sel.size) { sel.clear(); renderTimelineSel(); renderInsp(); } else close(); }
    }
    function toggleSnap() { snapOn = !snapOn; q('#stSnap').classList.toggle('on', snapOn); hint(snapOn ? 'Prichytávanie zapnuté' : 'Prichytávanie vypnuté'); }
    document.addEventListener('keydown', onKey, true);
    const ro = new ResizeObserver(() => { layoutFrame(); txtDrawn = true; drawFrame(); setSX(sx, false); });
    ro.observe(stage); ro.observe(scroll);

    q('#stPlay').onclick = () => playing ? pause() : play();
    const volApi = UI.wireVol(root, () => { try { syncMedia(false); } catch (e) { } });
    /* celá obrazovka: celý prehrávač (obraz + ovládanie), ovládanie sa počas prehrávania schová */
    function toggleFs() {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
      else stage.requestFullscreen().catch(() => { });
    }
    let fsIdle = 0;
    const fsWake = () => { stage.classList.remove('fs-idle'); clearTimeout(fsIdle); fsIdle = setTimeout(() => { if (playing && document.fullscreenElement === stage) stage.classList.add('fs-idle'); }, 2200); };
    const onFs = () => {
      const on = document.fullscreenElement === stage;
      stage.classList.toggle('fs', on); stage.classList.remove('fs-idle');
      if (on) fsWake();
      requestAnimationFrame(() => { layoutFrame(); drawFrame(); });
    };
    document.addEventListener('fullscreenchange', onFs);
    q('#stFs').onclick = toggleFs;
    stage.addEventListener('pointermove', () => { if (document.fullscreenElement === stage) fsWake(); });
    stage.addEventListener('pointerdown', e => {
      if (document.fullscreenElement !== stage || e.button !== 0 || e.target.closest('.st-trans, .st-fprog')) return;
      playing ? pause() : play();
    });
    q('#stFprog').addEventListener('pointerdown', e => {
      e.stopPropagation();
      const bar = e.currentTarget, r = bar.getBoundingClientRect();
      const go = ev => seek(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * duration(), playing);
      go(e); bar.setPointerCapture(e.pointerId);
      const up = () => { bar.removeEventListener('pointermove', go); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', go); bar.addEventListener('pointerup', up);
    });
    q('#stHq').onclick = e => { const on = !UI.previewFull(); UI.setPreviewFull([...src.values()].flatMap(x => [x.video, x.video2]), on); e.currentTarget.classList.toggle('on', on); hint(on ? 'Náhľad v plnej kvalite (skákanie je pomalšie)' : 'Rýchly náhľad, export je stále v plnej kvalite'); };
    q('#stPrev').onclick = () => seek(0);
    q('#stNext').onclick = () => seek(duration());
    q('#stSplit').onclick = () => splitAt(t);
    q('#stDel').onclick = () => deleteSel(false);
    q('#stAddText').onclick = () => addText();
    q('#stAddMusic').onclick = addMusic;
    q('#stSnap').onclick = toggleSnap;
    q('#stUndo').onclick = doUndo;
    q('#stRedo').onclick = doRedo;
    q('#stExport').onclick = exportDialog;
    q('#stClose').onclick = () => close();
    q('#stMin').onclick = () => api.action('win', { do: 'min' }).catch(() => { });
    q('#stMax').onclick = () => api.action('win', { do: 'max' }).catch(() => { });
    q('#stName').addEventListener('change', e => { P.name = e.target.value.trim() || 'Montáž'; commit(); });
    q('#stName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
    UI.onSeg(q('#stFmt').parentElement, (k, val) => { if (!FMT[val] || val === P.fmt) return; P.fmt = val; commit(); renderAll(); seek(t); });

    /* ---------- veľkosť panelov (ťahaním za okraj, pamätá si ju) ---------- */
    const LAYOUT_DEF = { mw: 236, iw: 292, th: 0 };
    let layout = { ...LAYOUT_DEF };
    try { layout = { ...layout, ...JSON.parse(localStorage.getItem('studio.layout') || '{}') }; } catch (e) { }
    const stEl = q('#stRoot');
    function applyLayout() {
      stEl.style.setProperty('--mw', clamp(layout.mw, 170, 520) + 'px');
      stEl.style.setProperty('--iw', clamp(layout.iw, 240, 560) + 'px');
      if (layout.th) stEl.style.setProperty('--th', clamp(layout.th, 150, stEl.clientHeight - 260) + 'px'); else stEl.style.removeProperty('--th');
    }
    applyLayout();
    $$('.st-split', root).forEach(sp => {
      const k = sp.dataset.s;
      sp.addEventListener('dblclick', () => { layout[k] = LAYOUT_DEF[k]; applyLayout(); try { localStorage.setItem('studio.layout', JSON.stringify(layout)); } catch (e) { } stEl.classList.add('relayout'); setTimeout(() => stEl.classList.remove('relayout'), 400); });
      sp.addEventListener('pointerdown', e => {
        e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('on'); root.classList.add('resizing');
        const x0 = e.clientX, y0 = e.clientY, start = k === 'th' ? q('#stTl').getBoundingClientRect().height + 42 : layout[k];
        const move = ev => {
          if (k === 'mw') layout.mw = clamp(start + ev.clientX - x0, 170, 520);
          else if (k === 'iw') layout.iw = clamp(start - (ev.clientX - x0), 240, 560);
          else layout.th = clamp(start - (ev.clientY - y0), 190, stEl.clientHeight - 260) - 42;
          applyLayout();
        };
        const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.classList.remove('on'); root.classList.remove('resizing'); try { localStorage.setItem('studio.layout', JSON.stringify(layout)); } catch (e) { } layoutFrame(); requestDraw(); };
        sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
      });
    });

    /* ---------- ľavý panel: Médiá · Text · Efekty ---------- */
    let ltab = 'media';
    function setLTab(v) {
      ltab = v;
      $$('#stLTabs button', root).forEach(b => b.classList.toggle('on', b.dataset.v === v));
      const panes = { media: '#stMedia', text: '#stTextLib', fx: '#stFx' };
      for (const [k, sel2] of Object.entries(panes)) { const p2 = q(sel2); const on = k === v; if (on && p2.hidden) { p2.hidden = false; p2.classList.remove('in'); void p2.offsetWidth; p2.classList.add('in'); } else if (!on) p2.hidden = true; }
      if (v === 'text') renderTextLib();
      if (v === 'fx') renderFx();
    }
    q('#stLTabs').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) setLTab(b.dataset.v); });
    function renderTextLib() {
      q('#stTextLib').innerHTML = `<p class="st-note">Klikni na štýl, text sa pridá na prehrávaciu hlavu.</p>
        <div class="st-tlib">${Object.entries(STYLES).map(([k, st]) => `<button type="button" class="st-tcard" data-style="${k}">
          <span class="st-tprev" style="font-family:${esc(st.font)};font-weight:${st.w};color:${st.color};${st.outline ? 'text-shadow:0 0 1px #000,0 0 2px #000,1px 1px 0 #000,-1px -1px 0 #000;' : ''}${st.glow ? `text-shadow:0 0 10px ${st.color};` : ''}${st.box ? 'background:rgba(0,0,0,.62);padding:3px 8px;border-radius:6px;' : ''}${st.upper ? 'text-transform:uppercase;' : ''}">Tvoj text</span><small>${st.l}</small></button>`).join('')}</div>
        <div class="st-mh sub"><b>Kde</b></div>
        <div class="st-tpos"><button type="button" class="st-chipb" data-ty="0.15">Hore</button><button type="button" class="st-chipb" data-ty="0.5">Stred</button><button type="button" class="st-chipb on" data-ty="dole">Dole</button></div>`;
      let ty = 'dole';
      $$('[data-ty]', q('#stTextLib')).forEach(b => b.onclick = () => { ty = b.dataset.ty; $$('[data-ty]', q('#stTextLib')).forEach(x => x.classList.toggle('on', x === b)); });
      $$('.st-tcard', q('#stTextLib')).forEach(b => b.onclick = () => addText(b.dataset.style, ty === 'dole' ? null : Number(ty)));
    }
    /* efekty = predvoľby keyframov (dajú sa potom ďalej upravovať v sekcii Pohyb) */
    const FX = [
      { id: 'zoomIn', l: 'Pomalý nájazd', d: 'Celý klip sa pomaly priblíži', on: 'whole' },
      { id: 'zoomOut', l: 'Pomalé oddialenie', d: 'Začne priblížený, pomaly sa oddiali', on: 'whole' },
      { id: 'kenburns', l: 'Ken Burns', d: 'Jemné priblíženie s posunom do strany', on: 'whole' },
      { id: 'punch', l: 'Úder', d: 'Krátke priblíženie na hlave, napr. pri kille', on: 'head' },
      { id: 'zoomKill', l: 'Nájazd na moment', d: 'Priblíži, chvíľu podrží a vráti sa', on: 'head' },
      { id: 'shake', l: 'Zatrasenie', d: 'Obraz sa na hlave krátko otrasie', on: 'head' },
      { id: 'spin', l: 'Otočka', d: 'Celé otočenie dookola na hlave', on: 'head' },
      { id: 'slideIn', l: 'Prílet zboku', d: 'Klip na začiatku priletí zľava', on: 'start' }
    ];
    function renderFx() {
      const tgt = fxTarget();
      q('#stFx').innerHTML = `<p class="st-note">${tgt ? `Použije sa na: <b>${esc(tgt.kind === 'text' ? 'text „' + String(tgt.text || '').slice(0, 24) + '“' : (src.get(tgt.src) || {}).name || 'klip')}</b>` : 'Vyber klip alebo text na časovej osi, alebo daj hlavu na klip.'}</p>
        <div class="st-fxl">${FX.map(f => `<button type="button" class="st-fx" data-fx="${f.id}"${tgt ? '' : ' disabled'}><i class="st-fxp fx-${f.id}"><b></b></i><span><b>${f.l}</b><small>${f.d}${f.on === 'head' ? ' · na hlave' : ''}</small></span></button>`).join('')}
          <div class="st-mh sub"><b>Prechody</b></div>
          <p class="st-note sm">${cutNear() ? 'Pridá sa na strih najbližšie k hlave (' + tc(cutNear().start) + ').' : 'Daj dva klipy hneď za seba, prechod sa pridá na strih medzi nimi.'}</p>
          <div class="st-trg">${Object.entries(TRANS).map(([k, x]) => `<button type="button" class="st-trc" data-ftt="${k}"${cutNear() ? '' : ' disabled'}><i class="st-trp tp-${k}"><b></b><em></em></i><span>${x.l}</span></button>`).join('')}</div>
        </div>`;
      $$('.st-fx', q('#stFx')).forEach(b => b.onclick = () => applyFx(b.dataset.fx));
      $$('[data-ftt]', q('#stFx')).forEach(b => b.onclick = () => { const B = cutNear(); if (!B) return; setTrans(B, b.dataset.ftt); selectTrans(B.id); previewTrans(B); });
    }
    function fxTarget() {
      const pk = P.items.filter(i => sel.has(i.id) && i.kind !== 'audio');
      return pk.find(i => i.kind === 'video') || pk.find(i => i.kind === 'text') || activeVideo() || null;
    }
    function applyFx(id) {
      const it = fxTarget(); if (!it) { hint('Vyber klip alebo text'); return; }
      const L = len(it), T = itT(it), isText = it.kind === 'text';
      const keep = (k, a, b) => { if (it.kf && it.kf[k]) it.kf[k] = it.kf[k].filter(x => x.t < a - 1e-3 || x.t > b + 1e-3); };
      const S = k => KF.at(it, k, T);
      const put = (k, pts) => { const a = pts[0][0], b = pts[pts.length - 1][0]; keep(k, a, b); for (const [tt, v, e] of pts) KF.setKey(it, k, clamp(tt, 0, L), v, e || 'inout'); };
      const s0 = S('scale'), x0 = S('x'), y0 = S('y'), r0 = S('rot');
      const h = (d) => Math.min(L, T + d);
      if (id === 'zoomIn') put('scale', [[0, s0, 'inout'], [L, s0 * 1.18]]);
      if (id === 'zoomOut') put('scale', [[0, s0 * 1.18, 'inout'], [L, s0]]);
      if (id === 'kenburns') { put('scale', [[0, s0 * 1.1, 'inout'], [L, s0 * 1.25]]); put('x', [[0, x0 - (isText ? 0.02 : 0.03), 'inout'], [L, x0 + (isText ? 0.02 : 0.03)]]); }
      if (id === 'punch') put('scale', [[T, s0, 'out'], [h(0.12), s0 * 1.22, 'inout'], [h(0.45), s0]]);
      if (id === 'zoomKill') put('scale', [[T, s0, 'inout'], [h(0.3), s0 * 1.55, 'hold'], [h(1.2), s0 * 1.55, 'inout'], [h(1.55), s0]]);
      if (id === 'shake') {
        const A = isText ? 0.012 : 0.018, n = 9, D = 0.5;
        put('x', Array.from({ length: n + 1 }, (_, i) => [T + i * D / n, x0 + (i === n ? 0 : (i % 2 ? -1 : 1) * A * (1 - i / n)), 'inout']).filter(p => p[0] <= L));
        put('y', Array.from({ length: n + 1 }, (_, i) => [T + i * D / n, y0 + (i === n ? 0 : ((i + 1) % 3 - 1) * A * 0.7 * (1 - i / n)), 'inout']).filter(p => p[0] <= L));
      }
      if (id === 'spin') put('rot', [[T, r0, 'inout'], [h(0.6), r0 + 360]]);
      if (id === 'slideIn') put('x', [[0, isText ? x0 - 0.7 : -1, 'out'], [Math.min(L, 0.5), x0]]);
      sel = new Set([it.id]); tab = it.kind === 'text' ? 'text' : 'klip'; kfSel = null;
      commit(); renderTimeline(); renderInsp(); syncMedia(true); txtDrawn = true; drawFrame();
      const fx = FX.find(f => f.id === id); hint(`${fx.l}: pridané ako keyframy, uprav v sekcii Pohyb`);
      // ukáž efekt hneď: prehraj úsek, kde sa deje
      const from = fx.on === 'head' ? it.start + T - 0.2 : it.start;
      seek(Math.max(it.start, from)); play();
      setTimeout(() => { if (playing) pause(); }, Math.min(2500, (fx.on === 'head' ? 1.9 : Math.min(L, 2.5)) * 1000));
    }

    /* ---------- prechod z jednoduchého editora (video „preletí“ do náhľadu) ---------- */
    async function enter() {
      root.classList.add('enter');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const from = opts.fromRect, img = opts.fromImage;
      if (from && img && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const to = frame.getBoundingClientRect();
        const fly = document.createElement('img');
        fly.className = 'st-fly'; fly.src = img;
        Object.assign(fly.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
        document.body.appendChild(fly);
        frame.style.opacity = '0';
        // cieľ: rovnaký pomer strán ako zdroj, vycentrovaný v ráme náhľadu
        const A = from.width / from.height; let tw = to.width, th = tw / A; if (th > to.height) { th = to.height; tw = th * A; }
        const tx = to.left + (to.width - tw) / 2, ty = to.top + (to.height - th) / 2;
        const anim = fly.animate([
          { transform: 'translate(0,0) scale(1,1)' },
          { transform: `translate(${tx - from.left}px, ${ty - from.top}px) scale(${tw / from.width}, ${th / from.height})` }
        ], { duration: 520, easing: 'cubic-bezier(.32,1.18,.5,1)', fill: 'forwards' });
        requestAnimationFrame(() => root.classList.add('in'));
        await anim.finished.catch(() => { });
        frame.style.opacity = '';
        fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).finished.then(() => fly.remove());
      } else { root.classList.add('in'); await new Promise(r => setTimeout(r, 420)); }
    }

    function close() {
      if (exporting || closed) return;
      pause(); persist(true);
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
      ro.disconnect();
      root.classList.add('out');
      setTimeout(() => {
        for (const s of src.values()) {
          for (const v of [s.video, s.video2]) if (v) { v._dead = true; v.pause(); v.removeAttribute('src'); v.load(); }
          for (const a of s.audio.values()) { a._dead = true; a.pause(); a.removeAttribute('src'); a.load(); }
        }
        // poistka: čokoľvek, čo sa v okne medzitým ešte objavilo
        root.querySelectorAll('video, audio').forEach(el => { try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) { } });
        root.remove(); editorOpen = false; document.body.classList.remove('st-open');
        if (opts.onClose) opts.onClose(projectId, P.items.length > 0 || savedOnce);
      }, 260);
    }

    // štart: najprv kostra a animácia, zdroje sa načítajú popri tom
    renderAll();
    // najprv dohrá animácia, až potom sa načítavajú zdroje (dekódovanie videa a náhľady by ju inak trhali)
    await enter();
    if (closed) return;
    try { await init(); }
    catch (e) { toast('error', 'Advanced editor sa nepodarilo otvoriť', e.message); }
    if (closed) return;
    setTimeout(() => root.classList.add('settled'), 1000);
    if (input.t != null) seek(input.t);
    Studio._state = () => ({ P, sel: [...sel], t, pps });
  }

  /* lazy načítanie: CSS a JS sa pridajú až pri prvom otvorení */
  return { open, get isOpen() { return editorOpen; }, _onEvent: null, textPng, drawText };
})();
