/* Editor: časová os so sekvenciou klipov (spájanie, delenie, orez, poradie), text a šípky,
   mixér zvukových stôp a uloženie ako nový klip.

   Model:   sources  = klipy, z ktorých sa strihá (video prvok + vytiahnuté zvukové stopy)
            segs     = poradie úsekov [{ id, src, in, out }]; čas na osi sa počíta z poradia (ripple)
            overlays = text/šípky s časom na výslednej osi
   Pri ťahaní sa DOM neprekresľuje (iba sa menia štýly), inak by sa ťahanie prerušilo. */
window.Player = (function () {
  const { $, $$, esc, I, modal, closeModal, toast, dur, durMs, size, fileUrl, dayLabel, time } = UI;

  const COLORS = ['#ffffff', '#ffd60a', '#ff9f0a', '#ff453a', '#30d158', '#0a84ff', '#bf5af2', '#1d1d1f'];
  const TRACK_C = ['#ff9f0a', '#0a84ff', '#ffb340', '#bf5af2', '#30d158', '#ff375f', '#40c8e0', '#8e8e93'];
  const SRC_C = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#40c8e0', '#ffd60a', '#8e8e93'];
  const FONT = '"Inter Variable", "Segoe UI", system-ui, sans-serif';
  const FONTS = {
    inter: { label: 'Inter', css: FONT, w: 800 },
    impact: { label: 'Impact', css: 'Impact, "Arial Black", sans-serif', w: 400 },
    black: { label: 'Arial Black', css: '"Arial Black", "Segoe UI Black", sans-serif', w: 900 },
    mono: { label: 'Mono', css: '"JetBrains Mono", Consolas, monospace', w: 700 }
  };
  const PRESETS = [
    { id: 'classic', label: 'Klasický', p: { font: 'inter', color: '#ffffff', outline: true, box: false, glow: false, upper: false } },
    { id: 'meme', label: 'Meme', p: { font: 'impact', color: '#ffffff', outline: true, box: false, glow: false, upper: true } },
    { id: 'title', label: 'Titulok', p: { font: 'inter', color: '#ffffff', outline: false, box: true, glow: false, upper: false } },
    { id: 'neon', label: 'Neón', p: { font: 'black', color: '#bf5af2', outline: false, box: false, glow: true, upper: true } },
    { id: 'yellow', label: 'Žltý', p: { font: 'black', color: '#ffd60a', outline: true, box: false, glow: false, upper: false } }
  ];
  const ANIM_IN = [{ v: 'none', l: 'Žiadna' }, { v: 'fade', l: 'Fade' }, { v: 'pop', l: 'Pop' }, { v: 'slide', l: 'Zdola' }];
  const ANIM_OUT = [{ v: 'none', l: 'Žiadna' }, { v: 'fade', l: 'Fade' }];
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  const FADE = 0.5; // dĺžka roztmievania/stmievania úseku
  const FG_GAME = '<svg viewBox="0 0 16 16"><path d="M4.6 5h6.8a2.6 2.6 0 0 1 2.5 1.9l.9 3.3a1.7 1.7 0 0 1-2.9 1.6L10.6 10.5H5.4l-1.3 1.3a1.7 1.7 0 0 1-2.9-1.6l.9-3.3A2.6 2.6 0 0 1 4.6 5Z" fill="currentColor"/><path d="M5 6.7v2M4 7.7h2" stroke="#000" stroke-width="1.1" stroke-linecap="round"/></svg>';
  const FG_SCREEN = '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 13.5h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ASPECTS = {
    orig: { l: 'Pôvodný formát', short: 'Pôvodný', r: 0 },
    '9:16': { l: 'Na výšku 9:16', short: '9:16', r: 9 / 16, sub: 'TikTok, Shorts, Reels' },
    '1:1': { l: 'Štvorec 1:1', short: '1:1', r: 1, sub: 'Instagram, Discord' },
    '4:5': { l: 'Na výšku 4:5', short: '4:5', r: 4 / 5, sub: 'Instagram príspevok' }
  };
  const SAVE_SIZES = [{ v: 0, l: 'Pôvodná kvalita' }, { v: 20, l: '20 MB · Discord' }, { v: 10, l: '10 MB' }, { v: 50, l: '50 MB · Nitro Basic' }];
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const easeOut = p => 1 - Math.pow(1 - p, 3);
  const backOut = p => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
  /* stav animácie overlayu v čase (rovnaké krivky ako pri uložení v ffmpeg) */
  function animState(o, time, H) {
    let op = 1, sc = 1, dy = 0;
    const ai = o.animIn || 'none', ao = o.animOut || 'none';
    if (ai !== 'none') {
      op *= clamp01((time - o.start) / (ai === 'pop' ? 0.2 : 0.35));
      if (ai === 'pop') sc = 0.5 + 0.5 * backOut(clamp01((time - o.start) / 0.35));
      if (ai === 'slide') dy = Math.pow(1 - clamp01((time - o.start) / 0.4), 3) * H * 0.05;
    }
    if (ao === 'fade') op *= clamp01((o.end - time) / 0.3);
    return { op, sc, dy };
  }
  const mctx = document.createElement('canvas').getContext('2d');
  /* rozmery textu (rovnaké meranie pre SVG aj PNG) */
  function textMetrics(o) {
    const f = FONTS[o.font] || FONTS.inter;
    mctx.font = `${f.w} ${o.size}px ${f.css}`;
    const txt = o.upper ? (o.text || '').toUpperCase() : (o.text || '');
    const w = mctx.measureText(txt || ' ').width;
    return { txt, w, h: o.size * 1.2, f, padX: o.size * 0.42, padY: o.size * 0.22 };
  }
  const IC = {
    select: '<svg viewBox="0 0 20 20"><path d="M5 3l10 6.5-4.6 1L8.5 15z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    text: '<svg viewBox="0 0 20 20"><path d="M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrow: '<svg viewBox="0 0 20 20"><path d="M4 16 15.5 4.5M8.5 4.5h7v7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    spk: '<svg viewBox="0 0 20 20"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 7a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 20 20"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    save: '<svg viewBox="0 0 20 20"><path d="M10 3v9.5M6 8.5l4 4 4-4M4 15.5h12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    split: '<svg viewBox="0 0 20 20"><path d="M10 2.5v15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2.2 2.6"/><path d="M3 6.5h4.5v7H3M17 6.5h-4.5v7H17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    del: '<svg viewBox="0 0 20 20"><rect x="3" y="6" width="14" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8.5l4 3M12 8.5l-4 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    add: '<svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    undo: '<svg viewBox="0 0 20 20"><path d="M7 5 3.5 8.5 7 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    redo: '<svg viewBox="0 0 20 20"><path d="M13 5l3.5 3.5L13 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 8.5H8.5a4.5 4.5 0 0 0 0 9H11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    trimL: '<svg viewBox="0 0 20 20"><path d="M6 3v14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M9.5 6.5h7v7h-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3 8.5l2 1.5-2 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trimR: '<svg viewBox="0 0 20 20"><path d="M14 3v14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M10.5 6.5h-7v7h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M17 8.5l-2 1.5 2 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dup: '<svg viewBox="0 0 20 20"><rect x="6.5" y="6.5" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13.5 4.5v-.5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v7A1.5 1.5 0 0 0 5 12.5h.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    reset: '<svg viewBox="0 0 20 20"><path d="M4 10a6 6 0 1 0 2-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 3.5v3.5H7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    magnet: '<svg viewBox="0 0 20 20"><path d="M4.5 3.5v6.5a5.5 5.5 0 0 0 11 0V3.5h-3.6V10a1.9 1.9 0 0 1-3.8 0V3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4.5 7h3.6M11.9 7h3.6" stroke="currentColor" stroke-width="1.6"/></svg>',
    more: '<svg viewBox="0 0 20 20"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>',
    kbd: '<svg viewBox="0 0 20 20"><rect x="2.5" y="5" width="15" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 8h1M9.5 8h1M13.5 8h1M6.5 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    back: '<svg viewBox="0 0 20 20"><path d="M12 4.5 6.5 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 20 20"><rect x="6.5" y="6.5" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13.5 4.5v-.5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v7A1.5 1.5 0 0 0 5 12.5h.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    zoom: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12.3 12.3 17 17M6.5 8.5h4M8.5 6.5v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };

  /* geometria šípky: rovnaká pre SVG v editore aj pre canvas pri uložení */
  function arrowGeom(o) {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, w = o.size;
    const head = Math.min(len * 0.6, w * 3.4), hw = w * 2.1;
    const bx = o.x2 - ux * head, by = o.y2 - uy * head;
    return { x1: o.x1, y1: o.y1, bx: bx + ux * w * 0.3, by: by + uy * w * 0.3, tip: [o.x2, o.y2], l: [bx - uy * hw, by + ux * hw], r: [bx + uy * hw, by - ux * hw], w };
  }
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('clipit.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('clipit.' + k, JSON.stringify(v)); } catch (e) { } }
  };
  const KEYS = [
    ['Prehrávanie', [['Medzerník', 'Prehrať / pozastaviť'], ['← →', 'Posun o 10 snímok (Shift = 1 s, Alt = 1 snímka)'], ['Home / End', 'Na začiatok / koniec'], ['M / Shift+M', 'Na ďalšiu / predošlú značku'], ['F', 'Celá obrazovka']]],
    ['Strih', [['S', 'Rozdeliť na pozícii prehrávania'], ['Q', 'Odstrihnúť všetko pred prehrávaním'], ['W', 'Odstrihnúť všetko za prehrávaním'], ['Ctrl+D', 'Duplikovať úsek'], ['Delete', 'Odstrániť vybraný úsek alebo objekt']]],
    ['Text a šípky', [['T', 'Text (klikni do videa)'], ['A', 'Šípka (ťahaj vo videu)'], ['Koliesko', 'Nad objektom mení veľkosť'], ['Dvojklik', 'Na text = upraviť ho']]],
    ['Ostatné', [['Ctrl+Z / Ctrl+Y', 'Späť / znova'], ['Ctrl + koliesko', 'Priblížiť časovú os'], ['N', 'Prichytávanie zap. / vyp. (Alt pri ťahaní ho dočasne vypne)'], ['Esc', 'Zrušiť výber']]]
  ];

  /* clips: jeden klip alebo pole klipov (poradie = poradie na osi); opts.library() vráti klipy z knižnice */
  let openEd = 0; // počet otvorených editorov (okno appky sa vtedy na pozadí nezatvára)
  let curCleanup = null; // upratanie práve otvoreného editora
  function open(clips, opts = {}) {
    // druhé otvorenie (dvojklik, klik + Enter…): predošlý editor najprv úplne uprac, inak by jeho video hralo
    // na pozadí a písal by do toho istého okna (dlhšia časová os)
    if (curCleanup) { try { curCleanup(); } catch (e) { } }
    openEd++;
    clips = (Array.isArray(clips) ? clips : [clips]).map(c => ({ ...c }));
    const sources = new Map();
    let segs = [], overlays = [], mixer = [], T = 0, titles = [];
    let selSeg = null, sel = null, tool = 'select', keepTracks = false, saving = false, tab = 'text';
    let t = 0, playing = false, active = null; // active = { seg, src }
    let SW = 1920, SH = 1080, RG = null, rgEdit = null; // SW×SH = celý záznam, RG = výrez oblasti (0–1), napr. len okno hry
    let W = 1920, H = 1080, FPS = 60, OW = 1920, aspect = 'orig'; // OW = šírka výsledku (pri výreze na výšku užšia)
    let pps = 0, fitPps = 0, seq = 0, saveMB = 0, savedSnap = null, snapOn = LS.get('snap', true), closed = false;
    const meterDisp = [];
    const undoStack = [], redoStack = [];
    const single = () => sources.size === 1 && segs.length > 0;
    /* všetky <video>/<audio> tohto editora. Pri zatvorení sa zastavia a uvoľnia, aj tie, čo vzniknú až neskôr
       (zvukové stopy sa dorábajú asynchrónne, a keď editor zavrieš skôr, zostali by hrať na pozadí) */
    const media = new Set();
    const killMedia = el => { try { el._dead = true; el.pause(); el.removeAttribute('src'); el.load(); } catch (e) { } };
    const own = el => { media.add(el); if (closed) killMedia(el); return el; };

    const m = modal(`
      <div class="ed">
        <header class="ed-top">
          <div class="ed-name" id="titleRow"></div>
          <div class="ed-hist">
            <button class="ed-ico" id="bUndo" title="Späť (Ctrl+Z)" disabled>${IC.undo}</button>
            <button class="ed-ico" id="bRedo" title="Znova (Ctrl+Y)" disabled>${IC.redo}</button>
          </div>
          <span class="grow"></span>
          <button class="ed-ico" id="bHelp" title="Klávesové skratky (?)">${IC.kbd}</button>
          <span id="srcActions"></span>
          <span class="save-size" id="fmtPb"></span>
          <span class="save-size" id="saveSize"></span>
          <button class="btn ed-adv" id="bAdv" title="Preniesť do advanced editora (viac stôp, hudba, shorty)"><svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 14.5h6M3 17h9M12 14.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Advanced</span></button>
          <button class="btn primary ed-save" id="plSave">${IC.save}<span>Uložiť</span></button>
          <button class="ed-ico ed-x" id="plClose" aria-label="Zavrieť" title="Zavrieť">${I.x}</button>
        </header>
        <div class="ed-main">
          <div class="ed-stage" id="stage">
            <div class="ed-frame" id="frame">
              <div class="ed-videos" id="vids"></div>
              <div class="ed-fade" id="fadeV"></div>
              <svg class="ed-ov" id="ov" preserveAspectRatio="none"></svg>
            </div>
            <div class="ed-hint" id="hint" hidden></div>
            <div class="ed-flash" id="flash"></div>
            <div class="ed-fs" id="fsBar"><button class="fs-play" id="fsPlay">${I.play}</button><span class="fs-time" id="fsTime"></span><div class="fs-prog" id="fsProg"><i id="fsFill"></i></div>${UI.volCtl()}<button class="fs-exit" id="fsExit" title="Zavrieť celú obrazovku (Esc)"><svg viewBox="0 0 16 16"><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
            <div class="ed-loading" id="loading"><div class="mx-load"><i></i><i></i><i></i></div><span>Pripravujem klip…</span></div>
          </div>
          <aside class="ed-side">
            <div class="ed-tabs" id="tabs">
              <button data-tab="text">${IC.text}<span>Text</span></button>
              <button data-tab="seg">${IC.split}<span>Úsek</span></button>
              <button data-tab="audio">${IC.spk}<span>Zvuk</span></button>
              <i class="ed-tabs-ind"></i>
            </div>
            <div class="ed-pane" id="paneText"><div id="insp"></div></div>
            <div class="ed-pane" id="paneSeg" hidden></div>
            <div class="ed-pane" id="paneAudio" hidden>
              <div class="ed-ph"><span class="ed-sub" id="trSub">Pripravujem stopy…</span></div>
              <div id="mixer"><div class="mx-load"><i></i><i></i><i></i></div></div>
              <label class="mx-keep"><span>Do nového klipu pridať aj všetky pôvodné stopy (pre strihový program)</span><span class="toggle sm"><input type="checkbox" id="keep"></span></label>
            </div>
          </aside>
        </div>
        <div class="ed-bar">
          <button class="pl-play" id="plPlay" aria-label="Prehrať (medzerník)">${I.play}</button>
          <span class="pl-time" id="plTime">0:00.00 <i>/ 0:00</i></span>
          <button class="ed-tb ed-hq${UI.previewFull() ? ' on' : ''}" id="hqBtn" title="Náhľad v plnej kvalite (inak rýchla kópia v 720p). Na uložené video to nemá vplyv."><svg viewBox="0 0 16 16"><rect x="1.8" y="3.5" width="12.4" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.6 6.2v3.6M7 6.2v3.6M4.6 8h2.4M9.2 6.2v3.6h1.2a1.8 1.8 0 0 0 0-3.6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Plná kvalita</span></button>
          <button class="ed-tb ed-fsb2" id="fsBtn" title="Prehrať na celú obrazovku (F)"><svg viewBox="0 0 16 16"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Celá obrazovka</span></button>
          ${UI.volCtl()}
          <span class="ed-sep"></span>
          <div class="ed-tools">
            <button class="ed-tb" id="bSplit" title="Rozdeliť na pozícii prehrávania (S)">${IC.split}<span>Rozdeliť</span></button>
            <button class="ed-tb" id="bTrimL" title="Odstrihnúť všetko pred prehrávaním (Q)">${IC.trimL}<span>Orezať začiatok</span></button>
            <button class="ed-tb" id="bTrimR" title="Odstrihnúť všetko za prehrávaním (W)">${IC.trimR}<span>Orezať koniec</span></button>
            <button class="ed-tb" id="bDelSeg" title="Odstrániť vybraný úsek (Delete)" disabled>${IC.del}<span>Odstrániť</span></button>
          </div>
          <span class="ed-sep"></span>
          <button class="ed-tb" id="bAdd" title="Pridať ďalší klip na koniec">${IC.add}<span>Pridať klip</span></button>
          <span class="grow"></span>
          <span class="trim-info" id="info"></span>
          <button class="ed-ico${snapOn ? ' on' : ''}" id="bSnap" title="Prichytávanie k okrajom (N)">${IC.magnet}</button>
          <span class="ed-zoom">${IC.zoom}<input type="range" id="zoom" min="0" max="100" value="0" title="Priblíženie (Ctrl + koliesko)"></span>
        </div>
        <div class="tlx-scroll" id="tlScroll">
          <div class="tlx" id="tlx">
            <div class="tlx-ruler" id="ruler"></div>
            <div class="tlx-lane tlx-video" id="laneV"></div>
            <div class="tlx-lane tlx-audio" id="laneA"></div>
            <div class="tlx-ovs" id="laneO"></div>
            <div class="tlx-hov" id="hov" hidden><b></b></div>
            <div class="tlx-snap" id="snapLine" hidden></div>
            <div class="tlx-head" id="head"><i></i></div>
            <div class="tlx-drop" id="drop" hidden></div>
            <div class="tlx-tip" id="tlTip" hidden></div>
          </div>
        </div>
        <div class="ed-layer" id="picker" hidden></div>
      </div>`, 'editor', cleanup, beforeClose);
    curCleanup = cleanup;

    const ov = $('#ov', m), stage = $('#stage', m), vids = $('#vids', m), frame = $('#frame', m);
    const tlx = $('#tlx', m), scroller = $('#tlScroll', m), layer = $('#picker', m);

    /* ================= zdroje ================= */
    async function addSource(clip) {
      if (sources.has(clip.path)) return sources.get(clip.path);
      const src = { ...clip, idx: sources.size, c: SRC_C[sources.size % SRC_C.length], tracks: [], audios: [], ready: false, duration: clip.duration || 0, frames: [] };
      const v = document.createElement('video');
      v.preload = 'auto'; v.muted = true; v.src = fileUrl(clip.path);
      vids.appendChild(v);
      src.video = v; own(v);
      UI.useProxy(v, clip.path); // náhľadová kópia s častými kľúčovými snímkami → okamžitý skok
      sources.set(clip.path, src);
      const meta = new Promise(res => {
        v.addEventListener('loadedmetadata', () => { src.duration = v.duration || src.duration; src.width = v.videoWidth; src.height = v.videoHeight; res(); }, { once: true });
        v.addEventListener('error', () => res(), { once: true });
      });
      try {
        const r = await api.action('extractTracks', { path: clip.path });
        if (closed) return src; // editor sa medzitým zavrel: žiadne nové prehrávače
        src.tracks = r.tracks || [];
        src.fps = r.fps || 60;
        if (!src.duration) src.duration = r.duration;
        // rozmery a dĺžka vždy z pôvodného súboru (video v náhľade môže byť menšia náhľadová kópia)
        if (r.width && r.height) { src.width = r.width; src.height = r.height; }
        if (r.duration) src.duration = r.duration;
        src.audios = src.tracks.map(tr => { const a = new Audio(fileUrl(tr.file)); a.preload = 'auto'; return own(a); });
        // obálka hlasitosti (20 hodnôt za sekundu) pre metre v mixéri a priebeh zvuku na osi
        src.levels = src.tracks.map(tr => { try { return tr.levels ? Uint8Array.from(atob(tr.levels), c => c.charCodeAt(0)) : null; } catch (e) { return null; } });
        src.ready = true;
      } catch (e) { src.ready = false; src.trackErr = e.message; }
      await meta;
      if (closed) return src;
      makeFrames(src);
      return src;
    }
    /* filmový pás na osi: snímky z klipu (vlastné video, aby nerušilo prehrávanie) */
    async function makeFrames(src) {
      const D = src.duration; if (!D || !src.width) return;
      const n = Math.max(6, Math.min(48, Math.ceil(D / 0.75)));
      const fv = document.createElement('video');
      fv.muted = true; fv.preload = 'auto'; fv.src = fileUrl(src.path); own(fv);
      try { await new Promise((res, rej) => { fv.addEventListener('loadeddata', res, { once: true }); fv.addEventListener('error', rej, { once: true }); }); } catch (e) { killMedia(fv); return; }
      if (closed) { killMedia(fv); return; }
      const fh = 72, fw = Math.round(fh * src.width / src.height);
      src.frames = new Array(n);
      for (let k = 0; k < n && !closed; k++) {
        await new Promise(res => { const done = () => res(); fv.addEventListener('seeked', done, { once: true }); setTimeout(done, 1500); fv.currentTime = Math.min(D - 0.05, (k + 0.5) * D / n); });
        const c = document.createElement('canvas'); c.width = fw; c.height = fh;
        try { c.getContext('2d').drawImage(fv, 0, 0, fw, fh); src.frames[k] = c; } catch (e) { }
        if (k % 6 === 5 || k === n - 1) drawFilms(src);
      }
      fv.removeAttribute('src'); fv.load();
    }

    async function init() {
      for (const c of clips) {
        const src = await addSource(c);
        if (closed) return;
        segs.push({ id: 's' + (++seq), src: src.path, in: 0, out: src.duration || 0.1 });
      }
      if (closed || !segs.length) return;
      const first = sources.get(segs[0].src);
      SW = (first.width || 1920); SH = (first.height || 1080); FPS = first.fps || 60;
      // automatický výrez okna hry (nastavenie); vráti sa cez Formát → Celá obrazovka
      if (opts.autoWin) { const wr = winRegion(); if (wr) RG = { x: wr.x, y: wr.y, w: wr.w, h: wr.h }; }
      dims(); layoutFrame(); renderFormat();
      // čierne okraje v zázname (hra na inom pomere strán): ponúkne sa „Orezať čierne okraje“
      api.action('detectBars', { path: first.path }).then(b => { if (b && !closed) { first.bars = b; renderFormat(); } }).catch(() => { });
      rebuildTracks();
      $('#loading', m).classList.add('gone');
      fitZoom(); renderAll(); seek(0);
      savedSnap = snap();
      if (clips.length === 1 && !closed) play();
    }

    /* stopy: berieme podľa poradia; názvy z klipu, ktorý ich má najviac */
    function rebuildTracks() {
      let best = null;
      for (const s of sources.values()) if (!best || s.tracks.length > best.tracks.length) best = s;
      const old = mixer;
      T = best ? best.tracks.length : 0;
      titles = best ? best.tracks.map(x => x.title) : [];
      const hasMix = /^mix/i.test(titles[0] || '');
      mixer = titles.map((title, i) => old[i] ? old[i] : { i, title, on: hasMix ? i === 0 : true, vol: 1, c: TRACK_C[i % TRACK_C.length] });
      renderMixer();
    }

    /* ================= čas ↔ úsek ================= */
    const sp = s => s.speed || 1;
    const sd = s => (s.out - s.in) / sp(s);     // dĺžka úseku na výslednej osi (po zmene rýchlosti)
    const total = () => segs.reduce((a, s) => a + sd(s), 0);
    function segStart(seg) { let a = 0; for (const s of segs) { if (s === seg) return a; a += sd(s); } return a; }
    function locate(time) {
      let a = 0;
      for (const s of segs) { const d = sd(s); if (time < a + d - 1e-4) return { seg: s, start: a, local: s.in + (time - a) * sp(s) }; a += d; }
      const s = segs[segs.length - 1];
      return s ? { seg: s, start: a - sd(s), local: s.out } : null;
    }
    /* koľko je obraz stmavený (0–1) kvôli roztmievaniu/stmievaniu úseku */
    function fadeAt(time) {
      const L = locate(time); if (!L) return 0;
      const tt = time - L.start, D = sd(L.seg), F = Math.min(FADE, D / 3);
      if (L.seg.fadeIn && tt < F) return 1 - tt / F;
      if (L.seg.fadeOut && D - tt < F) return 1 - (D - tt) / F;
      return 0;
    }
    const fmtX = v => String(v).replace('.', ',') + '×';
    const plural = (n, a, b, c) => n === 1 ? a : n > 1 && n < 5 ? b : c;

    /* ================= formát a výrez ================= */
    function outW(a = aspect) { const r = ASPECTS[a].r; if (!r) return W; const cw = Math.round(H * r / 2) * 2; return cw < W ? cw : W; }
    const cropped = () => OW < W;
    // ľavý okraj výrezu v pixeloch zdroja; cx = stred výrezu 0–1 (každý úsek má vlastný)
    const cropLeft = seg => Math.max(0, Math.min(W - OW, (seg && seg.cx != null ? seg.cx : 0.5) * W - OW / 2));
    let fk = 1; // px na obrazovke / px videa
    function dims() {
      if (RG) { W = Math.max(16, Math.round(SW * RG.w / 2) * 2); H = Math.max(16, Math.round(SH * RG.h / 2) * 2); }
      else { W = SW; H = SH; }
      if (aspect !== 'orig' && outW(aspect) >= W) aspect = 'orig';
      OW = outW();
    }
    function layoutFrame() {
      // clientWidth/Height = skutočný rozmer bez transformácie (getBoundingClientRect počas nábehovej animácie okna vracia zmenšený
      // rozmer a ResizeObserver sa potom už neozve → video zostalo menšie s čiernym okrajom vpravo)
      const r = { width: stage.clientWidth, height: stage.clientHeight }; if (!r.width) return;
      const ed = !!rgEdit, A = ed ? SW / SH : OW / H, pad = ed ? 64 : 0, avH = r.height - pad, avW = r.width - (ed ? 24 : 0);
      let fw = avW, fh = fw / A;
      if (fh > avH) { fh = avH; fw = fh * A; }
      fk = fh / (ed ? SH : H);
      Object.assign(frame.style, { width: fw + 'px', height: fh + 'px', left: (r.width - fw) / 2 + 'px', top: pad + (avH - fh) / 2 - (ed ? 8 : 0) + 'px' });
      vids.style.width = SW * fk + 'px'; vids.style.height = SH * fk + 'px';
      ov.setAttribute('viewBox', `0 0 ${OW} ${H}`);
      stage.classList.toggle('cropmode', cropped() && !ed);
      stage.classList.toggle('rgmode', ed);
      placeCanvas(); drawOverlays();
      if (ed) placeRgBox();
    }
    function placeCanvas(seg) {
      seg = seg || (active ? active.seg : segs[0]);
      if (rgEdit) { vids.style.transform = 'none'; return; }
      const rx = RG ? RG.x * SW : 0, ry = RG ? RG.y * SH : 0;
      vids.style.transform = `translate(${-(rx + cropLeft(seg)) * fk}px, ${-ry * fk}px)`;
    }
    new ResizeObserver(() => layoutFrame()).observe(stage);
    function setAspect(a) {
      if (a === aspect) return;
      remember();
      const old = OW;
      aspect = a; OW = outW();
      // text a šípky posuň tak, aby zostali na rovnakom mieste obrazu (výrez je na stred); pridlhý text zmenši
      const d = (old - OW) / 2, cl = x => Math.max(0, Math.min(OW, x - d));
      overlays.forEach(o => {
        if (o.type === 'text') {
          o.x = cl(o.x);
          const M = textMetrics(o); if (M.w > OW * 0.9) o.size = Math.max(12, Math.floor(o.size * OW * 0.9 / M.w));
          const M2 = textMetrics(o); o.x = Math.max(M2.w / 2 + 8, Math.min(OW - M2.w / 2 - 8, o.x));
        } else { o.x1 = cl(o.x1); o.x2 = cl(o.x2); }
      });
      layoutFrame(); renderFormat(); renderInspector();
      if (tab === 'seg') renderSegPane();
      if (cropped()) showHint('Ťahaj video do strán a vyber, čo bude vidieť', 3200);
    }
    let hintT = 0;
    function showHint(txt, ms) {
      const h = $('#hint', m); clearTimeout(hintT);
      h.hidden = false; h.innerHTML = txt;
      hintT = setTimeout(() => { if (tool === 'select') h.hidden = true; }, ms);
    }
    function renderFormat() {
      const cur = ASPECTS[aspect];
      const r = cur.r || W / H, bw = r >= 1 ? 14 : 14 * r, bh = r >= 1 ? 14 / r : 14;
      $('#fmtPb', m).innerHTML = `<button type="button" class="pb fmt${aspect !== 'orig' || RG ? ' on' : ''}" id="fmtBtn" title="Formát videa (na výšku pre TikTok a Shorts)"><svg viewBox="0 0 16 16"><rect x="${(16 - bw) / 2}" y="${(16 - bh) / 2}" width="${bw}" height="${bh}" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span>${esc(RG ? (aspect === 'orig' ? 'Výrez' : cur.short + ' · výrez') : cur.short)}</span>${I.chev}</button>`;
      $('#fmtBtn', m).onclick = e => {
        const wr = winRegion(), same = (a, b) => a && b && ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) < 0.002);
        const items = Object.entries(ASPECTS).map(([k, x]) => ({ label: x.l, v: k, checked: k === aspect, sub: (k === 'orig' ? `${W}×${H}` : `${outW(k)}×${H}`) + (x.sub ? ' · ' + x.sub : ''), disabled: k !== 'orig' && outW(k) >= W }));
        items.push({ sep: true }, { head: 'Oblasť záznamu' });
        if (wr) items.push({ label: 'Len okno hry', v: '@win', checked: same(RG, wr), sub: `${Math.round(SW * wr.w)}×${Math.round(SH * wr.h)}` });
        else items.push({ label: 'Len okno hry', disabled: true, sub: 'len pri hre v okne, klipy od verzie 1.0.8' });
        const bars = barsRegion();
        if (bars) items.push({ label: 'Orezať čierne okraje', v: '@bars', checked: same(RG, bars), sub: `${Math.round(SW * bars.w / 2) * 2}×${Math.round(SH * bars.h / 2) * 2}` });
        items.push({ label: 'Celá obrazovka', v: '@full', checked: !RG, sub: `${SW}×${SH}` }, { label: 'Vlastný výrez…', v: '@edit', checked: !!RG && !same(RG, wr) });
        UI.menu(e.currentTarget, items, it => {
          if (it.v === '@win') setRegion({ x: wr.x, y: wr.y, w: wr.w, h: wr.h });
          else if (it.v === '@bars') setRegion({ ...bars });
          else if (it.v === '@full') setRegion(null);
          else if (it.v === '@edit') editRegion();
          else setAspect(it.v);
        });
      };
    }
    /* ---------- oblasť záznamu (napr. hra v okne 16:9 na širokom monitore) ---------- */
    function winRegion() {
      for (const sg of segs) { const src = sources.get(sg.src); if (src && src.win && src.win.w) return src.win; }
      return null;
    }
    function barsRegion() { const src = segs[0] && sources.get(segs[0].src); return src && src.bars ? src.bars : null; }
    function setRegion(rg, noUndo) {
      if (JSON.stringify(rg) === JSON.stringify(RG)) return;
      if (!noUndo) remember();
      const oOW = OW, oH = H;
      RG = rg; dims();
      // text a šípky ostanú na rovnakom mieste výsledku (pomerne)
      const kx = OW / oOW, ky = H / oH;
      overlays.forEach(o => {
        if (o.type === 'text') { o.x *= kx; o.y *= ky; o.size = Math.max(12, Math.round(o.size * ky)); }
        else { o.x1 *= kx; o.x2 *= kx; o.y1 *= ky; o.y2 *= ky; o.size = Math.max(2, Math.round(o.size * ky)); }
      });
      layoutFrame(); renderFormat(); renderInspector();
      if (tab === 'seg') renderSegPane();
    }
    let rgBox = null;
    function placeRgBox() {
      if (!rgBox || !rgEdit) return;
      const fw = SW * fk, fh = SH * fk;
      Object.assign(rgBox.querySelector('.rg-r').style, { left: rgEdit.x * fw + 'px', top: rgEdit.y * fh + 'px', width: rgEdit.w * fw + 'px', height: rgEdit.h * fh + 'px' });
      rgBox.querySelector('.rg-r b').textContent = `${Math.round(SW * rgEdit.w / 2) * 2} × ${Math.round(SH * rgEdit.h / 2) * 2}`;
    }
    function editRegion() {
      if (playing) pause();
      rgEdit = RG ? { ...RG } : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      const wr = winRegion();
      rgBox = document.createElement('div');
      rgBox.className = 'rg-wrap';
      rgBox.innerHTML = `<div class="rg-r"><b></b>${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(h => `<i class="rg-h ${h}" data-h="${h}"></i>`).join('')}</div>`;
      frame.appendChild(rgBox);
      const bar = document.createElement('div');
      bar.className = 'rg-bar';
      bar.innerHTML = `<span>Ťahaj rámik alebo jeho rohy</span>${wr ? '<button class="btn" data-a="win">Okno hry</button>' : ''}<button class="btn" data-a="full">Celá obrazovka</button><button class="btn" data-a="no">Zrušiť</button><button class="btn primary" data-a="ok">Hotovo</button>`;
      stage.appendChild(bar);
      const finish = ok => {
        const r = rgEdit; rgEdit = null; rgBox.remove(); rgBox = null; bar.remove();
        if (ok) setRegion(r.w > 0.995 && r.h > 0.995 ? null : { x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +r.w.toFixed(4), h: +r.h.toFixed(4) });
        else layoutFrame();
      };
      bar.addEventListener('click', e => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'win') { rgEdit = { x: wr.x, y: wr.y, w: wr.w, h: wr.h }; placeRgBox(); }
        else if (a.dataset.a === 'full') { rgEdit = { x: 0, y: 0, w: 1, h: 1 }; placeRgBox(); }
        else finish(a.dataset.a === 'ok');
      });
      rgBox.addEventListener('pointerdown', e => {
        const r = rgBox.querySelector('.rg-r');
        if (!r.contains(e.target)) return;
        e.stopPropagation(); e.preventDefault();
        const h = e.target.dataset.h || 'move', x0 = e.clientX, y0 = e.clientY, g0 = { ...rgEdit };
        const fw = SW * fk, fh = SH * fk, MIN = 0.1;
        r.setPointerCapture(e.pointerId);
        const move = ev => {
          const dx = (ev.clientX - x0) / fw, dy = (ev.clientY - y0) / fh;
          let { x, y, w, h: hh } = g0;
          if (h === 'move') { x = Math.max(0, Math.min(1 - w, x + dx)); y = Math.max(0, Math.min(1 - hh, y + dy)); }
          else {
            if (h.includes('w')) { const nx = Math.max(0, Math.min(x + w - MIN, x + dx)); w += x - nx; x = nx; }
            if (h.includes('e')) w = Math.max(MIN, Math.min(1 - x, w + dx));
            if (h.includes('n')) { const ny = Math.max(0, Math.min(y + hh - MIN, y + dy)); hh += y - ny; y = ny; }
            if (h.includes('s')) hh = Math.max(MIN, Math.min(1 - y, hh + dy));
          }
          rgEdit = { x, y, w, h: hh }; placeRgBox();
        };
        const up = () => { r.removeEventListener('pointermove', move); r.removeEventListener('pointerup', up); };
        r.addEventListener('pointermove', move); r.addEventListener('pointerup', up);
      });
      layoutFrame();
    }
    function setCx(seg, cx) { seg.cx = Math.max(0, Math.min(1, cx)); if (Math.abs(seg.cx - 0.5) < 0.004) seg.cx = 0.5; placeCanvas(); }

    /* ================= prehrávanie ================= */
    function activate(seg, local, autoplay) {
      if (closed) return;
      const src = sources.get(seg.src);
      if (!active || active.src !== src) {
        if (active) { active.src.video.pause(); active.src.video.classList.remove('on'); active.src.audios.forEach(a => a.pause()); active.src.video.muted = true; }
        src.video.classList.add('on');
      }
      active = { seg, src };
      placeCanvas();
      src.video.playbackRate = sp(seg);
      src.audios.forEach(a => { a.playbackRate = sp(seg); });
      const vv = src.video, cur = vv._target != null && (vv.seeking || Math.abs(vv.currentTime - vv._target) < 0.05) ? vv._target : vv.currentTime;
      if (Math.abs(cur - local) > 0.04) UI.smoothSeek(vv, local); // pri ťahaní sa skoky nezhromažďujú
      src.video.muted = src.ready && src.audios.length > 0; // bez vytiahnutých stôp hrá zvuk priamo z videa
      syncAudio(true);
      if (autoplay) src.video.play().catch(() => { });
    }
    function syncAudio(force) {
      if (closed || !active) return;
      const { src } = active, v = src.video;
      const ff = 1 - fadeAt(t);
      const pv = UI.pvol();
      if (!v.muted) v.volume = Math.min(1, ff * pv);
      src.audios.forEach((a, i) => {
        const mx = mixer[i];
        a.volume = mx && mx.on ? Math.min(1, Math.min(1, mx.vol) * ff * pv) : 0;
        // posun stopy voči obrazu (kladný = stopa meškala → hrá sa zvuk o kúsok neskôr)
        const vt = v.seeking && v._want != null ? v._want : v.currentTime; // video ešte hľadá → zvuk podľa cieľa
        const target = Math.max(0, vt + ((mx && mx.off) || 0) / 1000);
        if (force || Math.abs(a.currentTime - target) > 0.12) { try { a.currentTime = target; } catch (e) { } }
        if (playing && a.paused && a.volume > 0) a.play().catch(() => { });
        if (!playing && !a.paused) a.pause();
      });
    }
    function play() {
      if (closed || !segs.length) return;
      if (t >= total() - 0.05) t = 0;
      playing = true;
      const L = locate(t);
      activate(L.seg, L.local, true);
      $('#plPlay', m).innerHTML = I.pause; $('#fsPlay', m).innerHTML = I.pause;
      loop(); wakeMeters();
    }
    function pause() {
      playing = false;
      if (active) { active.src.video.pause(); active.src.audios.forEach(a => a.pause()); }
      $('#plPlay', m).innerHTML = I.play; $('#fsPlay', m).innerHTML = I.play;
      layoutHead(); drawOverlays();
    }
    const toggle = () => (playing ? pause() : play());
    let raf = 0;
    function loop() {
      cancelAnimationFrame(raf);
      const f = () => {
        if (closed || !playing || !active) return;
        const { seg, src } = active, v = src.video;
        if (v.currentTime >= seg.out - 0.02 || v.ended) {
          // koniec úseku → ďalší
          const i = segs.indexOf(seg);
          if (i < 0 || i >= segs.length - 1) { t = total(); pause(); return; }
          const next = segs[i + 1];
          t = segStart(next);
          activate(next, next.in, true);
        } else {
          t = segStart(seg) + Math.max(0, v.currentTime - seg.in) / sp(seg);
          // dopredu priprav ďalší úsek z iného klipu
          const i = segs.indexOf(seg), next = segs[i + 1];
          if (next && next.src !== seg.src && (seg.out - v.currentTime) / sp(seg) < 0.8) { const nv = sources.get(next.src).video; if (Math.abs(nv.currentTime - next.in) > 0.1) nv.currentTime = next.in; }
          syncAudio();
        }
        layoutHead(); drawOverlays();
        if (tab === 'seg') updSegPaneLive();
        raf = requestAnimationFrame(f);
      };
      raf = requestAnimationFrame(f);
    }
    function seek(time, keepPlaying = playing) {
      t = Math.max(0, Math.min(total(), time));
      const L = locate(t);
      if (L) activate(L.seg, L.local, keepPlaying);
      layoutHead(); drawOverlays();
      if (tab === 'seg') updSegPaneLive();
    }
    function flashIcon(icon) {
      const f = $('#flash', m);
      f.innerHTML = icon; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    }
    $('#plPlay', m).onclick = toggle;

    /* ================= história (Späť / Znova) ================= */
    const snap = () => JSON.stringify({ segs, overlays, aspect, RG });
    function remember() { undoStack.push(snap()); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; updUndo(); }
    function restore(json) {
      const d = JSON.parse(json);
      segs = d.segs; overlays = d.overlays;
      if ((d.aspect || 'orig') !== aspect || JSON.stringify(d.RG || null) !== JSON.stringify(RG)) { aspect = d.aspect || 'orig'; RG = d.RG || null; dims(); layoutFrame(); renderFormat(); }
      selSeg = selSeg && segs.find(s => s.id === selSeg.id) || null;
      sel = sel && overlays.find(o => o.id === sel.id) || null;
      refit(300); renderAll(); seek(Math.min(t, total()), false);
    }
    function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); updUndo(); }
    function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); updUndo(); }
    function updUndo() { $('#bUndo', m).disabled = !undoStack.length; $('#bRedo', m).disabled = !redoStack.length; }
    $('#bUndo', m).onclick = undo; $('#bRedo', m).onclick = redo;
    const dirty = () => savedSnap != null && snap() !== savedSnap;

    /* ================= strihové operácie ================= */
    function split() {
      const L = locate(t); if (!L) return;
      const { seg, local } = L;
      if (local - seg.in < 0.15 || seg.out - local < 0.15) { toast('info', 'Tu sa nedá deliť', 'Posuň prehrávanie ďalej od okraja úseku.'); return; }
      remember();
      const right = { id: 's' + (++seq), src: seg.src, in: local, out: seg.out, speed: seg.speed, fadeOut: seg.fadeOut, cx: seg.cx };
      seg.out = local; seg.fadeOut = false;
      segs.splice(segs.indexOf(seg) + 1, 0, right);
      selSeg = right;
      renderAll(); seek(t, false);
      flash(right.id);
    }
    /* Q / W: odstrihni všetko pred / za prehrávaním v úseku pod ním (najčastejší strih klipu) */
    function trimTo(side) {
      const L = locate(t); if (!L) return;
      const { seg, local } = L;
      if (side === 'l' ? local - seg.in < 0.05 : seg.out - local < 0.05) return;
      if (side === 'l' ? seg.out - local < 0.2 : local - seg.in < 0.2) { toast('info', 'Úsek by bol príliš krátky', 'Posuň prehrávanie kúsok ďalej.'); return; }
      remember();
      const at = segStart(seg);
      if (side === 'l') seg.in = local; else seg.out = local;
      selSeg = seg; clampOverlays();
      refit(300); renderAll();
      seek(side === 'l' ? at : at + sd(seg) - 0.01, false);
      flash(seg.id);
    }
    function removeSeg(seg) {
      if (!seg) return;
      if (segs.length === 1) { toast('info', 'Posledný úsek', 'Časová os nemôže byť prázdna.'); return; }
      remember();
      const at = segStart(seg);
      segs.splice(segs.indexOf(seg), 1);
      selSeg = null;
      clampOverlays();
      refit(300); renderAll(); seek(Math.min(at, total()), false);
    }
    function duplicate(seg) {
      if (!seg) return;
      remember();
      const c = { ...seg, id: 's' + (++seq) };
      segs.splice(segs.indexOf(seg) + 1, 0, c);
      selSeg = c; refit(300); renderAll(); seek(segStart(c), false); flash(c.id);
    }
    function resetSeg(seg) {
      const src = sources.get(seg.src);
      if (seg.in === 0 && seg.out >= src.duration - 0.01) return;
      remember(); seg.in = 0; seg.out = src.duration;
      refit(300); renderAll(); seek(segStart(seg), false); flash(seg.id);
    }
    function clampOverlays() { const D = total(); overlays.forEach(o => { o.end = Math.min(o.end, D); o.start = Math.min(o.start, Math.max(0, o.end - 0.2)); }); }
    $('#bSplit', m).onclick = split;
    $('#bTrimL', m).onclick = () => trimTo('l');
    $('#bTrimR', m).onclick = () => trimTo('r');
    $('#bDelSeg', m).onclick = () => removeSeg(selSeg);
    function flash(id) { const el = $(`.sg[data-id="${id}"]`, m); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }

    /* ================= časová os ================= */
    /* po úprave sa mierka osi neprepne hneď: chvíľu ostane stáť (nič ti neutečie spod kurzora)
       a po krátkej pauze sa plynulo dopasuje na novú dĺžku */
    let fitTimer = 0, fitAnim = 0, fitRatio = 1, fitPend = false, fitTarget = 0;
    function stopFit() { clearTimeout(fitTimer); fitTimer = 0; cancelAnimationFrame(fitAnim); fitAnim = 0; fitPend = false; }
    /* používateľ siahol na os: nič sa už nehýbe (rozbehnuté dopasovanie sa dokončí hneď, čakajúce počká na ďalšiu úpravu) */
    function holdFit() {
      if (fitAnim) { cancelAnimationFrame(fitAnim); fitAnim = 0; pps = fitTarget; syncZoom(); layoutAll(); fitPend = false; }
      else if (fitTimer) {
        clearTimeout(fitTimer); fitTimer = 0;
        const resume = () => { removeEventListener('pointerup', resume, true); if (fitPend && !fitTimer && !fitAnim) fitTimer = setTimeout(animateFit, 500); };
        addEventListener('pointerup', resume, true);
      }
    }
    tlx.addEventListener('pointerdown', holdFit, true);
    function refit(delay = 650) {
      if (!fitPend) { fitRatio = fitPps && pps ? pps / fitPps : 1; fitPend = true; }
      cancelAnimationFrame(fitAnim); fitAnim = 0; clearTimeout(fitTimer);
      fitTimer = setTimeout(animateFit, delay);
    }
    function animateFit() {
      fitTimer = 0;
      const w = scroller.clientWidth - 2, D = Math.max(0.5, total());
      const nf = w / D, target = fitRatio > 1.02 ? nf * fitRatio : nf;
      fitPps = nf; fitTarget = target;
      const from = pps, t0 = performance.now(), dur0 = 380;
      if (Math.abs(target - from) < 0.01) { pps = target; syncZoom(); layoutAll(); fitPend = false; return; }
      const left0 = scroller.scrollLeft / from;
      const step = now => {
        const k = Math.min(1, (now - t0) / dur0), e = 1 - Math.pow(1 - k, 3);
        pps = from + (target - from) * e;
        syncZoom(); layoutAll();
        scroller.scrollLeft = k < 1 ? left0 * pps : (fitRatio > 1.02 ? Math.min(left0 * pps, Math.max(0, scroller.scrollWidth - scroller.clientWidth)) : 0);
        fitAnim = k < 1 ? requestAnimationFrame(step) : 0;
        if (k >= 1) fitPend = false;
      };
      fitAnim = requestAnimationFrame(step);
    }
    function syncZoom() { const z = $('#zoom', m); z.value = Math.round(Math.log(Math.max(1, pps / fitPps)) / Math.log(40) * 100); z.style.setProperty('--p', z.value + '%'); }
    function fitZoom(keep) {
      stopFit();
      const w = scroller.clientWidth - 2;
      const D = Math.max(0.5, total());
      const ratio = fitPps && pps ? pps / fitPps : 1;
      fitPps = w / D;
      // keep: zachovaj priblíženie, ak si si os priblížil; inak ju znova roztiahni na celú šírku
      pps = keep && ratio > 1.02 ? fitPps * ratio : fitPps;
      const z = $('#zoom', m); z.value = Math.round(Math.log(pps / fitPps) / Math.log(40) * 100); z.style.setProperty('--p', z.value + '%');
    }
    function setZoom(np, anchorX) {
      if (fitPend) { stopFit(); fitPps = (scroller.clientWidth - 2) / Math.max(0.5, total()); if (anchorX == null) anchorX = 0; }
      const at = (scroller.scrollLeft + anchorX) / pps;
      pps = Math.max(fitPps, Math.min(fitPps * 40, np));
      const z = $('#zoom', m); z.value = Math.round(Math.log(pps / fitPps) / Math.log(40) * 100); z.style.setProperty('--p', z.value + '%');
      layoutAll();
      scroller.scrollLeft = at * pps - anchorX;
    }
    $('#zoom', m).oninput = e => setZoom(fitPps * Math.pow(40, e.target.value / 100), Math.max(0, Math.min(scroller.clientWidth, t * pps - scroller.scrollLeft)));
    scroller.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(pps * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX - scroller.getBoundingClientRect().left);
    }, { passive: false });

    function renderAll() { renderSegs(); renderOverlayLanes(); layoutAll(); renderInspector(); renderTitle(); updSel(); }
    function layoutAll() { tlx.style.width = Math.max(scroller.clientWidth - 2, total() * pps) + 'px'; renderRuler(); layoutSegs(); layoutOverlayLanes(); layoutHead(); }

    function renderRuler() {
      const D = total(), steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
      const step = steps.find(s => s * pps >= 70) || 600;
      let html = '';
      const lab = x => step >= 1 ? dur(x) : `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}.${Math.round((x % 1) * 10)}`;
      for (let x = 0; x <= D + 1e-6; x += step) html += `<span style="left:${x * pps}px">${lab(x)}</span>`;
      for (let x = step / 2; x <= D + 1e-6; x += step) html += `<i style="left:${x * pps}px"></i>`;
      for (const mk of markTimes()) html += `<b class="mk" style="left:${mk * pps}px" title="Značka · ${durMs(mk)} (M = ďalšia)"></b>`;
      for (const f of fgTimes()) html += `<em class="fgm ${f.kind}" style="left:${f.t * pps}px" title="${esc((f.kind === 'game' ? 'Hra: ' : f.kind === 'desktop' ? 'Plocha' : 'Prepnuté na ') + (f.kind === 'desktop' ? '' : f.name))} · ${durMs(f.t)}">${f.kind === 'game' ? FG_GAME : FG_SCREEN}</em>`;
      $('#ruler', m).innerHTML = html;
    }
    /* prepnutia okna v popredí (iná hra / plocha) počas záznamu: malé ikonky na pravítku */
    function fgTimes() {
      const out = []; let a = 0;
      for (const s of segs) {
        const src = sources.get(s.src), list = (src && src.fg) || [];
        list.forEach((f, i) => { if (i > 0 && f.t >= s.in && f.t <= s.out) out.push({ t: a + (f.t - s.in) / sp(s), kind: f.kind, name: f.name }); });
        a += sd(s);
      }
      return out;
    }
    /* značky zo skratky počas hrania: čas na výslednej osi (cez všetky úseky, s rýchlosťou) */
    function markTimes() {
      const out = []; let a = 0;
      for (const s of segs) {
        const src = sources.get(s.src);
        for (const k of (src && src.marks) || []) if (k >= s.in && k <= s.out) out.push(a + (k - s.in) / sp(s));
        a += sd(s);
      }
      return out.sort((x, y) => x - y);
    }
    function jumpMark(dir) {
      const ms = markTimes(); if (!ms.length) { showHint('V klipe nie sú žiadne značky. Pridáš ich skratkou Značka počas hrania.', 2600); return; }
      const nx = dir > 0 ? ms.find(x => x > t + 0.05) : [...ms].reverse().find(x => x < t - 0.05);
      seek(nx != null ? nx : (dir > 0 ? ms[0] : ms[ms.length - 1]), false);
    }
    function renderSegs() {
      $('#laneV', m).innerHTML = segs.map((s, n) => {
        const src = sources.get(s.src);
        return `<div class="sg${selSeg === s ? ' sel' : ''}" data-id="${s.id}" style="--c:${src.c}">
          <canvas class="sg-film"></canvas>
          <i class="sg-h l" data-e="l"></i>
          <span class="sg-l"><b>${esc(sources.size > 1 ? src.name : `Úsek ${n + 1}`)}</b><em></em></span>
          <i class="sg-h r" data-e="r"></i>
        </div>`;
      }).join('');
      $('#laneA', m).innerHTML = segs.map(s => `<canvas class="wv" data-id="${s.id}" style="--c:${sources.get(s.src).c}"></canvas>`).join('');
    }
    function layoutSegs() {
      let a = 0;
      for (const s of segs) {
        const el = $(`.sg[data-id="${s.id}"]`, m); if (!el) continue;
        const w = sd(s) * pps, x = a * pps, ww = Math.max(4, w - 2);
        el.style.left = x + 'px'; el.style.width = ww + 'px';
        el.querySelector('em').textContent = dur(sd(s)) + (sp(s) !== 1 ? ` · ${fmtX(sp(s))}` : '');
        el.classList.toggle('tiny', w < 80);
        el.classList.toggle('fi', !!s.fadeIn); el.classList.toggle('fo', !!s.fadeOut);
        el.style.setProperty('--fw', Math.min(FADE, sd(s) / 3) * pps + 'px');
        const wv = $(`.wv[data-id="${s.id}"]`, m);
        if (wv) { wv.style.left = x + 'px'; wv.style.width = ww + 'px'; }
        drawFilm(s, el.querySelector('.sg-film'), ww);
        drawWave(s, wv, ww);
        a += sd(s);
      }
      const n = segs.length;
      $('#info', m).textContent = `${n} ${plural(n, 'úsek', 'úseky', 'úsekov')} · ${dur(total())}`;
    }
    function canvasFit(c, w, h) {
      const dpr = devicePixelRatio || 1, cw = Math.max(1, Math.round(w * dpr)), ch = Math.round(h * dpr);
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      return g;
    }
    function drawFilm(s, c, w) {
      if (!c) return;
      const src = sources.get(s.src), fr = src.frames || [];
      const h = 54, g = canvasFit(c, w, h);
      if (!fr.length) return;
      const tw = h * (src.width || 16) / (src.height || 9);
      for (let x = 0; x < w; x += tw) {
        const tm = s.in + ((x + tw / 2) / pps) * sp(s);
        const k = Math.max(0, Math.min(fr.length - 1, Math.floor(tm / src.duration * fr.length)));
        const f = fr[k] || fr.find(Boolean);
        if (f) g.drawImage(f, x, 0, tw, h);
      }
    }
    function drawFilms(src) { for (const s of segs) if (s.src === src.path) { const el = $(`.sg[data-id="${s.id}"]`, m); if (el) drawFilm(s, el.querySelector('.sg-film'), parseFloat(el.style.width) || 0); } }
    /* priebeh zvuku z obálok hlasitosti: len stopy, ktoré sú v mixéri zapnuté (to isté, čo sa uloží) */
    function drawWave(s, c, w) {
      if (!c) return;
      const h = 28, g = canvasFit(c, w, h);
      const src = sources.get(s.src), lv = src.levels || [];
      const on = mixer.map((x, i) => x.on && lv[i] ? [lv[i], Math.min(1.6, x.vol), (x.off || 0) / 1000] : null).filter(Boolean);
      const col = getComputedStyle(c).getPropertyValue('--c').trim() || '#888';
      g.fillStyle = col;
      if (!on.length) { g.globalAlpha = .35; g.fillRect(0, h / 2 - .5, w, 1); g.globalAlpha = 1; return; }
      const D = sd(s), F = Math.min(FADE, D / 3);
      g.globalAlpha = .85;
      for (let x = 0; x < w; x += 2) {
        const tt = x / pps, tm = s.in + tt * sp(s), i = Math.floor(tm * 20);
        let v = 0;
        for (const [env, vol, o] of on) v = Math.max(v, ((env[o ? Math.floor((tm + o) * 20) : i] || 0) / 255) * vol);
        if (s.fadeIn && tt < F) v *= tt / F;
        if (s.fadeOut && D - tt < F) v *= (D - tt) / F;
        const bh = Math.max(1, Math.min(1, Math.sqrt(v)) * (h - 2));
        g.fillRect(x, (h - bh) / 2, 1.4, bh);
      }
      g.globalAlpha = 1;
    }
    const drawWaves = () => { for (const s of segs) { const c = $(`.wv[data-id="${s.id}"]`, m); if (c) drawWave(s, c, parseFloat(c.style.width) || 0); } };
    function layoutHead() {
      $('#head', m).style.transform = `translateX(${t * pps}px)`;
      $('#fadeV', m).style.opacity = fadeAt(t);
      $('#plTime', m).innerHTML = `${durMs(t)} <i>/ ${dur(total())}</i>`;
      if (document.fullscreenElement === stage) { $('#fsTime', m).textContent = `${dur(t)} / ${dur(total())}`; $('#fsFill', m).style.width = (total() ? t / total() * 100 : 0) + '%'; }
      // počas prehrávania drž hlavu v zábere
      if (playing) { const x = t * pps; if (x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = x - 40; else if (x < scroller.scrollLeft) scroller.scrollLeft = x - 20; }
    }
    function updSel() {
      $$('.sg', m).forEach(el => el.classList.toggle('sel', !!selSeg && el.dataset.id === selSeg.id));
      $('#bDelSeg', m).disabled = !selSeg || segs.length < 2;
      if (tab === 'seg') renderSegPane();
    }

    /* ---------- prichytávanie ---------- */
    let altKey = false;
    function snapPoints(skipOv, withHead) {
      const pts = [0]; let a = 0;
      for (const s of segs) { a += sd(s); pts.push(a); }
      if (withHead) pts.push(t);
      for (const o of overlays) if (o !== skipOv) pts.push(o.start, o.end);
      pts.push(...markTimes());
      return pts;
    }
    function snapTo(time, pts) {
      if (!snapOn || altKey) return { t: time, hit: null };
      const th = 8 / pps; let best = null;
      for (const p of pts) { const d = Math.abs(p - time); if (d < th && (best == null || d < Math.abs(best - time))) best = p; }
      return best == null ? { t: time, hit: null } : { t: best, hit: best };
    }
    function showSnap(hit) { const l = $('#snapLine', m); l.hidden = hit == null; if (hit != null) l.style.left = hit * pps + 'px'; }
    function showTip(x, html) { const tp = $('#tlTip', m); if (html == null) { tp.hidden = true; return; } tp.hidden = false; tp.innerHTML = html; tp.style.left = x + 'px'; }
    function setSnap(v) { snapOn = v; LS.set('snap', v); $('#bSnap', m).classList.toggle('on', v); }
    $('#bSnap', m).onclick = () => setSnap(!snapOn);

    // ťahanie na osi: pravítko/prázdne miesto = posun hlavy, úsek = výber/presun, hrana = orez
    tlx.addEventListener('pointerdown', e => {
      if (!segs.length || e.button !== 0) return;
      const r = tlx.getBoundingClientRect();
      const timeAt = x => Math.max(0, Math.min(total(), (x - r.left) / pps));
      const sgEl = e.target.closest('.sg');
      const barEl = e.target.closest('.ov-bar');
      tlx.setPointerCapture(e.pointerId);
      $('#hov', m).hidden = true; tlx.classList.add('busy');
      let move, up;

      if (barEl) { // overlay pásik
        const o = overlays.find(x => x.id === barEl.dataset.id); if (!o) return;
        if (sel !== o) selectOv(o);
        const edge = e.target.dataset.e, x0 = e.clientX, s0 = o.start, e0 = o.end, D = total();
        const pts = snapPoints(o, true);
        let moved = false;
        move = ev => {
          altKey = ev.altKey;
          const d = (ev.clientX - x0) / pps;
          if (!moved && Math.abs(ev.clientX - x0) > 2) { moved = true; remember(); }
          if (!moved) return;
          let hit = null;
          if (edge === 's') { const q = snapTo(s0 + d, pts); hit = q.hit; o.start = Math.max(0, Math.min(q.t, o.end - 0.2)); }
          else if (edge === 'e') { const q = snapTo(e0 + d, pts); hit = q.hit; o.end = Math.min(D, Math.max(q.t, o.start + 0.2)); }
          else {
            let dd = Math.max(-s0, Math.min(D - e0, d));
            const a1 = snapTo(s0 + dd, pts), a2 = snapTo(e0 + dd, pts);
            if (a1.hit != null && (a2.hit == null || Math.abs(a1.t - s0 - dd) <= Math.abs(a2.t - e0 - dd))) { dd = a1.t - s0; hit = a1.hit; }
            else if (a2.hit != null) { dd = a2.t - e0; hit = a2.hit; }
            o.start = s0 + dd; o.end = e0 + dd;
          }
          showSnap(hit);
          layoutOverlayLanes(); updInspTimes();
          seek(edge === 'e' ? o.end - 0.01 : o.start, false);
          showTip((edge === 'e' ? o.end : o.start) * pps, `${durMs(o.start)} – ${durMs(o.end)} <i>${(o.end - o.start).toFixed(1).replace('.', ',')} s</i>`);
        };
        up = () => { if (!moved) seek(timeAt(e.clientX), false); };
      } else if (sgEl && e.target.dataset.e) { // orez hrany úseku
        const seg = segs.find(s => s.id === sgEl.dataset.id), src = sources.get(seg.src);
        const edge = e.target.dataset.e, x0 = e.clientX, in0 = seg.in, out0 = seg.out, len0 = sd(seg);
        if (playing) pause();
        let moved = false;
        selSeg = seg; updSel();
        sgEl.classList.add('trimming');
        move = ev => {
          const d = (ev.clientX - x0) / pps * sp(seg); // posun na osi → posun v zdroji
          if (!moved) { moved = true; remember(); }
          if (edge === 'l') { seg.in = Math.max(0, Math.min(in0 + d, seg.out - 0.2)); seek(segStart(seg), false); }
          else { seg.out = Math.min(src.duration, Math.max(out0 + d, seg.in + 0.2)); seek(segStart(seg) + sd(seg) - 0.02, false); }
          layoutAll();
          const diff = sd(seg) - len0;
          showTip((edge === 'l' ? segStart(seg) : segStart(seg) + sd(seg)) * pps, `${dur(sd(seg))} <i>${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1).replace('.', ',')} s</i>`);
        };
        up = () => { sgEl.classList.remove('trimming'); clampOverlays(); refit(); layoutAll(); if (tab === 'seg') renderSegPane(); };
      } else if (sgEl) { // výber + presun poradia
        const seg = segs.find(s => s.id === sgEl.dataset.id);
        const x0 = e.clientX;
        let dragging = false, target = -1;
        selSeg = seg; updSel();
        if (sel) selectOv(null);
        if (tab !== 'seg') showTab('seg');
        move = ev => {
          if (!dragging && Math.abs(ev.clientX - x0) > 6 && segs.length > 1) { dragging = true; sgEl.classList.add('dragging'); if (playing) pause(); }
          if (!dragging) return;
          sgEl.style.transform = `translateX(${ev.clientX - x0}px)`;
          // nové miesto = medzera, nad ktorou je myš
          const x = (ev.clientX - r.left) / pps;
          let a = 0; target = segs.length;
          for (let i = 0; i < segs.length; i++) { const d = sd(segs[i]); if (x < a + d / 2) { target = i; break; } a += d; }
          let gx = 0; for (let i = 0; i < target; i++) gx += sd(segs[i]);
          const drop = $('#drop', m); drop.hidden = false; drop.style.left = (gx * pps - 2) + 'px';
        };
        up = () => {
          $('#drop', m).hidden = true;
          sgEl.classList.remove('dragging'); sgEl.style.transform = '';
          if (!dragging) { seek(timeAt(e.clientX), playing); return; }
          const from = segs.indexOf(seg);
          let to = target > from ? target - 1 : target;
          if (to !== from && target >= 0) { remember(); segs.splice(from, 1); segs.splice(to, 0, seg); renderSegs(); layoutAll(); updSel(); seek(segStart(seg), false); flash(seg.id); }
        };
      } else { // posun hlavy (prichytí sa k okrajom úsekov a objektov)
        const wasPlaying = playing;
        if (playing) pause();
        if (!e.target.closest('.ov-lane')) { selSeg = null; updSel(); }
        const pts = snapPoints(null, false);
        move = ev => { altKey = ev.altKey; const q = snapTo(timeAt(ev.clientX), pts); showSnap(q.hit); seek(q.t, false); };
        move(e);
        up = () => { if (wasPlaying) play(); };
      }
      const done = () => {
        tlx.removeEventListener('pointermove', move); tlx.removeEventListener('pointerup', done); tlx.removeEventListener('pointercancel', done);
        showSnap(null); showTip(0, null); tlx.classList.remove('busy'); altKey = false;
        up && up();
      };
      tlx.addEventListener('pointermove', move); tlx.addEventListener('pointerup', done); tlx.addEventListener('pointercancel', done);
    });
    tlx.addEventListener('dblclick', e => { const el = e.target.closest('.sg'); if (el) { const s = segs.find(x => x.id === el.dataset.id); seek(segStart(s), false); } });
    // duch prehrávania pod myšou: kde by si skočil kliknutím
    tlx.addEventListener('pointermove', e => {
      if (tlx.classList.contains('busy') || !segs.length) return;
      const r = tlx.getBoundingClientRect(), x = e.clientX - r.left, tm = x / pps;
      const hv = $('#hov', m);
      if (tm > total() || e.target.closest('.sg-h, .lane-h')) { hv.hidden = true; return; }
      hv.hidden = false; hv.style.left = x + 'px'; hv.querySelector('b').textContent = durMs(tm);
    });
    tlx.addEventListener('pointerleave', () => { $('#hov', m).hidden = true; });

    /* ================= pridanie klipu ================= */
    $('#bAdd', m).onclick = () => {
      const lib = (opts.library ? opts.library() : []).filter(c => !/\.mkv$/i.test(c.path));
      const SORT = { new: 'Najnovšie', old: 'Najstaršie', long: 'Najdlhšie', name: 'Podľa názvu' };
      const cmp = { new: (x, y) => y.mtime - x.mtime, old: (x, y) => x.mtime - y.mtime, long: (x, y) => (y.duration || 0) - (x.duration || 0), name: (x, y) => x.name.localeCompare(y.name, 'sk', { numeric: true }) };
      const nz = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      let q = '', sortK = 'new', range = null;
      const order = [];
      const inSeq = new Set(segs.map(x => x.src));
      const pk = showLayer(`<div class="pk">
        <div class="pk-h"><h3>Pridať klip na koniec</h3><span class="ed-sub">Vyber jeden alebo viac, pridajú sa v poradí, ako klikáš</span></div>
        <div class="pk-bar">
          <label class="search pk-q">${I.search}<input id="pkQ" placeholder="Hľadať názov, hru, dátum…" spellcheck="false" autocomplete="off"><button class="qx" id="pkQx" aria-label="Vymazať" hidden>${I.x}</button></label>
          <button class="btn date-chip" id="pkDate" title="Vybrať dátum alebo rozsah dátumov">${I.cal}<span>Dátum</span></button>
          <button class="pb" id="pkSort" type="button"><span>${SORT[sortK]}</span>${I.chev}</button>
        </div>
        <div class="pk-grid" id="pkGrid"></div>
        <div class="pk-foot"><span class="pk-sum" id="pkSum"></span><div class="acts"><button class="btn" data-a="no">Zrušiť</button><button class="btn primary" data-a="yes" disabled>Pridať</button></div></div></div>`, 'pk-layer');
      const grid = pk.querySelector('#pkGrid');
      const view = () => lib.filter(c => {
        if (range && !Cal.inRange(c.mtime, range)) return false;
        if (!q) return true;
        const d = new Date(c.mtime), h = nz([c.name, c.game, dayLabel(c.mtime), `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`, `${d.getDate()}. ${d.getMonth() + 1}.`].join(' '));
        return q.split(/\s+/).every(w => h.includes(w));
      }).sort(cmp[sortK]);
      function paintSel() {
        grid.querySelectorAll('.pk-c').forEach(x => { const k = order.indexOf(x.dataset.p); x.classList.toggle('on', k >= 0); x.querySelector('.pk-n').textContent = k >= 0 ? k + 1 : ''; });
        const y = pk.querySelector('[data-a=yes]'); y.disabled = !order.length; y.textContent = order.length > 1 ? `Pridať ${order.length}` : 'Pridať';
        const secs = order.reduce((t, p) => t + ((lib.find(x => x.path === p) || {}).duration || 0), 0);
        pk.querySelector('#pkSum').textContent = order.length ? `Vybrané: ${order.length}${secs ? ' · ' + dur(secs) : ''}` : `${shown} z ${lib.length} klipov`;
      }
      let shown = 0;
      function paintGrid() {
        const list = view(); shown = list.length;
        grid.innerHTML = list.map(c => `<button class="pk-c" data-p="${esc(c.path)}">
          <div class="pk-t">${c.thumb ? `<img src="${esc(fileUrl(c.thumb))}" alt="" loading="lazy" decoding="async">` : I.film}<i class="pk-n"></i>${c.duration ? `<span class="dur">${dur(c.duration)}</span>` : ''}${inSeq.has(c.path) ? '<em class="pk-in">Už je na osi</em>' : ''}</div>
          <b>${esc(c.name)}</b><small>${esc(dayLabel(c.mtime))} ${esc(time(c.mtime))}</small></button>`).join('') ||
          `<div class="ed-empty">${lib.length ? 'Nič sa nenašlo. Skús iné slovo alebo rozsah dátumov.' : 'Knižnica je prázdna.'}</div>`;
        paintSel();
      }
      grid.addEventListener('click', e => {
        const b = e.target.closest('.pk-c'); if (!b) return;
        const p = b.dataset.p, i = order.indexOf(p);
        if (i >= 0) order.splice(i, 1); else order.push(p);
        paintSel();
      });
      const qi = pk.querySelector('#pkQ'), qx = pk.querySelector('#pkQx');
      qi.addEventListener('input', () => { q = nz(qi.value).trim(); qx.hidden = !qi.value; paintGrid(); });
      qx.onclick = () => { qi.value = ''; q = ''; qx.hidden = true; paintGrid(); qi.focus(); };
      qi.addEventListener('keydown', e => { if (e.key === 'Escape' && qi.value) { e.stopPropagation(); qx.click(); } });
      pk.querySelector('#pkSort').onclick = e => UI.menu(e.currentTarget, Object.entries(SORT).map(([v, l]) => ({ label: l, v, checked: v === sortK })), it => { sortK = it.v; pk.querySelector('#pkSort span').textContent = SORT[sortK]; paintGrid(); });
      const dBtn = pk.querySelector('#pkDate');
      dBtn.onclick = e => {
        if (e.target.closest('.dx')) { range = null; paintDate(); paintGrid(); return; }
        Cal.open(dBtn, { range, counts: () => Cal.countsOf(lib) }, r => { range = r; paintDate(); paintGrid(); });
      };
      function paintDate() {
        dBtn.classList.toggle('on', !!range);
        dBtn.innerHTML = `${I.cal}<span>${range ? esc(Cal.label(range)) : 'Dátum'}</span>${range ? `<i class="dx" title="Zrušiť">${I.x}</i>` : ''}`;
      }
      pk.querySelector('[data-a=no]').onclick = hideLayer;
      pk.querySelector('[data-a=yes]').onclick = async () => {
        Cal.close(); UI.closeMenu(true);
        hideLayer();
        if (playing) pause();
        remember();
        $('#loading', m).classList.remove('gone');
        for (const p of order) {
          const c = lib.find(x => x.path === p); if (!c) continue;
          const src = await addSource(c);
          segs.push({ id: 's' + (++seq), src: src.path, in: 0, out: src.duration || 0.1 });
        }
        $('#loading', m).classList.add('gone');
        rebuildTracks(); fitZoom(); renderAll();
        seek(segStart(segs[segs.length - order.length] || segs[0]), false);
        scroller.scrollLeft = scroller.scrollWidth;
      };
      paintGrid();
      setTimeout(() => qi.focus(), 60);
    };
    /* vrstva nad editorom (výber klipu, skratky, ukladanie, neuložené zmeny) */
    let layerClose = null;
    function showLayer(html, cls = '', onClose) {
      layer.className = 'ed-layer ' + cls; layer.innerHTML = html; layer.hidden = false; layerClose = onClose || null;
      return layer;
    }
    function hideLayer() { if (layer.hidden) return; Cal.close(); layer.hidden = true; layer.innerHTML = ''; const f = layerClose; layerClose = null; f && f(); }
    layer.addEventListener('mousedown', e => { if (e.target === layer && !layer.classList.contains('locked')) hideLayer(); });

    /* ================= postranný panel ================= */
    function showTab(x) {
      tab = x;
      $$('#tabs button', m).forEach(b => b.classList.toggle('on', b.dataset.tab === x));
      $('#paneText', m).hidden = x !== 'text'; $('#paneSeg', m).hidden = x !== 'seg'; $('#paneAudio', m).hidden = x !== 'audio';
      placeInd();
      if (x === 'seg') renderSegPane();
    }
    function placeInd() {
      const b = $(`#tabs [data-tab="${tab}"]`, m), ind = $('.ed-tabs-ind', m);
      if (!b || !ind || !b.offsetWidth) return;
      ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`;
    }
    // výber záložky drž na mieste pri každej zmene šírky panelu (napr. po návrate z celej obrazovky)
    new ResizeObserver(() => placeInd()).observe($('#tabs', m));
    $('#tabs', m).addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

    /* úsek: vybraný, inak ten pod prehrávaním */
    const paneSeg = () => (selSeg && segs.includes(selSeg) ? selSeg : (locate(t) || {}).seg);
    let segPaneFor = null;
    function renderSegPane() {
      const box = $('#paneSeg', m), s = paneSeg();
      segPaneFor = s;
      if (!s) { box.innerHTML = ''; return; }
      const src = sources.get(s.src), n = segs.indexOf(s) + 1, trimmed = s.in > 0.01 || s.out < src.duration - 0.01;
      box.innerHTML = `
        <div class="sp-head" style="--c:${src.c}"><i class="src-dot"></i><div><b>Úsek ${n} <span>z ${segs.length}</span></b><small>${esc(src.name)}</small></div><em>${dur(sd(s))}</em></div>
        ${selSeg !== s ? '<div class="sp-note">Úsek pod prehrávaním. Klikni na iný na časovej osi.</div>' : ''}
        <div class="sp-sec"><h5>Rýchlosť</h5>${UI.seg('speed', SPEEDS.map(v => ({ v, l: fmtX(v) })), sp(s))}
          <p class="sp-hint">${sp(s) < 1 ? 'Spomalené: ideálne na zopakovanie akcie.' : sp(s) > 1 ? 'Zrýchlené: preskoč nudnú časť.' : 'Normálna rýchlosť.'}</p></div>
        <div class="sp-sec"><h5>Prechody</h5>
          <label class="sp-row"><span><b>Roztmievanie</b><small>Začne z čiernej, zvuk sa zosilní</small></span><span class="toggle sm"><input type="checkbox" data-f="fadeIn" ${s.fadeIn ? 'checked' : ''}></span></label>
          <label class="sp-row"><span><b>Stmievanie</b><small>Skončí do čiernej, zvuk zoslabne</small></span><span class="toggle sm"><input type="checkbox" data-f="fadeOut" ${s.fadeOut ? 'checked' : ''}></span></label></div>
        ${cropped() ? `<div class="sp-sec"><h5>Výrez ${esc(ASPECTS[aspect].short)}</h5>
          <div class="sp-crop" id="spCrop"${src.thumb ? ` style="background-image:url('${esc(fileUrl(src.thumb))}')${RG ? `;background-size:${100 / RG.w}% ${100 / RG.h}%;background-position:${RG.w < 1 ? RG.x / (1 - RG.w) * 100 : 0}% ${RG.h < 1 ? RG.y / (1 - RG.h) * 100 : 0}%` : ''}"` : ''}><i style="left:${cropLeft(s) / W * 100}%;width:${OW / W * 100}%"></i></div>
          <div class="sp-btns three"><button class="btn small" data-cx="0">Vľavo</button><button class="btn small" data-cx="0.5">Stred</button><button class="btn small" data-cx="1">Vpravo</button></div>
          ${segs.length > 1 ? '<button class="btn small ghost" data-a="cxall">Rovnaký výrez pre všetky úseky</button>' : ''}
          <p class="sp-hint">Ťahaj video v náhľade do strán. Každý úsek môže mať výrez inde, takže po rozdelení (S) ho môžeš posunúť za akciou.</p></div>` : ''}
        <div class="sp-sec"><h5>Orezanie <span class="sp-pos" id="spPos"></span></h5>
          <div class="sp-btns">
            <button class="btn small" data-a="trimL" title="Q">${IC.trimL}<span>Orezať začiatok</span></button>
            <button class="btn small" data-a="trimR" title="W">${IC.trimR}<span>Orezať koniec</span></button>
          </div>
          <p class="sp-hint">Posuň prehrávanie na miesto, kde sa má klip začať alebo skončiť, a klikni. Alebo ťahaj okraje úseku na osi.</p>
          ${trimmed ? `<button class="btn small ghost" data-a="reset">${IC.reset}<span>Vrátiť celý klip (${dur(src.duration)})</span></button>` : ''}</div>
        <div class="sp-sec sp-acts">
          <button class="btn small" data-a="split" title="S">${IC.split}<span>Rozdeliť</span></button>
          <button class="btn small" data-a="dup" title="Ctrl+D">${IC.dup}<span>Duplikovať</span></button>
          <button class="btn small danger-text" data-a="del" title="Delete"${segs.length < 2 ? ' disabled' : ''}>${IC.del}<span>Odstrániť</span></button>
        </div>`;
      UI.placeThumbs(box);
      updSegPaneLive();
    }
    function updSegPaneLive() {
      const s = paneSeg();
      if (s !== segPaneFor) return renderSegPane();
      const p = $('#spPos', m); if (!p || !s) return;
      const L = locate(t);
      p.textContent = L && L.seg === s ? `prehrávanie na ${durMs(t - L.start)}` : 'prehrávanie je mimo úseku';
      $$('[data-a=trimL],[data-a=trimR]', m).forEach(b => { b.disabled = !(L && L.seg === s); });
    }
    $('#paneSeg', m).addEventListener('click', e => {
      const s = paneSeg(); if (!s) return;
      const sb = e.target.closest('.seg button'), ab = e.target.closest('[data-a]'), cb = e.target.closest('[data-cx]');
      if (cb) { remember(); selSeg = s; seek(Math.max(segStart(s), Math.min(t, segStart(s) + sd(s) - 0.01)), false); setCx(s, Number(cb.dataset.cx)); renderSegPane(); return; }
      if (ab && ab.dataset.a === 'cxall') { remember(); segs.forEach(x => { x.cx = s.cx; }); placeCanvas(); toast('ok', 'Výrez nastavený', 'Všetky úseky majú rovnaký výrez.'); return; }
      if (sb) {
        remember(); s.speed = Number(sb.dataset.v);
        if (s.speed === 1) delete s.speed;
        selSeg = s; clampOverlays(); refit(300); layoutAll(); updSel(); seek(segStart(s), false);
      } else if (ab) {
        const a = ab.dataset.a;
        if (a === 'trimL' || a === 'trimR') trimTo(a === 'trimL' ? 'l' : 'r');
        else if (a === 'reset') resetSeg(s);
        else if (a === 'split') split();
        else if (a === 'dup') duplicate(s);
        else if (a === 'del') removeSeg(s);
      }
    });
    $('#paneSeg', m).addEventListener('pointerdown', e => {
      const map = e.target.closest('#spCrop'); if (!map) return;
      const s = paneSeg(); if (!s) return;
      remember(); selSeg = s;
      const L = locate(t); if (!L || L.seg !== s) seek(segStart(s) + 0.01, false);
      const r = map.getBoundingClientRect(), box = map.querySelector('i');
      const set = ev => { setCx(s, (ev.clientX - r.left) / r.width); box.style.left = cropLeft(s) / W * 100 + '%'; };
      map.setPointerCapture(e.pointerId); set(e);
      map.onpointermove = ev => { if (ev.buttons) set(ev); };
      map.onpointerup = () => { map.onpointermove = null; };
    });
    $('#paneSeg', m).addEventListener('change', e => {
      const cb = e.target.closest('[data-f]'), s = paneSeg(); if (!cb || !s) return;
      remember(); s[cb.dataset.f] = cb.checked; selSeg = s;
      layoutSegs(); updSel();
      seek(cb.dataset.f === 'fadeIn' ? segStart(s) : Math.max(segStart(s), segStart(s) + sd(s) - FADE - 0.4), false);
      if (!playing) playPreview(t, Math.min(total(), t + FADE + 0.4));
    });

    /* ================= mixér ================= */
    /* stopy, ktoré sa prekrývajú: Mix = Systém + Mikrofón, Systém = všetko, čo počuješ (aj hra a Discord) */
    const kindOf = x => /^mix/i.test(x.title) ? 'mix' : /syst/i.test(x.title) ? 'system' : /^hra|game/i.test(x.title) ? 'game' : /discord/i.test(x.title) ? 'discord' : /mikro|^mic/i.test(x.title) ? 'mic' : '';
    const INSIDE = { mix: ['system', 'mic', 'game', 'discord'], system: ['game', 'discord'] };
    function overlap() {
      const on = mixer.filter(x => x.on);
      for (const big of ['mix', 'system']) {
        const b = on.find(x => kindOf(x) === big); if (!b) continue;
        const inner = on.filter(x => INSIDE[big].includes(kindOf(x)));
        if (inner.length) return { off: inner, msg: `${b.title} už obsahuje ${inner.map(x => x.title).join(' a ')}, takže by ${inner.length > 1 ? 'boli' : 'bol'} v klipe dvakrát (s ozvenou). Opraviť = nechať len ${b.title}.` };
      }
      return null;
    }
    let openOff = -1;
    const offTxt = v => !v ? '' : `${v > 0 ? 'skôr' : 'neskôr'} ${Math.abs(v)} ms`;
    function renderMixer() {
      const box = $('#mixer', m);
      if (!T) {
        const err = [...sources.values()].find(s => s.trackErr);
        box.innerHTML = `<div class="ed-empty">${err ? 'Stopy sa nepodarilo pripraviť, hrá sa prvá stopa z videa.' : 'Klip nemá zvuk.'}</div>`;
        $('#trSub', m).textContent = ''; return;
      }
      const onCount = mixer.filter(x => x.on).length;
      const dup = overlap();
      $('#trSub', m).innerHTML = (onCount ? `Počuješ <b>${onCount} z ${T}</b>. Presne takto sa zvuk aj uloží.` : 'Všetko je stlmené, klip bude bez zvuku.')
        + (dup ? `<div class="mx-warn">${esc(dup.msg)} <button class="btn small" id="mxFix">Opraviť</button></div>` : '');
      if (dup) $('#mxFix', m).onclick = () => { dup.off.forEach(x => { x.on = false; }); renderMixer(); syncAudio(); drawWaves(); };
      box.innerHTML = mixer.map((x, k) => `
        <div class="mx${x.on ? ' on' : ''}" data-k="${k}" style="--c:${x.c}">
          <button class="mx-btn" data-act="mute" title="${x.on ? 'Stlmiť' : 'Zapnúť'}">${x.on ? IC.spk : IC.mute}</button>
          <div class="mx-name"><b>${esc(x.title)}</b><button class="mx-solo" data-act="solo" title="Počúvať len túto stopu">len táto</button></div>
          <span class="mx-pct">${Math.round(x.vol * 100)} %</span>
          <div class="mx-vol"><i class="mx-lvl" data-lvl="${k}"></i><input type="range" min="0" max="200" step="1" value="${Math.round(x.vol * 100)}" data-act="vol" style="--p:${x.vol * 50}%" title="Dvojklik = 100 %"></div>
          <button class="mx-off${x.off ? ' set' : ''}" data-act="offt" title="Posunúť stopu voči obrazu (keď zvuk mešká alebo predbieha)">⇆${x.off ? ' ' + offTxt(x.off) : ''}</button>
          <div class="mx-offrow"${openOff === k ? '' : ' hidden'}>
            <button class="ed-ico" data-act="off" data-d="-10" title="Zvuk skôr o 10 ms">−</button>
            <input type="range" min="-500" max="500" step="5" value="${-(x.off || 0)}" data-act="offr" style="--p:${(500 - (x.off || 0)) / 10}%">
            <button class="ed-ico" data-act="off" data-d="10" title="Zvuk neskôr o 10 ms">+</button>
            <button class="btn small ghost" data-act="off0"${x.off ? '' : ' disabled'}>0</button>
            <p class="sp-hint">Doľava = zvuk príde skôr (keď mešká za obrazom, napr. mikrofón cez VST). Pusti si miesto s tlesknutím alebo výstrelom a dolaď.</p>
          </div>
        </div>`).join('');
      $$('.mx', box).forEach(row => {
        const x = mixer[+row.dataset.k];
        row.querySelector('[data-act=mute]').onclick = () => { x.on = !x.on; renderMixer(); syncAudio(); drawWaves(); };
        row.querySelector('[data-act=solo]').onclick = () => { mixer.forEach(y => { y.on = y === x; }); renderMixer(); syncAudio(); drawWaves(); };
        const r = row.querySelector('[data-act=vol]');
        r.oninput = () => {
          x.vol = r.value / 100; if (x.vol > 0) x.on = true;
          r.style.setProperty('--p', (r.value / 2) + '%');
          row.querySelector('.mx-pct').textContent = r.value + ' %';
          row.classList.toggle('on', x.on);
          syncAudio();
        };
        r.onchange = drawWaves;
        r.ondblclick = () => { x.vol = 1; renderMixer(); syncAudio(); drawWaves(); };
        // posun stopy: kladný = zvuk meškal, berie sa o kúsok neskôr (doľava na posuvníku = skôr)
        const setOff = v => { x.off = Math.max(-500, Math.min(500, Math.round(v))); const b = row.querySelector('.mx-off'); b.innerHTML = '⇆' + (x.off ? ' ' + offTxt(x.off) : ''); b.classList.toggle('set', !!x.off); const rr = row.querySelector('[data-act=offr]'); rr.value = -x.off; rr.style.setProperty('--p', (500 - x.off) / 10 + '%'); row.querySelector('[data-act=off0]').disabled = !x.off; syncAudio(true); };
        row.querySelector('[data-act=offt]').onclick = () => { openOff = openOff === +row.dataset.k ? -1 : +row.dataset.k; renderMixer(); };
        row.querySelectorAll('[data-act=off]').forEach(b => b.onclick = () => { setOff((x.off || 0) - Number(b.dataset.d)); drawWaves(); });
        const orr = row.querySelector('[data-act=offr]');
        orr.oninput = () => setOff(-Number(orr.value));
        orr.onchange = drawWaves;
        row.querySelector('[data-act=off0]').onclick = () => { setOff(0); drawWaves(); };
      });
    }
    $('#keep', m).onchange = e => { keepTracks = e.target.checked; };

    /* level metre: z obálky hlasitosti aktívneho klipu, po hlasitosti v mixéri; pri pauze plynulo klesnú */
    let mraf = 0;
    function meters() {
      const bars = $$('[data-lvl]', m);
      if (bars.length) {
        const L = active ? active : null;
        const lt = L ? L.src.video.currentTime : 0;
        const ff = 1 - fadeAt(t);
        bars.forEach(b => {
          const k = +b.dataset.lvl, mx = mixer[k];
          let target = 0;
          if (playing && L && mx && mx.on) {
            const env = L.src.levels && L.src.levels[k];
            if (env) { const i = Math.floor((lt + (mx.off || 0) / 1000) * 20); target = (Math.max(env[i] || 0, env[i + 1] || 0) / 255) * mx.vol * ff; }
          }
          // logaritmická mierka (-48 dB … 0 dB), nad 0 dB = cez okraj
          const db = target > 0 ? 20 * Math.log10(target) : -99;
          const pct = Math.max(0, Math.min(100, (db + 48) / 48 * 100));
          const prev = meterDisp[k] || 0;
          const shown = pct > prev ? pct : prev * 0.9;
          meterDisp[k] = shown;
          b.style.width = shown.toFixed(1) + '%';
          b.classList.toggle('hot', db > -3);
        });
      }
      // bež ďalej len počas prehrávania alebo kým metre doklesnú (šetrí CPU na slabších PC)
      mraf = playing || meterDisp.some(v => v > 0.5) ? requestAnimationFrame(meters) : 0;
    }
    const wakeMeters = () => { if (!mraf) mraf = requestAnimationFrame(meters); };
    mraf = requestAnimationFrame(meters);

    /* ================= overlaye ================= */
    const svgP = e => { const pt = ov.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const r = pt.matrixTransform(ov.getScreenCTM().inverse()); return { x: Math.max(0, Math.min(OW, r.x)), y: Math.max(0, Math.min(H, r.y)) }; };

    function outlineCol(o) { return o.color === '#1d1d1f' ? '#fff' : '#000'; }
    /* stred objektu (okolo neho sa animuje zväčšenie) */
    function center(o) { return o.type === 'text' ? [o.x, o.y] : [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2]; }
    function overlayMarkup(o, time) {
      const st = animState(o, time, H);
      const inRange = time >= o.start - 0.001 && time <= o.end + 0.001;
      const op = inRange ? st.op : 0.35;
      const [cx, cy] = center(o);
      const tr = inRange && (st.sc !== 1 || st.dy) ? ` transform="translate(${cx} ${cy + st.dy}) scale(${st.sc}) translate(${-cx} ${-cy})"` : '';
      const head = `<g data-id="${o.id}" class="ov-item${sel === o ? ' sel' : ''}" opacity="${op.toFixed(3)}"${tr}>`;
      const out = outlineCol(o);
      if (o.type === 'text') {
        const M = textMetrics(o);
        const sw = Math.max(2, o.size * 0.13);
        let box = '';
        if (o.box) { const bw = M.w + M.padX * 2, bh = M.h + M.padY * 2; box = `<rect x="${o.x - bw / 2}" y="${o.y - bh / 2}" width="${bw}" height="${bh}" rx="${o.size * 0.28}" fill="rgba(0,0,0,.62)"/>`; }
        const glow = o.glow ? ` filter="url(#glow)"` : '';
        const stroke = o.outline !== false ? ` stroke="${out}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke"` : '';
        return `${head}${box}<text x="${o.x}" y="${o.y}" font-size="${o.size}" fill="${o.color}"${stroke}${glow} text-anchor="middle" dominant-baseline="central" style="font-family:${esc(M.f.css)};font-weight:${M.f.w}">${esc(M.txt || ' ')}</text></g>`;
      }
      const g = arrowGeom(o);
      const pts = `${g.tip.join(',')} ${g.l.join(',')} ${g.r.join(',')}`;
      return `${head}
        <line x1="${g.x1}" y1="${g.y1}" x2="${g.bx}" y2="${g.by}" stroke="${out}" stroke-width="${g.w * 1.5}" stroke-linecap="round" stroke-opacity=".55"/>
        <polygon points="${pts}" fill="${out}" stroke="${out}" stroke-width="${g.w * 0.5}" stroke-linejoin="round" stroke-opacity=".55" fill-opacity=".55"/>
        <line x1="${g.x1}" y1="${g.y1}" x2="${g.bx}" y2="${g.by}" stroke="${o.color}" stroke-width="${g.w}" stroke-linecap="round"/>
        <polygon points="${pts}" fill="${o.color}" stroke="${o.color}" stroke-width="${g.w * 0.25}" stroke-linejoin="round"/>
        <line class="hit" x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="transparent" stroke-width="${Math.max(30, g.w * 4)}"/></g>`;
    }
    function drawOverlays() {
      const defs = `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${H * 0.008}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
      let html = defs + overlays.filter(o => (t >= o.start - 0.001 && t <= o.end + 0.001) || o === sel).map(o => overlayMarkup(o, t)).join('');
      // vodiace čiary pri ťahaní textu na stred
      if (guides.x) html += `<line class="guide" x1="${OW / 2}" y1="0" x2="${OW / 2}" y2="${H}"/>`;
      if (guides.y) html += `<line class="guide" x1="0" y1="${H / 2}" x2="${OW}" y2="${H / 2}"/>`;
      if (sel && sel.type === 'arrow') { const k = H / 1080 * 9; html += `<circle class="hd" data-h="1" cx="${sel.x1}" cy="${sel.y1}" r="${k}"/><circle class="hd" data-h="2" cx="${sel.x2}" cy="${sel.y2}" r="${k}"/>`; }
      ov.innerHTML = html;
      ov.querySelectorAll('.hd').forEach(c => c.setAttribute('stroke-width', H / 1080 * 3));
      ov.querySelectorAll('.guide').forEach(c => c.setAttribute('stroke-width', H / 1080 * 2));
      if (sel && sel.type === 'text') {
        const M = textMetrics(sel), pad = sel.size * 0.18 + (sel.box ? M.padX * 0.6 : 0);
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('class', 'selbox');
        r.setAttribute('x', sel.x - M.w / 2 - pad); r.setAttribute('y', sel.y - M.h / 2 - pad); r.setAttribute('width', M.w + pad * 2); r.setAttribute('height', M.h + pad * 2);
        r.setAttribute('rx', pad); r.setAttribute('stroke-width', H / 1080 * 2.5);
        ov.appendChild(r);
      }
    }
    const guides = { x: false, y: false };
    function addOverlay(o) {
      remember();
      o.id = 'o' + (++seq);
      const D = total();
      o.start = Math.max(0, Math.min(t, D - 0.5));
      o.end = Math.min(D, o.start + 4);
      overlays.push(o);
      sel = o;
      showTab('text');
      renderOverlayLanes(); layoutOverlayLanes(); drawOverlays(); renderInspector();
      // nech je nový objekt hneď vidno (aj keď bolo prehrávanie na konci klipu)
      if (!playing) seek(Math.min(o.end - 0.05, o.start + 0.45), false);
    }
    function addText(preset, at) {
      if (playing) pause();
      const p = (PRESETS.find(x => x.id === preset) || PRESETS[0]).p;
      addOverlay({ type: 'text', x: at ? at.x : OW / 2, y: at ? at.y : H * 0.2, text: preset === 'meme' ? 'POZRI SA NA TO' : 'Text', size: Math.round(H * 0.075), ...p, animIn: 'pop', animOut: 'fade' });
      setTool('select');
      focusText();
    }
    const focusText = () => setTimeout(() => { const i = $('#oText', m); if (i) { i.focus(); i.select(); } }, 30);
    function selectOv(o) {
      sel = o;
      if (o) showTab('text');
      $$('.ov-bar', m).forEach(b => b.classList.toggle('sel', !!o && b.dataset.id === o.id));
      drawOverlays(); renderInspector();
    }
    function removeOv(o) {
      remember();
      overlays = overlays.filter(x => x !== o);
      if (sel === o) sel = null;
      renderOverlayLanes(); layoutOverlayLanes(); drawOverlays(); renderInspector();
    }
    const ovColor = o => o.color === '#ffffff' ? 'var(--text)' : o.color === '#1d1d1f' ? 'var(--muted)' : o.color;
    const ovLabel = o => o.type === 'text' ? (o.text || 'Text') : 'Šípka';
    function renderOverlayLanes() {
      $('#laneO', m).innerHTML = overlays.map(o => `<div class="tlx-lane ov-lane"><div class="ov-bar${sel === o ? ' sel' : ''}" data-id="${o.id}" style="--c:${ovColor(o)}">
        <i class="lane-h" data-e="s"></i><span>${o.type === 'text' ? IC.text : IC.arrow}<em>${esc(ovLabel(o))}</em></span><i class="lane-h" data-e="e"></i></div></div>`).join('');
    }
    function layoutOverlayLanes() {
      for (const o of overlays) {
        const el = $(`.ov-bar[data-id="${o.id}"]`, m); if (!el) continue;
        el.style.left = (o.start * pps) + 'px'; el.style.width = Math.max(10, (o.end - o.start) * pps) + 'px';
      }
    }
    function setTool(x) {
      tool = x;
      $$('[data-add]', m).forEach(b => b.classList.toggle('on', b.dataset.add === x));
      stage.dataset.tool = x;
      const hint = $('#hint', m);
      hint.hidden = x === 'select';
      hint.innerHTML = x === 'text' ? 'Klikni do videa, kam chceš text <kbd>Esc</kbd>' : x === 'arrow' ? 'Ťahaj od začiatku po hrot šípky <kbd>Esc</kbd>' : '';
    }

    /* ---------- prehrávanie na celú obrazovku ---------- */
    function toggleFs() {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
      else { selectOv(null); setTool('select'); stage.requestFullscreen().catch(() => { }); }
    }
    $('#fsBtn', m).onclick = e => { e.stopPropagation(); toggleFs(); };
    const volApi = UI.wireVol(m, () => { try { syncAudio(false); } catch (e) { } });
    $('#fsExit', m).onclick = e => { e.stopPropagation(); toggleFs(); };
    $('#fsPlay', m).onclick = e => { e.stopPropagation(); toggle(); };
    $('#fsProg', m).addEventListener('pointerdown', e => {
      e.stopPropagation();
      const bar = e.currentTarget, r = bar.getBoundingClientRect();
      const go = ev => seek(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * total(), playing);
      go(e); bar.setPointerCapture(e.pointerId);
      const up = () => { bar.removeEventListener('pointermove', go); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', go); bar.addEventListener('pointerup', up);
    });
    let fsIdle = 0;
    const fsWake = () => { stage.classList.remove('fs-idle'); clearTimeout(fsIdle); fsIdle = setTimeout(() => { if (playing) stage.classList.add('fs-idle'); }, 2200); };
    stage.addEventListener('pointermove', () => { if (document.fullscreenElement === stage) fsWake(); });
    const onFs = () => {
      const on = document.fullscreenElement === stage;
      stage.classList.toggle('fs', on); stage.classList.remove('fs-idle');
      if (on) fsWake();
      requestAnimationFrame(() => { layoutFrame(); layoutHead(); });
      if (!on) setTimeout(() => { placeInd(); fitZoom(true); layoutAll(); }, 120);
    };
    document.addEventListener('fullscreenchange', onFs);
    stage.addEventListener('pointerdown', e => {
      if (document.fullscreenElement === stage) { if (e.button === 0 && !e.target.closest('.ed-fs')) toggle(); return; }
      if (!segs.length || e.button !== 0 || rgEdit) return;
      const p = svgP(e);
      const hitHandle = e.target.closest('.hd'), hitItem = e.target.closest('.ov-item');
      const drag = (move, end) => {
        stage.setPointerCapture(e.pointerId);
        const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); end && end(); };
        stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up);
      };
      if (tool === 'text') { addText('classic', p); return; }
      if (tool === 'arrow') {
        if (playing) pause();
        const o = { type: 'arrow', x1: p.x, y1: p.y, x2: p.x + 1, y2: p.y + 1, size: Math.round(H * 0.012), color: '#ff453a', animIn: 'pop', animOut: 'fade' };
        addOverlay(o);
        drag(ev => { const q = svgP(ev); o.x2 = q.x; o.y2 = q.y; drawOverlays(); }, () => {
          if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < OW * 0.02) { o.x2 = o.x1 + OW * 0.08; o.y2 = o.y1 - H * 0.08; }
          setTool('select'); drawOverlays();
        });
        return;
      }
      if (hitHandle && sel) {
        remember();
        const h = hitHandle.dataset.h;
        drag(ev => { const q = svgP(ev); if (h === '1') { sel.x1 = q.x; sel.y1 = q.y; } else { sel.x2 = q.x; sel.y2 = q.y; } drawOverlays(); });
        return;
      }
      if (hitItem) {
        const o = overlays.find(x => x.id === hitItem.dataset.id); if (!o) return;
        if (sel !== o) selectOv(o);
        if (playing) pause();
        let last = p, moved = false;
        drag(ev => {
          const q = svgP(ev), dx = q.x - last.x, dy = q.y - last.y; last = q;
          if (!moved) { moved = true; remember(); }
          if (o.type === 'text') {
            o.x += dx; o.y += dy;
            // pri strede obrazu sa text prichytí (Alt = bez prichytenia)
            const th = H * 0.02, sx = Math.abs(o.x - OW / 2) < th && !ev.altKey, sy = Math.abs(o.y - H / 2) < th && !ev.altKey;
            guides.x = sx; guides.y = sy;
            if (sx) { last.x += OW / 2 - o.x; o.x = OW / 2; }
            if (sy) { last.y += H / 2 - o.y; o.y = H / 2; }
          } else { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
          drawOverlays();
        }, () => { guides.x = guides.y = false; drawOverlays(); });
        return;
      }
      if (sel) { selectOv(null); return; }
      if (cropped()) {
        // vo výreze: ťahanie posúva výrez úseku pod prehrávaním, klik bez pohybu = prehrať/pozastaviť
        const L = locate(t), seg = L && L.seg; if (!seg) return;
        const x0 = e.clientX, c0 = seg.cx != null ? seg.cx : 0.5;
        let moved = false;
        drag(ev => {
          if (!moved && Math.abs(ev.clientX - x0) < 4) return;
          if (!moved) { moved = true; remember(); if (playing) pause(); stage.classList.add('panning'); }
          // video ide s myšou → výrez opačne; pri strede sa prichytí
          let cx = c0 - (ev.clientX - x0) / fk / W;
          if (!ev.altKey && Math.abs(cx - 0.5) < 0.015) cx = 0.5;
          setCx(seg, cx);
        }, () => {
          stage.classList.remove('panning');
          if (!moved) { toggle(); flashIcon(playing ? I.play : I.pause); }
          else if (tab === 'seg') renderSegPane();
        });
        return;
      }
      toggle(); flashIcon(playing ? I.play : I.pause);
    });
    stage.addEventListener('dblclick', e => { const it = e.target.closest('.ov-item'); if (it && sel && sel.type === 'text') focusText(); });
    stage.addEventListener('wheel', e => {
      if (!sel || !e.target.closest('.ov-item')) return;
      e.preventDefault();
      sel.size = Math.max(sel.type === 'text' ? 12 : 2, Math.round(sel.size * (e.deltaY < 0 ? 1.08 : 1 / 1.08) * 10) / 10);
      drawOverlays(); renderInspector();
    }, { passive: false });

    const presetTile = p => `<button class="pst pst-${p.id}" data-pst="${p.id}" title="${esc(p.label)}"><span style="font-family:${esc(FONTS[p.p.font].css)};font-weight:${FONTS[p.p.font].w};color:${p.p.color}">${p.p.upper ? 'AA' : 'Aa'}</span>${esc(p.label)}</button>`;
    function renderInspector() {
      const box = $('#insp', m);
      if (!sel) {
        box.innerHTML = `
          <div class="add-row">
            <button class="add-big" data-add="text">${IC.text}<b>Text</b><small>T</small></button>
            <button class="add-big" data-add="arrow">${IC.arrow}<b>Šípka</b><small>A</small></button>
          </div>
          <h5 class="in-h">Rýchly štýl</h5>
          <div class="in-presets grid">${PRESETS.map(presetTile).join('')}</div>
          <h5 class="in-h">V klipe ${overlays.length ? `<span>${overlays.length}</span>` : ''}</h5>
          ${overlays.length ? `<div class="ov-list">${overlays.slice().sort((a, b) => a.start - b.start).map(o => `<div class="ov-it" data-id="${o.id}" style="--c:${ovColor(o)}">${o.type === 'text' ? IC.text : IC.arrow}<b>${esc(ovLabel(o))}</b><small>${durMs(o.start)} – ${durMs(o.end)}</small><button class="ov-x" data-del="${o.id}" title="Odstrániť">${I.x}</button></div>`).join('')}</div>`
            : '<div class="ed-empty">Zatiaľ nič. Klikni na <b>Text</b> alebo na štýl a text sa objaví na 4 sekundy od miesta prehrávania. Dĺžku zmeníš ťahaním okrajov jeho pásika na osi.</div>'}`;
        $$('[data-add]', box).forEach(b => b.onclick = () => { if (b.dataset.add === 'text') addText('classic'); else { if (playing) pause(); setTool(tool === 'arrow' ? 'select' : 'arrow'); } });
        $$('[data-pst]', box).forEach(b => b.onclick = () => addText(b.dataset.pst));
        $$('.ov-it', box).forEach(r => r.onclick = e => {
          const o = overlays.find(x => x.id === r.dataset.id); if (!o) return;
          if (e.target.closest('[data-del]')) { removeOv(o); return; }
          seek(o.start + 0.05, false); selectOv(o);
        });
        setTool(tool);
        return;
      }
      const o = sel;
      const max = o.type === 'text' ? Math.round(H * 0.25) : Math.round(H * 0.04), min = o.type === 'text' ? 12 : 2;
      const isT = o.type === 'text';
      box.innerHTML = `
        <div class="in-top"><button class="in-back" id="oBack">${IC.back}<span>Všetko</span></button><b>${isT ? 'Text' : 'Šípka'}</b><button class="btn small ghost danger-text" id="oDel" title="Delete">${I.trash}<span>Odstrániť</span></button></div>
        ${isT ? `<input class="input" id="oText" value="${esc(o.text)}" placeholder="Napíš text…" spellcheck="false">
        <div class="in-presets">${PRESETS.map(presetTile).join('')}</div>
        <div class="in-row"><span>Písmo</span><div class="in-flags">${UI.seg('font', Object.entries(FONTS).map(([v, f]) => ({ v, l: f.label })), o.font || 'inter')}</div></div>
        <div class="in-row"><span>Štýl</span><div class="in-flags">
          <button class="chipt${o.outline !== false ? ' on' : ''}" data-flag="outline">Obrys</button>
          <button class="chipt${o.box ? ' on' : ''}" data-flag="box">Pozadie</button>
          <button class="chipt${o.glow ? ' on' : ''}" data-flag="glow">Žiara</button>
          <button class="chipt${o.upper ? ' on' : ''}" data-flag="upper">VEĽKÉ</button></div></div>` : ''}
        <div class="in-row"><span>Farba</span><div class="swatches sm">${COLORS.map(c => `<button style="--sw:${c}" data-c="${c}" class="${c === o.color ? 'on' : ''}" aria-label="${c}"></button>`).join('')}</div></div>
        <div class="in-row"><span>${isT ? 'Veľkosť' : 'Hrúbka'}</span><input type="range" id="oSize" min="${min}" max="${max}" step="1" value="${Math.round(o.size)}" style="--p:${(o.size - min) / (max - min) * 100}%"></div>
        ${isT ? `<div class="in-row"><span>Poloha</span><div class="in-flags"><button class="chipt" data-pos="top">Hore</button><button class="chipt" data-pos="mid">Stred</button><button class="chipt" data-pos="bot">Dole</button></div></div>` : ''}
        <h5 class="in-h">Animácia</h5>
        <div class="in-row"><span>Objavenie</span>${UI.seg('animIn', ANIM_IN, o.animIn || 'none')}</div>
        <div class="in-row"><span>Zmiznutie</span>${UI.seg('animOut', ANIM_OUT, o.animOut || 'none')}</div>
        <h5 class="in-h">Kedy</h5>
        <div class="in-time"><button class="btn small" id="oFrom" title="Začiatok na miesto prehrávania"></button><span>–</span><button class="btn small" id="oTo" title="Koniec na miesto prehrávania"></button><button class="btn small ghost" id="oAll">celé video</button></div>
        <p class="sp-hint">Klikni na čas a nastaví sa na miesto prehrávania. Alebo ťahaj pásik na osi.</p>`;
      updInspTimes();
      const ti = $('#oText', box);
      let typed = false;
      if (ti) {
        ti.oninput = () => { if (!typed) { typed = true; remember(); } o.text = ti.value; drawOverlays(); const em = $(`.ov-bar[data-id="${o.id}"] em`, m); if (em) em.textContent = ovLabel(o); };
        ti.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ti.blur(); } };
      }
      $('#oBack', box).onclick = () => selectOv(null);
      $$('[data-c]', box).forEach(b => b.onclick = () => { remember(); o.color = b.dataset.c; drawOverlays(); renderOverlayLanes(); layoutOverlayLanes(); renderInspector(); });
      $$('[data-pos]', box).forEach(b => b.onclick = () => { remember(); o.x = OW / 2; o.y = { top: H * 0.16, mid: H / 2, bot: H * 0.84 }[b.dataset.pos]; drawOverlays(); });
      const sz = $('#oSize', box);
      sz.onpointerdown = () => remember();
      sz.oninput = () => { o.size = Number(sz.value); sz.style.setProperty('--p', (o.size - min) / (max - min) * 100 + '%'); drawOverlays(); };
      $('#oFrom', box).onclick = () => { remember(); o.start = Math.min(t, o.end - 0.2); layoutOverlayLanes(); updInspTimes(); drawOverlays(); };
      $('#oTo', box).onclick = () => { remember(); o.end = Math.max(t, o.start + 0.2); layoutOverlayLanes(); updInspTimes(); drawOverlays(); };
      $('#oAll', box).onclick = () => { remember(); o.start = 0; o.end = total(); layoutOverlayLanes(); updInspTimes(); drawOverlays(); };
      $('#oDel', box).onclick = () => removeOv(o);
      UI.placeThumbs(box);
      $$('[data-pst]', box).forEach(b => b.onclick = () => { remember(); Object.assign(o, PRESETS.find(p => p.id === b.dataset.pst).p); drawOverlays(); renderOverlayLanes(); layoutOverlayLanes(); renderInspector(); });
      $$('[data-flag]', box).forEach(b => b.onclick = () => { remember(); const k = b.dataset.flag; o[k] = k === 'outline' ? o.outline === false : !o[k]; b.classList.toggle('on'); drawOverlays(); });
      box.querySelectorAll('.seg').forEach(sg => sg.addEventListener('click', e => {
        const bt = e.target.closest('button'); if (!bt) return;
        remember(); o[sg.dataset.seg] = bt.dataset.v;
        sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === bt)); UI.placeThumbs(box, true);
        drawOverlays();
        // ukáž animáciu: skoč kúsok pred objavenie / zmiznutie
        if (sg.dataset.seg === 'animIn') { seek(o.start, false); playPreview(o.start, Math.min(o.end, o.start + 0.8)); }
        if (sg.dataset.seg === 'animOut') { playPreview(Math.max(o.start, o.end - 0.8), o.end); }
      }));
    }
    /* krátka ukážka animácie bez spustenia prehrávania */
    let prevRaf = 0;
    function playPreview(a, b) {
      cancelAnimationFrame(prevRaf);
      const t0 = performance.now(), len = (b - a) * 1000;
      const f = now => { const p = Math.min(1, (now - t0) / len); t = a + (b - a) * p; layoutHead(); drawOverlays(); if (p < 1 && !playing) prevRaf = requestAnimationFrame(f); else seek(t, false); };
      prevRaf = requestAnimationFrame(f);
    }
    function updInspTimes() {
      if (!sel) return;
      const f = $('#oFrom', m), to = $('#oTo', m);
      if (f) f.textContent = durMs(sel.start);
      if (to) to.textContent = durMs(sel.end);
    }

    /* PNG overlayu: orezaný na objekt a súmerný okolo jeho stredu, aby ffmpeg vedel zväčšovať okolo stredu */
    async function renderPng(o) {
      await document.fonts.ready;
      const [cx, cy] = center(o);
      const out = outlineCol(o);
      let minX, minY, maxX, maxY;
      if (o.type === 'text') {
        const M = textMetrics(o), extra = Math.max(M.padX, o.size * 0.2) + (o.glow ? H * 0.03 : 0);
        minX = o.x - M.w / 2 - extra; maxX = o.x + M.w / 2 + extra; minY = o.y - M.h / 2 - extra; maxY = o.y + M.h / 2 + extra;
      } else {
        const g = arrowGeom(o), pad = g.w * 2;
        const xs = [g.x1, g.tip[0], g.l[0], g.r[0]], ys = [g.y1, g.tip[1], g.l[1], g.r[1]];
        minX = Math.min(...xs) - pad; maxX = Math.max(...xs) + pad; minY = Math.min(...ys) - pad; maxY = Math.max(...ys) + pad;
      }
      const hw = Math.ceil(Math.max(cx - minX, maxX - cx)), hh = Math.ceil(Math.max(cy - minY, maxY - cy));
      const c = document.createElement('canvas'); c.width = hw * 2; c.height = hh * 2;
      const g = c.getContext('2d');
      g.translate(hw - cx, hh - cy);
      if (o.type === 'text') {
        const M = textMetrics(o);
        if (o.box) {
          const bw = M.w + M.padX * 2, bh = M.h + M.padY * 2, r = o.size * 0.28, x = o.x - bw / 2, y = o.y - bh / 2;
          g.fillStyle = 'rgba(0,0,0,.62)'; g.beginPath(); g.roundRect(x, y, bw, bh, r); g.fill();
        }
        g.font = `${M.f.w} ${o.size}px ${M.f.css}`;
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        if (o.outline !== false) { g.lineWidth = Math.max(2, o.size * 0.13); g.strokeStyle = out; g.strokeText(M.txt, o.x, o.y); }
        if (o.glow) { g.shadowColor = o.color; g.shadowBlur = H * 0.025; g.fillStyle = o.color; g.fillText(M.txt, o.x, o.y); g.fillText(M.txt, o.x, o.y); g.shadowBlur = 0; }
        g.fillStyle = o.color; g.fillText(M.txt, o.x, o.y);
      } else {
        const a = arrowGeom(o);
        const shape = (w, col, alpha, hs) => {
          g.globalAlpha = alpha; g.strokeStyle = col; g.fillStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
          g.lineWidth = w; g.beginPath(); g.moveTo(a.x1, a.y1); g.lineTo(a.bx, a.by); g.stroke();
          g.lineWidth = hs; g.beginPath(); g.moveTo(...a.tip); g.lineTo(...a.l); g.lineTo(...a.r); g.closePath(); g.fill(); g.stroke();
        };
        shape(a.w * 1.5, out, 0.55, a.w * 0.5);
        shape(a.w, o.color, 1, a.w * 0.25);
        g.globalAlpha = 1;
      }
      return { png: c.toDataURL('image/png'), cx, cy };
    }

    /* ================= názov a akcie s klipom ================= */
    function renderTitle() {
      const row = $('#titleRow', m), acts = $('#srcActions', m);
      if (single()) {
        const src = [...sources.values()][0];
        if (!row.querySelector('#plName')) {
          row.innerHTML = `<input id="plName" value="${esc(src.name)}" spellcheck="false" aria-label="Názov" title="Klikni a premenuj"><span class="pl-meta">${esc(dayLabel(src.mtime))} ${esc(time(src.mtime))} · ${esc(size(src.size))}</span>`;
          bindRename(src);
        }
        if (!acts.firstChild) {
          acts.innerHTML = `<button class="ed-ico" id="bMore" title="Ďalšie">${IC.more}</button>`;
          $('#bMore', m).onclick = e => UI.menu(e.currentTarget, [
            { label: 'Ukázať v priečinku', v: 'reveal' }, { label: 'Otvoriť v prehrávači', v: 'ext' }, { sep: true }, { label: 'Vymazať klip…', v: 'del' }
          ], it => {
            if (it.v === 'reveal') api.action('reveal', { path: src.path });
            else if (it.v === 'ext') { pause(); api.action('openExternal', { path: src.path }); }
            else if (it.v === 'del') deleteSrc(src);
          });
        }
      } else {
        row.innerHTML = `<h3 class="ed-title">Strih <span>${sources.size} ${plural(sources.size, 'klip', 'klipy', 'klipov')}</span></h3><span class="pl-meta">${[...sources.values()].map(s => `<i class="src-dot" style="--c:${s.c}"></i>${esc(s.name)}`).join('<span class="sep"></span>')}</span>`;
        acts.innerHTML = '';
      }
    }
    async function deleteSrc(src) {
      const clip = { ...src };
      cleanup();
      const choice = await UI.trashDialog([clip]);
      if (!choice) { open([clip], opts); return; }
      try { await api.action('deleteClips', { paths: [clip.path], permanent: choice === 'delete' }); toast('ok', choice === 'delete' ? 'Vymazané' : 'V Koši', clip.name); }
      catch (e) { toast('error', 'Vymazanie zlyhalo', e.message); }
    }
    function bindRename(src) {
      const nameIn = $('#plName', m);
      const rename = async () => {
        const name = nameIn.value.trim();
        if (!name || name === src.name) { nameIn.value = src.name; return; }
        // Windows nedovolí premenovať otvorený súbor → na chvíľu ho pustíme
        const keepT = t; pause();
        const v = src.video; v.removeAttribute('src'); v.load();
        try {
          const to = await api.action('rename', { path: src.path, name });
          sources.delete(src.path); src.path = to; src.name = name; sources.set(to, src);
          segs.forEach(s => { s.src = to; });
          savedSnap = savedSnap && snap();
          toast('ok', 'Premenované', name);
        } catch (e) { toast('error', 'Premenovanie zlyhalo', e.message); nameIn.value = src.name; }
        v.src = fileUrl(src.path); v.addEventListener('loadedmetadata', () => seek(keepT, false), { once: true });
      };
      nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') nameIn.blur(); if (e.key === 'Escape') { e.stopPropagation(); nameIn.value = src.name; nameIn.blur(); } });
      nameIn.addEventListener('blur', rename);
    }

    /* ================= skratky ================= */
    function showHelp() {
      const l = showLayer(`<div class="kb">
        <div class="kb-h"><h3>Klávesové skratky</h3><button class="ed-ico" data-a="x">${I.x}</button></div>
        <div class="kb-grid">${KEYS.map(([h, rows]) => `<section><h5>${h}</h5>${rows.map(([k, d]) => `<div class="kb-r"><span>${k.split(' / ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</span><em>${esc(d)}</em></div>`).join('')}</section>`).join('')}</div></div>`, 'kb-layer');
      l.querySelector('[data-a=x]').onclick = hideLayer;
    }
    $('#bHelp', m).onclick = showHelp;

    /* ================= uloženie ================= */
    const sizeLabel = () => (SAVE_SIZES.find(x => x.v === saveMB) || SAVE_SIZES[0]).l;
    async function save() {
      if (saving || !segs.length) return;
      pause();
      saving = true;
      const D = total();
      const l = showLayer(`<div class="sv">
        <div class="sv-ring"><svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="27"/><circle class="fg" id="svRing" cx="32" cy="32" r="27"/></svg><b id="svPct">0 %</b></div>
        <h3>Ukladám strih…</h3><p>${dur(D)} · ${esc(sizeLabel())}${overlays.length ? ` · ${overlays.length} ${plural(overlays.length, 'objekt', 'objekty', 'objektov')}` : ''}</p></div>`, 'locked sv-layer');
      const setP = v => { const r = $('#svRing', l), pct = $('#svPct', l); if (r) r.style.strokeDashoffset = String(170 * (1 - v)); if (pct) pct.textContent = Math.round(v * 100) + ' %'; };
      Player._onEvent = ev => { if (ev.type === 'exportProgress') setP(ev.value); };
      try {
        const ovs = [];
        for (const o of overlays) if (o.end > 0 && o.start < D && (o.type !== 'text' || o.text.trim())) {
          const r = await renderPng(o);
          ovs.push({ ...r, start: o.start, end: o.end, animIn: o.animIn || 'none', animOut: o.animOut || 'none' });
        }
        const out = await api.action('exportSequence', {
          W, H, fps: FPS, keepTracks, targetMB: saveMB, cropW: OW < W ? OW : 0, region: RG,
          offsets: Object.fromEntries(mixer.filter(x => x.off).map(x => [x.i, x.off])),
          segments: segs.map(s => { const src = sources.get(s.src); return { file: src.path, in: s.in, out: s.out, cropX: OW < W ? cropLeft(s) : null, speed: sp(s), fadeIn: !!s.fadeIn, fadeOut: !!s.fadeOut, audio: src.tracks.length || (src.ready ? 0 : 1) }; }),
          overlays: ovs,
          tracks: (T ? mixer : [{ i: 0, on: true, vol: 1, title: 'Zvuk' }]).filter(x => x.on).map(x => ({ i: x.i, vol: x.vol, title: x.title })),
          allTracks: T ? titles : [...sources.values()].some(s => !s.ready) ? ['Zvuk'] : []
        });
        saving = false; savedSnap = snap();
        const name = String(out).split(/[\\/]/).pop();
        showLayer(`<div class="sv done">
          <svg class="cmp-check" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24"/><path d="M21 33l7.5 7L43 25"/></svg>
          <h3>Uložené</h3><p title="${esc(out)}">${esc(name)}</p>
          <div class="sv-acts">
            <button class="btn" data-a="copy">${IC.copy}<span>Kopírovať pre Discord</span></button>
            <button class="btn" data-a="reveal">${I.folder}<span>Ukázať v priečinku</span></button>
          </div>
          <div class="sv-acts"><button class="btn ghost" data-a="more">Upravovať ďalej</button><button class="btn primary" data-a="close">Zavrieť editor</button></div></div>`, 'sv-layer');
        const cb = l.querySelector('[data-a=copy]');
        cb.onclick = async () => { try { await api.action('copyFile', { path: out }); cb.classList.add('ok'); cb.querySelector('span').textContent = 'Skopírované, vlož cez Ctrl+V'; } catch (er) { toast('error', 'Kopírovanie zlyhalo', er.message); } };
        l.querySelector('[data-a=reveal]').onclick = () => api.action('reveal', { path: out });
        l.querySelector('[data-a=more]').onclick = hideLayer;
        l.querySelector('[data-a=close]').onclick = () => closeModal(true);
      } catch (e) {
        saving = false;
        hideLayer();
        toast('error', 'Uloženie zlyhalo', e.message);
      }
      Player._onEvent = null;
    }
    $('#plSave', m).onclick = save;
    $('#hqBtn', m).onclick = e => { const on = !UI.previewFull(); UI.setPreviewFull([...sources.values()].map(x => x.video), on); e.currentTarget.classList.toggle('on', on); toast('info', on ? 'Náhľad v plnej kvalite' : 'Rýchly náhľad', on ? 'Skákanie po klipe bude pomalšie.' : 'Náhľad z ľahkej kópie, uložené video je stále v plnej kvalite.'); };
    /* prenos do advanced editora: úseky, text, nastavenie stôp; video „preletí“ z tohto rámu */
    $('#bAdv', m).onclick = () => {
      if (!segs.length || !window.openStudio) return;
      pause();
      let img = null;
      try {
        const v = active && active.src && active.src.video;
        if (v && v.videoWidth) { const c = document.createElement('canvas'); c.width = Math.min(960, v.videoWidth); c.height = Math.round(c.width * v.videoHeight / v.videoWidth); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); img = c.toDataURL('image/jpeg', 0.8); }
      } catch (e) { }
      const fromRect = frame.getBoundingClientRect();
      const input = {
        clips: [...sources.values()].map(sr => ({ path: sr.path, name: sr.name, duration: sr.duration, width: sr.width, height: sr.height, fps: sr.fps })),
        // výrez na výšku: stred výrezu (cx) prepočítaný na polohu 0–1 ako v advanced editore
        segs: segs.map(sg => ({ src: sg.src, in: sg.in, out: sg.out, speed: sp(sg), fadeIn: !!sg.fadeIn, fadeOut: !!sg.fadeOut, cx: OW < W ? cropLeft(sg) / Math.max(1, W - OW) : 0.5 })),
        overlays: overlays.map(o => ({ ...o, W: OW, H })),
        mixer: mixer.map(x => ({ title: x.title, on: x.on, vol: x.vol })),
        aspect: aspect === '9:16' || aspect === '1:1' ? aspect : '16:9',
        name: single() ? [...sources.values()][0].name : 'Montáž',
        t
      };
      closeModal(true);
      window.openStudio(input, { fromRect, fromImage: img });
    };
    // voľba veľkosti pri uložení (Pôvodná / 20 MB pre Discord …)
    function renderSaveSize() {
      $('#saveSize', m).innerHTML = UI.pb(sizeLabel(), () => SAVE_SIZES.map(x => ({ label: x.l, v: x.v, checked: x.v === saveMB })), it => { saveMB = it.v; LS.set('saveMB', saveMB); renderSaveSize(); }, 'title="Veľkosť uloženého klipu"');
    }
    saveMB = Number(LS.get('saveMB', 0)) || 0;
    renderSaveSize();

    /* neuložené úpravy: spýtaj sa pred zatvorením */
    function beforeClose() {
      if (saving) return false;
      if (!dirty()) return true;
      if (playing) pause();
      const l = showLayer(`<div class="ask">
        <h3>Zahodiť úpravy?</h3><p>Strih ešte nie je uložený. Keď editor zavrieš, úpravy sa stratia.</p>
        <div class="acts"><button class="btn danger-text ghost" data-a="drop">Zahodiť</button><span class="grow"></span><button class="btn" data-a="stay">Pokračovať</button><button class="btn primary" data-a="save">${IC.save}<span>Uložiť</span></button></div></div>`, 'ask-layer');
      l.querySelector('[data-a=drop]').onclick = () => closeModal(true);
      l.querySelector('[data-a=stay]').onclick = hideLayer;
      l.querySelector('[data-a=save]').onclick = () => { hideLayer(); save(); };
      setTimeout(() => { const b = l.querySelector('[data-a=stay]'); b && b.focus(); }, 30);
      return false;
    }

    /* ================= klávesy a upratanie ================= */
    function cleanup() {
      if (closed) return;
      if (curCleanup === cleanup) curCleanup = null;
      openEd = Math.max(0, openEd - 1);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
      closed = true;
      playing = false; active = null; cancelAnimationFrame(raf); cancelAnimationFrame(mraf); cancelAnimationFrame(prevRaf);
      for (const el of media) killMedia(el);
      media.clear();
      for (const s of sources.values()) {
        killMedia(s.video);
        s.audios.forEach(killMedia);
      }
      document.removeEventListener('keydown', onKey, true);
      removeEventListener('resize', onResize);
      Player._onEvent = null;
    }
    function onKey(e) {
      if (!document.body.contains(m)) return;
      if (!layer.hidden) {
        if (e.key === 'Escape') { e.stopImmediatePropagation(); if (!layer.classList.contains('locked')) hideLayer(); }
        return;
      }
      if (e.target.closest('input:not([type=range]):not([type=checkbox]), textarea')) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (ctrl && k === 'y') { e.preventDefault(); redo(); return; }
      if (ctrl && k === 'd') { e.preventDefault(); duplicate(paneSeg()); return; }
      if (ctrl && k === 's') { e.preventDefault(); save(); return; }
      if (ctrl || e.altKey && !['arrowleft', 'arrowright'].includes(k)) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(t - (e.shiftKey ? 1 : 1 / FPS * (e.altKey ? 1 : 10)), false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(t + (e.shiftKey ? 1 : 1 / FPS * (e.altKey ? 1 : 10)), false); }
      else if (e.key === 'Home') seek(0, false);
      else if (e.key === 'End') seek(total(), false);
      else if (k === 's') split();
      else if (k === 'q') trimTo('l');
      else if (k === 'w') trimTo('r');
      else if (k === 'n') setSnap(!snapOn);
      else if (k === 'm') jumpMark(e.shiftKey ? -1 : 1);
      else if (k === 'f') toggleFs();
      else if (k === 't') { if (playing) pause(); setTool('text'); }
      else if (k === 'a') { if (playing) pause(); setTool('arrow'); }
      else if (e.key === '?') showHelp();
      else if (k === 'v' || (e.key === 'Escape' && (tool !== 'select' || sel || selSeg))) {
        e.stopImmediatePropagation();
        if (tool !== 'select') setTool('select'); else if (sel) selectOv(null); else { selSeg = null; updSel(); }
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (sel) removeOv(sel); else if (selSeg) removeSeg(selSeg); }
    }
    document.addEventListener('keydown', onKey, true);
    const onResize = () => { const ratio = fitPps ? pps / fitPps : 1; fitZoom(); pps = fitPps * ratio; layoutAll(); showTab(tab); };
    addEventListener('resize', onResize);
    $('#plClose', m).onclick = () => closeModal();

    setTool('select'); renderInspector();
    requestAnimationFrame(() => showTab('text'));
    init().catch(e => { toast('error', 'Editor sa nepodarilo otvoriť', e.message); closeModal(true); });
  }

  return { open, busy: () => openEd > 0, _onEvent: null };
})();
