/* LookAtThis — hlavná logika okna */
(function () {
  const { $, $$, esc, I, pb, seg, placeThumbs, onSeg, toast, sound, dur, size, dayLabel, time, fileUrl } = UI;
  let S = null;            // celý stav z main procesu
  let view = 'clips';
  let filter = 'all', query = '';
  let lastLevels = {};
  const seenClips = new Set();
  let firstRender = true;
  let lastSig = '';
  const picked = new Set();   // vybrané klipy (cesty)
  let anchor = null, visible = [];

  const TRACK_LOOK = {
    system: { c: '#0a84ff', ic: '<svg viewBox="0 0 20 20"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 7a4 4 0 0 1 0 6M15.8 4.8a7 7 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>', hint: 'Všetko, čo počuješ v slúchadlách alebo reproduktoroch.' },
    game: { c: '#ff9f0a', ic: '<svg viewBox="0 0 20 20"><path d="M6 6.5h8a4 4 0 0 1 3.9 4.8l-.6 2.9a2 2 0 0 1-3.4 1l-1.9-2.2H8l-1.9 2.2a2 2 0 0 1-3.4-1l-.6-2.9A4 4 0 0 1 6 6.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6.5 9.3v2.4M5.3 10.5h2.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="13.3" cy="9.8" r=".9" fill="currentColor"/><circle cx="14.8" cy="11.5" r=".9" fill="currentColor"/></svg>', hint: 'Len zvuk hry, bez Discordu a hudby.' },
    discord: { c: '#bf5af2', ic: '<svg viewBox="0 0 20 20"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V13A2.5 2.5 0 0 1 4 10.5z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>', hint: 'Hlasový chat zvlášť, aby si ho mohol stlmiť pri strihu.' },
    mic: { c: '#30d158', ic: '<svg viewBox="0 0 20 20"><rect x="7.5" y="2.5" width="5" height="9.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>', hint: 'Tvoj mikrofón vo vlastnej stope.' }
  };
  const VIEWS = { clips: ['Klipy', ''], audio: ['Zvuk', 'Každá stopa ide do clipu zvlášť. Zariadenia hľadám podľa ID, nie podľa poradia.'], settings: ['Nastavenia', ''] };

  /* ---------- vzhľad ---------- */
  const mq = matchMedia('(prefers-color-scheme: dark)');
  function applyLook() {
    const s = S.settings;
    const scheme = s.appearance === 'light' || s.appearance === 'dark' ? s.appearance : (mq.matches ? 'dark' : 'light');
    document.documentElement.dataset.scheme = scheme;
    const hex = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : '#ff9f0a';
    const [r, g, b] = hex.slice(1).match(/.{2}/g).map(x => parseInt(x, 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-ink', lum > 0.5 ? '#1d1d1f' : '#ffffff');
  }
  mq.addEventListener('change', () => S && applyLook());

  async function save(patch) {
    try { S.settings = await api.action('saveSettings', patch); } catch (e) { toast('error', 'Nastavenie sa neuložilo', e.message); }
  }
  const setTrack = (id, patch) => save({ tracks: S.settings.tracks.map(t => t.id === id ? { ...t, ...patch } : t) });

  /* ---------- navigácia ---------- */
  function go(v) {
    const order = Object.keys(VIEWS);
    document.documentElement.style.setProperty('--view-dir', order.indexOf(v) >= order.indexOf(view) ? 1 : -1);
    view = v;
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    moveInd(true);
    $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
    const sec = $('#view-' + v); sec.classList.remove('enter'); void sec.offsetWidth; sec.classList.add('enter');
    render();
  }
  function moveInd() {
    const a = $('#nav button.active'), ind = $('#navInd');
    if (!a) return;
    ind.style.height = a.offsetHeight + 'px';
    ind.style.transform = `translateY(${a.offsetTop}px)`;
  }
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    if (b.dataset.view === 'clips' && folderF) { folderF = ''; LS.set('folder', ''); picked.clear(); updPicked(); foldSig = ''; if (view === 'clips') { renderChrome(); renderClips(); return; } }
    go(b.dataset.view);
  });

  /* ---------- hlavička a karta bufferu ---------- */
  function renderChrome() {
    const s = S.settings, e = S.engine;
    const rec = !!e.recording;
    const st = rec ? 'is-rec' : e.state;
    $('#rec').className = 'rec ' + st;
    $('#buf').className = 'buf ' + st;
    $('#bufToggle').checked = s.bufferEnabled;
    $('#hkClip').textContent = s.hotkeys.clip || '—';
    $('#hkRec').textContent = s.hotkeys.record || '—';
    $('#hkShortRow').hidden = !s.hotkeys.short; $('#hkShort').textContent = s.hotkeys.short || '';
    $('#hkShortRow span').textContent = `${s.shortSeconds || 15} s clip`;
    $('#bufEnc').textContent = e.encoder || '';
    $('#bufState').textContent = rec ? 'Nahrávam' : { on: 'Buffer beží', starting: 'Rozbieham…', error: 'Buffer spadol', off: 'Buffer vypnutý' }[e.state] || 'Buffer';
    $('#recBtn').textContent = rec ? 'Zastaviť' : 'Nahrávať';
    $('#clipBtn').disabled = e.state !== 'on';
    const game = e.tracks.game && e.tracks.game.status === 'bound' ? e.tracks.game.name.replace(/\.exe$/i, '') : '';
    if (rec) { $('#recWhat').textContent = game ? `Nahrávam · ${game}` : 'Nahrávam obrazovku'; $('#recSub').textContent = `Zastavíš cez ${s.hotkeys.record}`; }
    else if (e.state === 'on') { $('#recWhat').textContent = game ? `Pripravený · ${game}` : 'Replay buffer beží'; $('#recSub').textContent = `${s.hotkeys.clip} uloží posledných ${dur(s.bufferSeconds)}`; }
    else if (e.state === 'starting') { $('#recWhat').textContent = 'Rozbieham buffer…'; $('#recSub').textContent = 'Hľadám enkodér a zvuk'; }
    else if (e.state === 'error') { $('#recWhat').textContent = 'Buffer spadol'; $('#recSub').textContent = e.error || 'Pozri log v Nastaveniach'; }
    else { $('#recWhat').textContent = 'Buffer je vypnutý'; $('#recSub').textContent = 'Zapni ho vľavo dole'; }
    const missing = S.settings.tracks.some(t => t.on && e.tracks[t.id] && ['missing', 'error'].includes(e.tracks[t.id].status) && t.kind === 'device');
    $('#audioWarn').hidden = !missing;
    $('#clipCount').textContent = S.clips.filter(c => !c.folder).length || '';
    renderFolders(); renderUpdPill(); renderRecWarn();
    updateLive({ buffered: e.buffered, recording: e.recording ? Date.now() - e.recording.since : 0 });
    const [title, sub] = VIEWS[view];
    $('#viewTitle').textContent = view === 'clips' && folderF ? folderF : title;
    $('#viewSub').textContent = view === 'clips' ? clipsSub() : sub;
  }
  function clipsSub() {
    const L = here();
    if (!L.length) return folderF ? 'Priečinok je prázdny' : 'Zatiaľ prázdne';
    const total = L.reduce((a, c) => a + c.size, 0);
    return `${folderF ? 'Priečinok · ' : ''}${L.length} ${L.length === 1 ? 'video' : L.length < 5 ? 'videá' : 'videí'} · ${size(total)}`;
  }

  /* ---------- priečinky v ľavom paneli (skutočné podpriečinky na disku) ---------- */
  const FOLDER_IC = '<svg viewBox="0 0 20 20"><path d="M2.5 6A1.5 1.5 0 0 1 4 4.5h3.6l1.8 2H16A1.5 1.5 0 0 1 17.5 8v6.5A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  let foldSig = '';
  function renderFolders() {
    const fs = S.folders || [];
    const counts = {}; S.clips.forEach(c => { if (c.folder) counts[c.folder] = (counts[c.folder] || 0) + 1; });
    const sig = fs.map(f => f + counts[f]).join('|') + '#' + folderF + view;
    $$('#nav button[data-view=clips]').forEach(b => b.classList.toggle('active', view === 'clips' && !folderF));
    $('#navInd').style.opacity = view === 'clips' && folderF ? 0 : 1;
    if (sig === foldSig) return; foldSig = sig;
    $('#folders').innerHTML = `<div class="fold-h"><span>Priečinky</span><button class="fold-add" id="addFold" title="Nový priečinok"><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>
      ${fs.map(f => `<button class="fold${view === 'clips' && folderF === f ? ' on' : ''}" data-folder="${esc(f)}" title="${esc(f)} · pravý klik = možnosti">${FOLDER_IC}<span>${esc(f)}</span><i>${counts[f] || ''}</i></button>`).join('')
        || '<button class="fold ghost" id="addFold2">' + FOLDER_IC + '<span>Nový priečinok</span></button>'}`;
  }
  function openFolderView(f) {
    folderF = f; LS.set('folder', f); gameF = ''; LS.set('gameF', '');
    picked.clear(); updPicked(); foldSig = '';
    if (view !== 'clips') go('clips'); else { renderChrome(); renderClips(); }
    $('#view-clips').scrollTop = 0;
  }
  async function newFolder() {
    const name = await askText('Nový priečinok', `Vytvorí sa naozajstný priečinok v <b>${esc(S.settings.clipsDir)}</b>, takže ho uvidíš aj v Prieskumníkovi.`, '', 'napr. Best of, Na YouTube…');
    const v = name && name.value; // askText vracia { value }
    if (!v) return null;
    try { return await api.action('createFolder', { name: v }); } catch (e) { toast('error', 'Priečinok sa nevytvoril', e.message); return null; }
  }
  async function moveTo(paths, folder) {
    if (!paths.length) return;
    try {
      const r = await api.action('moveClips', { paths, folder });
      picked.clear(); updPicked();
      const n = r.moved.length;
      toast(r.failed.length ? 'error' : 'ok', folder ? `Presunuté do ${folder}` : 'Presunuté do Klipy', r.failed.length ? `Nepodarilo sa: ${r.failed.join(', ')} (je klip otvorený v inej appke?)` : `${n} ${n === 1 ? 'klip' : n < 5 ? 'klipy' : 'klipov'}`);
    } catch (e) { toast('error', 'Presun zlyhal', e.message); }
  }
  /* menu „Presunúť do priečinka“ pre klipy */
  function moveMenu(anchor, paths) {
    const cur = new Set(S.clips.filter(c => paths.includes(c.path)).map(c => c.folder || ''));
    const items = [{ head: 'Presunúť do' },
      ...(cur.size === 1 && cur.has('') ? [] : [{ label: 'Klipy (hlavný priečinok)', v: '' }]),
      ...(S.folders || []).filter(f => !(cur.size === 1 && cur.has(f))).map(f => ({ label: f, v: f })),
      { sep: true }, { label: 'Nový priečinok…', v: '__new' }];
    UI.menu(anchor, items, async it => {
      if (it.v === '__new') { const f = await newFolder(); if (f) moveTo(paths, f); }
      else moveTo(paths, it.v);
    });
  }
  const pointAnchor = (x, y) => ({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }), contains: () => false, classList: { contains: () => false, add() { }, remove() { } } });
  $('#folders').addEventListener('click', async e => {
    if (e.target.closest('#addFold, #addFold2')) { const f = await newFolder(); if (f) openFolderView(f); return; }
    const b = e.target.closest('.fold[data-folder]'); if (b) openFolderView(b.dataset.folder);
  });
  $('#folders').addEventListener('contextmenu', e => {
    const b = e.target.closest('.fold[data-folder]'); if (!b) return;
    e.preventDefault();
    const f = b.dataset.folder, n = S.clips.filter(c => c.folder === f).length;
    UI.menu(b, [{ label: 'Otvoriť v Prieskumníkovi', v: 'open' }, { label: 'Premenovať…', v: 'ren' }, { sep: true }, { label: 'Zrušiť priečinok…', v: 'del' }], async it => {
      if (it.v === 'open') api.action('openFolder', { folder: f });
      if (it.v === 'ren') {
        const r = await askText('Premenovať priečinok', 'Premenuje sa aj na disku.', f, f), to = r && r.value;
        if (!to || to === f) return;
        try { const nn = await api.action('renameFolder', { from: f, to }); if (folderF === f) { folderF = nn; LS.set('folder', nn); } } catch (er) { toast('error', 'Premenovanie zlyhalo', er.message); }
      }
      if (it.v === 'del') {
        if (!await UI.confirm(`Zrušiť priečinok ${f}?`, n ? `${n} ${n === 1 ? 'klip sa presunie' : n < 5 ? 'klipy sa presunú' : 'klipov sa presunie'} späť do Klipy. Nič sa nevymaže.` : 'Priečinok je prázdny, zmizne aj z disku.', 'Zrušiť priečinok')) return;
        try {
          const r = await api.action('deleteFolder', { name: f });
          if (folderF === f) { folderF = ''; LS.set('folder', ''); }
          toast('ok', 'Priečinok zrušený', r.removed ? (r.moved ? `${r.moved} klipov je späť v Klipy` : '') : 'Klipy sú späť v Klipy. Priečinok na disku ostal, sú v ňom iné súbory.');
        } catch (er) { toast('error', 'Nepodarilo sa', er.message); }
      }
    });
  });
  // pustenie klipov na priečinok (alebo na „Klipy“ = späť do hlavného priečinka)
  const dropTarget = e => e.target.closest && (e.target.closest('.fold[data-folder]') || e.target.closest('#nav button[data-view=clips]'));
  document.addEventListener('dragover', e => {
    const t = dropTarget(e);
    $$('.drop-on').forEach(x => { if (x !== t) x.classList.remove('drop-on'); });
    if (!t || !dragPaths || Date.now() - dragAt > 60000) return;
    e.preventDefault(); t.classList.add('drop-on');
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
  document.addEventListener('drop', e => {
    const t = dropTarget(e);
    $$('.drop-on').forEach(x => x.classList.remove('drop-on'));
    if (!t || !dragPaths) return;
    e.preventDefault();
    const paths = dragPaths; dragPaths = null;
    const f = t.dataset.folder || '';
    moveTo(paths.filter(p => { const c = S.clips.find(x => x.path === p); return c && (c.folder || '') !== f; }), f);
  });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) $$('.drop-on').forEach(x => x.classList.remove('drop-on')); });
  function updateLive(d) {
    if (!S) return;
    const s = S.settings;
    const rec = d.recording > 0;
    const max = s.bufferSeconds || 60;
    $('#recTc').textContent = rec ? dur(d.recording / 1000) : S.engine.state === 'on' ? dur(d.buffered) : '0:00';
    $('#bufFill').style.width = (S.engine.state === 'on' || rec ? Math.min(100, (d.buffered / max) * 100) : 0) + '%';
    $('#bufText').textContent = rec ? `nahrávka ${dur(d.recording / 1000)}` : S.engine.state === 'on' ? `${dur(d.buffered)} z` : S.engine.state === 'error' ? 'klikni Skúsiť znova' : 'ukladá';
    const bl = $('#bufLen'); bl.hidden = rec || S.engine.state === 'error';
    const lt = BUF_LENS.find(x => x.v === max), want = (lt ? lt.l : dur(max));
    if (bl.dataset.v !== want) { bl.dataset.v = want; bl.innerHTML = `${esc(want)}${UI.I.chev}`; }
  }

  const BUF_LENS = [15, 30, 60, 120, 180, 300, 600].map(v => ({ v, l: v < 60 ? v + ' s' : v / 60 + ' min' }));
  // rýchla voľba dĺžky buffra priamo v ľavom paneli
  $('#bufLen').addEventListener('click', e => {
    e.stopPropagation();
    const cur = S.settings.bufferSeconds;
    UI.menu(e.currentTarget, [{ head: 'Uložiť posledných' }, ...BUF_LENS.map(x => ({ label: x.l, v: x.v, checked: x.v === cur, sub: x.v === 600 ? 'viac miesta na disku' : '' }))], it => {
      save({ bufferSeconds: it.v }).then(() => { if (S) updateLive({ buffered: S.engine.buffered || 0, recording: 0 }); toast('ok', 'Dĺžka clipu', `Skratka uloží posledných ${it.label}`); });
    });
  });
  $('#bufToggle').addEventListener('change', e => api.action('setBuffer', { on: e.target.checked }));
  $('#clipBtn').addEventListener('click', () => { api.action('saveClip'); $('#rec').classList.remove('flash'); void $('#rec').offsetWidth; $('#rec').classList.add('flash'); });
  $('#recBtn').addEventListener('click', () => api.action('toggleRecord'));
  $('#buf').addEventListener('click', e => { if (S && S.engine.state === 'error' && !e.target.closest('.toggle')) api.action('restartEngine'); });
  $('#winMin').onclick = () => api.action('win', { do: 'min' });
  $('#winMax').onclick = () => api.action('win', { do: 'max' });
  $('#winClose').onclick = () => api.action('win', { do: 'close' });

  /* ---------- KLIPY ---------- */
  // pohľad si pamätáme v prehliadači (len pohodlie, nič dôležité)
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('clipit.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('clipit.' + k, JSON.stringify(v)); } catch (e) { } }
  };
  let folderF = LS.get('folder', ''), dragPaths = null, dragAt = 0;
  const here = () => S.clips.filter(c => (c.folder || '') === folderF);
  let dateR = null; // rozsah dátumov z kalendára
  let gameF = LS.get('gameF', ''), sortBy = LS.get('sort', 'new'), groupBy = LS.get('group', 'day');
  filter = LS.get('kind', 'all');
  const KIND_WORDS = { small: 'zmensene zmenseny discord mensie upravene',  rec: 'nahravka nahravky recording rec', trim: 'orez trim upravene', edit: 'upravene uprava edit', cut: 'strih strihy spojene cut upravene', clip: 'clip clipy klip klipy' };
  const SORTS = { new: 'Najnovšie', old: 'Najstaršie', long: 'Najdlhšie', big: 'Najväčšie', name: 'Podľa názvu' };
  const GROUPS = { day: 'Podľa dní', game: 'Podľa hier', none: 'Bez skupín' };
  const STAR = '<svg viewBox="0 0 20 20"><path d="M10 2.6l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.9l5-.7z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // nainštalované hry: exe → názov a názov → ikonka (prepočíta sa len pri zmene zoznamu)
  let detRef = null, detMapC = {}, iconMapC = {};
  function detCache() {
    if (detRef === S.installed) return;
    detRef = S.installed; detMapC = {}; iconMapC = {};
    for (const g of S.installed || []) { for (const e of g.exes || []) if (!detMapC[e]) detMapC[e] = g.name; if (g.icon) iconMapC[norm(g.name)] = g.icon; }
  }
  const gname = raw => { detCache(); return Games.pretty(raw, S.settings.gameNames || {}, detMapC); };
  const iconOf = name => { detCache(); return iconMapC[norm(name)] || null; };
  const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

  /* hľadanie: slová (bez diakritiky, všetky musia sedieť), >30s / <2m, hra:…, typ:…, obľúbené */
  function parseQuery(q) {
    const out = { words: [], min: null, max: null, games: [], kinds: [], fav: false };
    const toks = (String(q).match(/"[^"]*"|\S+/g) || []).map(x => x.replace(/^"|"$/g, ''));
    for (const raw of toks) {
      const t = norm(raw); let m;
      if (!t) continue;
      if ((m = /^([<>])=?(\d+(?:[.,]\d+)?)(s|sek|m|min|h|hod)?$/.exec(t))) {
        const u = m[3] || 's';
        const v = parseFloat(m[2].replace(',', '.')) * (u[0] === 'h' ? 3600 : u[0] === 'm' ? 60 : 1);
        if (m[1] === '>') out.min = v; else out.max = v;
      } else if ((m = /^(hra|game|g):(.+)$/.exec(t))) out.games.push(m[2]);
      else if ((m = /^(typ|type|t):(.+)$/.exec(t))) out.kinds.push(m[2]);
      else if (['oblubene', 'oblubeny', 'fav', '★', '*'].includes(t)) out.fav = true;
      else out.words.push(t);
    }
    return out;
  }
  const isEmptyQ = pq => !pq.words.length && pq.min == null && pq.max == null && !pq.games.length && !pq.kinds.length && !pq.fav;
  function haystack(c) {
    const d = new Date(c.mtime);
    return norm([c.name, gname(c.game), c.game, KIND_WORDS[c.kind || 'clip'], dayLabel(c.mtime), `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`, `${d.getDate()}. ${d.getMonth() + 1}.`].join(' '));
  }
  function matches(c, pq) {
    if (pq.fav && !c.fav) return false;
    if (pq.min != null && !(c.duration > pq.min)) return false;
    if (pq.max != null && !(c.duration && c.duration < pq.max)) return false;
    if (pq.games.length && !pq.games.some(g => norm(gname(c.game)).includes(g) || norm(c.game).includes(g))) return false;
    if (pq.kinds.length && !pq.kinds.some(k => KIND_WORDS[c.kind || 'clip'].includes(k))) return false;
    if (pq.words.length) { const h = haystack(c); if (!pq.words.every(w => h.includes(w))) return false; }
    return true;
  }
  /* zvýraznenie zhôd bez ohľadu na diakritiku */
  function hl(text, words) {
    if (!words || !words.length) return esc(text);
    const chars = [...String(text)];
    const n = chars.map(ch => norm(ch)).join('');
    if (n.length !== chars.length) return esc(text);
    const mark = new Array(chars.length).fill(false);
    for (const w of words) { let i = n.indexOf(w); while (w && i >= 0) { for (let k = i; k < i + w.length; k++) mark[k] = true; i = n.indexOf(w, i + w.length); } }
    let out = '', on = false;
    chars.forEach((ch, i) => { if (mark[i] !== on) { out += mark[i] ? '<mark>' : '</mark>'; on = mark[i]; } out += esc(ch); });
    return on ? out + '</mark>' : out;
  }

  /* hry v knižnici: zlúčené podľa pekného názvu (staré „VALORANT-Win64-Shipping“ aj nové „VALORANT“) */
  function gameStats() {
    const map = new Map();
    for (const c of here()) {
      if (!c.game) continue;
      const key = gname(c.game);
      let g = map.get(key);
      if (!g) map.set(key, g = { key, raws: new Set(), count: 0, secs: 0, thumb: null, latest: 0 });
      g.raws.add(c.game); g.count++; g.secs += c.duration || 0;
      if (c.mtime > g.latest) { g.latest = c.mtime; g.thumb = c.thumb || g.thumb; }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.latest - a.latest);
  }
  function filtered() {
    const pq = parseQuery(query);
    const searching = !isEmptyQ(pq);
    // hľadanie ide cez všetky priečinky, inak len aktuálny priečinok
    let list = (searching ? S.clips : here()).filter(c => {
      // Clipy = surové z buffra, Upravené = všetko, čo prešlo editorom alebo zmenšením
      if (filter === 'cut') filter = 'edited';
      const edited = ['cut', 'edit', 'trim', 'small'].includes(c.kind || '');
      if (filter !== 'all' && (filter === 'clip' ? (edited || c.kind === 'rec') : filter === 'edited' ? !edited : c.kind !== filter)) return false;
      if (dateR && !Cal.inRange(c.mtime, dateR)) return false;
      if (gameF === '__fav' && !c.fav) return false;
      if (gameF === '__none' && c.game) return false;
      if (gameF && gameF[0] !== '_' && gname(c.game) !== gameF) return false;
      return matches(c, pq);
    });
    const cmp = {
      new: (a, b) => b.mtime - a.mtime, old: (a, b) => a.mtime - b.mtime,
      long: (a, b) => (b.duration || 0) - (a.duration || 0), big: (a, b) => b.size - a.size,
      name: (a, b) => a.name.localeCompare(b.name, 'sk', { numeric: true })
    }[sortBy] || ((a, b) => b.mtime - a.mtime);
    list = list.slice().sort(cmp);
    return { list, pq };
  }
  function groupsOf(list) {
    if (groupBy === 'none') return [{ label: '', items: list }];
    const groups = [], idx = new Map();
    for (const c of list) {
      const label = groupBy === 'game' ? (c.game ? gname(c.game) : 'Bez hry') : dayLabel(c.mtime);
      let g = idx.get(label);
      if (!g) { idx.set(label, g = { label, items: [], game: groupBy === 'game' && !!c.game }); groups.push(g); }
      g.items.push(c);
    }
    if (groupBy === 'game') groups.sort((a, b) => (a.label === 'Bez hry') - (b.label === 'Bez hry') || b.items.length - a.items.length);
    return groups;
  }
  function avatar(key, thumb, cls = '') {
    const icon = iconOf(key);
    if (icon) return `<i class="gav icon ${cls}" style="background-image:url('${esc(fileUrl(icon))}')"></i>`;
    return thumb ? `<i class="gav ${cls}" style="background-image:url('${esc(fileUrl(thumb))}')"></i>`
      : `<i class="gav ${cls}" style="--h:${hue(key)}">${esc((key[0] || '?').toUpperCase())}</i>`;
  }

  function renderClips(keep) {
    const root = $('#view-clips');
    root.classList.toggle('quiet', !!keep);
    for (const p of [...picked]) if (!S.clips.some(c => c.path === p)) picked.delete(p);
    if (folderF && !(S.folders || []).includes(folderF)) { folderF = ''; LS.set('folder', ''); }
    if (folderF && !here().length && !query) {
      visible = [];
      root.innerHTML = `<div class="empty">
        <svg class="art" viewBox="0 0 120 84"><path d="M14 22a6 6 0 0 1 6-6h22l8 8h50a6 6 0 0 1 6 6v38a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z" fill="var(--panel)" stroke="var(--line)" stroke-width="2" stroke-dasharray="6 6"/></svg>
        <h2>Priečinok ${esc(folderF)} je prázdny</h2><p>Pretiahni sem klipy myšou na priečinok vľavo, alebo pravý klik na klip → <b>Presunúť do priečinka</b>.</p>
        <p><button class="btn" id="openFold">${I.folder}<span>Otvoriť v Prieskumníkovi</span></button></p></div>`;
      $('#openFold', root).onclick = () => api.action('openFolder', { folder: folderF });
      updPicked();
      return;
    }
    if (!S.clips.length) {
      visible = [];
      root.innerHTML = `<div class="empty">
        <svg class="art" viewBox="0 0 120 84"><rect x="6" y="8" width="108" height="68" rx="12" fill="none" stroke="var(--line)" stroke-width="2" stroke-dasharray="6 6"/>
          <path d="M28 42c8-13 18.5-19.5 32-19.5S84 29 92 42c-8 13-18.5 19.5-32 19.5S36 55 28 42z" fill="var(--panel)" stroke="var(--line)" stroke-width="2"/>
          <g class="art-iris"><circle cx="60" cy="42" r="13" fill="var(--accent)"/><path d="M56.5 36v12l10-6z" fill="var(--ink)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/><circle cx="64.5" cy="36.5" r="2.6" fill="#fff" opacity=".9"/></g></svg>
        <h2>Zatiaľ nie je na čo pozerať</h2>        <p>Keď sa v hre stane niečo dobré, stlač <kbd>${esc(S.settings.hotkeys.clip)}</kbd>. Uloží sa posledných ${esc(dur(S.settings.bufferSeconds))}.</p>
        <p>Dlhšie nahrávanie spustíš a zastavíš cez <kbd>${esc(S.settings.hotkeys.record)}</kbd>.</p>
      </div>`;
      updPicked();
      return;
    }
    const games = gameStats();
    if (gameF && gameF[0] !== '_' && !games.some(g => g.key === gameF)) gameF = '';
    const H = here(), favN = H.filter(c => c.fav).length, noneN = H.filter(c => !c.game).length;
    const oldStrip = $('.gstrip', root), sl = oldStrip ? oldStrip.scrollLeft : 0;
    const oq = $('#q', root), qFocus = oq && document.activeElement === oq ? [oq.selectionStart, oq.selectionEnd] : null;
    const pill = (v, label, n, extra = '', title = '') => `<button class="gpill${gameF === v ? ' on' : ''}" data-g="${esc(v)}"${title ? ` title="${esc(title)}"` : ''}>${extra}<span>${esc(label)}</span><small>${n}</small></button>`;
    root.innerHTML = `
      <div class="gstrip">
        ${pill('', 'Všetky', H.length, '<i class="gav all">' + I.film + '</i>')}
        ${favN ? pill('__fav', 'Obľúbené', favN, `<i class="gav fav">${STAR}</i>`) : ''}
        ${games.map(g => pill(g.key, g.key, g.count, avatar(g.key, g.thumb), `${g.key} · ${g.count} · ${dur(g.secs)} · pravý klik = premenovať`)).join('')}
        ${noneN && games.length ? pill('__none', 'Bez hry', noneN, '<i class="gav none">?</i>') : ''}
      </div>
      <div class="tools">
        <label class="search qbox">${I.search}<input id="q" placeholder="Hľadať názov, hru, dátum…  (Ctrl+F)" value="${esc(query)}" spellcheck="false" autocomplete="off"><button class="qx" id="qx" aria-label="Vymazať"${query ? '' : ' hidden'}>${I.x}</button></label>
        ${seg('filter', [{ v: 'all', l: 'Všetko' }, { v: 'clip', l: 'Clipy' }, { v: 'rec', l: 'Nahrávky' }, { v: 'edited', l: 'Upravené' }], filter === 'cut' ? 'edited' : filter)}
        <button class="btn date-chip${dateR ? ' on' : ''}" id="dateBtn" title="Vybrať dátum alebo rozsah dátumov">${I.cal}<span>${dateR ? esc(Cal.label(dateR)) : 'Dátum'}</span>${dateR ? `<i class="dx" id="dateX" title="Zrušiť">${I.x}</i>` : ''}</button>
        <span class="grow"></span>
        ${pb(SORTS[sortBy], () => Object.entries(SORTS).map(([v, l]) => ({ label: l, v, checked: v === sortBy })), it => { sortBy = it.v; LS.set('sort', sortBy); renderClips(); }, 'title="Zoradiť"')}
        ${pb(GROUPS[groupBy], () => Object.entries(GROUPS).map(([v, l]) => ({ label: l, v, checked: v === groupBy })), it => { groupBy = it.v; LS.set('group', groupBy); renderClips(); }, 'title="Zoskupiť"')}
        <button class="btn icon" id="openDir" title="Otvoriť v Prieskumníkovi">${I.folder}</button>
      </div>
      <div class="qhint" id="qhint" hidden></div>
      <div id="results"></div>`;
    $('.gstrip', root).scrollLeft = sl;
    placeThumbs(root);
    const qi = $('#q', root);
    qi.addEventListener('input', () => { query = qi.value; $('#qx', root).hidden = !query; showHint(); renderResults(); });
    qi.addEventListener('focus', showHint);
    qi.addEventListener('blur', () => setTimeout(() => { const h = $('#qhint'); if (h) h.hidden = true; }, 150));
    qi.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); if (query) { query = ''; qi.value = ''; $('#qx', root).hidden = true; renderResults(); } else qi.blur(); } });
    $('#qx', root).onclick = () => { query = ''; qi.value = ''; $('#qx', root).hidden = true; renderResults(); qi.focus(); };
    $('#dateBtn', root).onclick = e => {
      if (e.target.closest('#dateX')) { dateR = null; renderClips(); return; }
      Cal.open(e.currentTarget, { range: dateR, counts: () => Cal.countsOf(S.clips) }, r => { dateR = r; renderClips(); });
    };
    $('#openDir', root).onclick = () => api.action('openFolder', { folder: folderF });
    if (qFocus) { qi.focus(); qi.setSelectionRange(qFocus[0], qFocus[1]); }
    renderResults(!!keep);
  }

  /* nápoveda pod vyhľadávaním: klik pridá výraz */
  function showHint() {
    const h = $('#qhint'); if (!h) return;
    if (document.activeElement !== $('#q')) { h.hidden = true; return; }
    const top = gameStats().slice(0, 3).map(g => 'hra:' + norm(g.key).replace(/\s+/g, ''));
    const chips = ['dnes', 'včera', '>30s', '<1m', 'typ:nahrávka', 'typ:upravené', 'obľúbené', ...top];
    const have = new Set(norm(query).split(/\s+/));
    h.innerHTML = `<span>Skús:</span>${chips.filter(c => !have.has(norm(c))).map(c => `<button data-q="${esc(c)}">${esc(c)}</button>`).join('')}`;
    h.hidden = false;
  }
  document.addEventListener('mousedown', e => {
    const b = e.target.closest('#qhint [data-q]'); if (!b) return;
    e.preventDefault();
    query = (query.trim() + ' ' + b.dataset.q).trim() + ' ';
    const qi = $('#q'); qi.value = query; $('#qx').hidden = false;
    renderResults(); showHint();
    qi.focus(); qi.setSelectionRange(query.length, query.length);
  });

  /* doplní náhľady do už vykreslených kariet */
  function patchThumbs() {
    const byPath = new Map(S.clips.map(c => [c.path, c]));
    $$('#view-clips .clip').forEach(el => {
      const c = byPath.get(el.dataset.path), ph = el.querySelector('.thumb .ph');
      if (!c) return;
      if (c.thumb && ph) {
        const img = document.createElement('img'); img.src = fileUrl(c.thumb); img.alt = ''; img.loading = 'lazy'; img.draggable = false; img.className = 'fadein';
        ph.replaceWith(img);
      }
      // dĺžka sa zistí spolu s náhľadom → len dopíš štítok
      if (c.duration && !el.querySelector('.thumb .dur')) el.querySelector('.thumb').insertAdjacentHTML('beforeend', `<span class="dur">${dur(c.duration)}</span>`);
    });
  }
  /* veľká knižnica: vykresli najprv 150 kariet, ďalšie pri dorolovaní */
  const PAGE = 150;
  let renderLimit = PAGE, moreObs = null;
  function renderResults(more) {
    const box = $('#results'); if (!box) return;
    if (!more) renderLimit = PAGE;
    const { list, pq } = filtered();
    visible = list.map(c => c.path);
    const filteredOn = !isEmptyQ(pq) || gameF || filter !== 'all';
    const head = filteredOn ? `<div class="rhead"><span>${list.length ? `Nájdené <b>${list.length}</b> z ${!isEmptyQ(pq) ? S.clips.length : here().length} · ${dur(list.reduce((a, c) => a + (c.duration || 0), 0))}` : ''}</span>${list.length ? `<button class="btn ghost small" id="clearF">Zrušiť filtre</button>` : ''}</div>` : '';
    if (!list.length) {
      box.innerHTML = `<div class="empty small"><h2>Nič sa nenašlo</h2><p>${!isEmptyQ(pq) ? 'Skús iné slovo. Hľadá sa v názve, hre, type aj dátume („dnes“, „pondelok“, „16.10.“).' : 'V tomto filtri nie sú žiadne klipy.'}</p><button class="btn" id="clearF">Zrušiť filtre</button></div>`;
    } else {
      let i = 0, shown = 0;
      const gs = groupsOf(list);
      const st = gameStats();
      box.innerHTML = head + gs.map(g => {
        if (shown >= renderLimit) return '';
        const items = g.items.slice(0, renderLimit - shown); shown += items.length;
        const secs = g.items.reduce((a, c) => a + (c.duration || 0), 0);
        const gst = g.game && st.find(x => x.key === g.label);
        const label = g.label ? `<h3>${gst ? avatar(g.label, gst.thumb, 'sm') : ''}${esc(g.label)} <small>${g.items.length} · ${dur(secs)}</small></h3>` : '';
        return `<section class="day">${label}<div class="grid">${items.map(c => card(c, i++, pq.words)).join('')}</div></section>`;
      }).join('') + (list.length > shown ? `<div class="more-sent" id="moreSent"><div class="mx-load"><i></i><i></i><i></i></div><span>${shown} z ${list.length}</span></div>` : '');
      if (moreObs) moreObs.disconnect();
      const sent = $('#moreSent', box);
      if (sent) {
        moreObs = new IntersectionObserver(en => {
          if (!en.some(x => x.isIntersecting)) return;
          moreObs.disconnect();
          const sc = $('#view-clips'), top = sc.scrollTop;
          renderLimit += PAGE; renderResults(true); sc.scrollTop = top;
        }, { root: $('#view-clips'), rootMargin: '600px' });
        moreObs.observe(sent);
      }
    }
    const cf = $('#clearF', box);
    if (cf) cf.onclick = () => { query = ''; gameF = ''; filter = 'all'; LS.set('gameF', ''); LS.set('kind', 'all'); renderClips(); };
    firstRender = false;
    updPicked();
  }

  function card(c, i, words) {
    const isNew = !firstRender && !seenClips.has(c.path);
    seenClips.add(c.path);
    const kind = c.kind === 'rec' ? '<span class="kind k-rec">Nahrávka</span>' : c.kind === 'trim' ? '<span class="kind">Orez</span>' : c.kind === 'edit' ? '<span class="kind">Upravené</span>' : c.kind === 'cut' ? '<span class="kind">Strih</span>' : c.kind === 'small' ? '<span class="kind k-small">Zmenšené</span>' : '';
    const g = c.game ? gname(c.game) : '';
    return `<article draggable="false" class="clip${isNew ? ' new' : ''}${picked.has(c.path) ? ' picked' : ''}${c.fav ? ' is-fav' : ''}" data-path="${esc(c.path)}" style="--i:${Math.min(i, 16)}">
      <div class="thumb">
        <button class="pick" aria-label="Vybrať" title="Vybrať (Ctrl + klik)">${PICK}</button>
        <button class="fav" aria-label="Obľúbené" title="${c.fav ? 'Odobrať z obľúbených' : 'Pridať do obľúbených'}">${STAR}</button>
        ${c.thumb ? `<img src="${esc(fileUrl(c.thumb))}" alt="" loading="lazy" draggable="false">` : `<div class="ph">${I.film}</div>`}
        ${kind}${c.duration ? `<span class="dur">${dur(c.duration)}</span>` : ''}
        <div class="play"><i>${I.play}</i></div>
      </div>
      <div class="info"><h4 title="${esc(c.name)}">${hl(c.name, words)}</h4>
        <div class="sub">${g ? `<button class="g" data-game="${esc(g)}" title="Ukázať len ${esc(g)}">${iconOf(g) ? `<img class="gi" src="${esc(fileUrl(iconOf(g)))}" alt="">` : ''}${hl(g, words)}</button>·` : ''}<span>${esc(time(c.mtime))}</span>·<span>${esc(size(c.size))}</span>${c.folder && c.folder !== folderF ? `<span class="fold-tag" title="V priečinku ${esc(c.folder)}">${FOLDER_IC}${esc(c.folder)}</span>` : ''}</div></div>
    </article>`;
  }

  /* pásik hier: klik = filter, pravý klik = premenovať hru */
  $('#view-clips').addEventListener('click', e => {
    const p = e.target.closest('.gpill');
    if (p) { gameF = gameF === p.dataset.g && p.dataset.g ? '' : p.dataset.g; LS.set('gameF', gameF); renderClips(); return; }
    const gl = e.target.closest('.clip .g');
    if (gl) { e.stopPropagation(); gameF = gl.dataset.game; LS.set('gameF', gameF); renderClips(); $('#view-clips').scrollTop = 0; return; }
    const fv = e.target.closest('.clip .fav');
    if (fv) {
      e.stopPropagation();
      const el = fv.closest('.clip'), path = el.dataset.path, c = S.clips.find(x => x.path === path);
      const on = !(c && c.fav);
      el.classList.toggle('is-fav', on); fv.classList.remove('pop'); void fv.offsetWidth; fv.classList.add('pop');
      api.action('setClipMeta', { paths: [path], patch: { fav: on } });
    }
  }, true);
  $('#view-clips').addEventListener('contextmenu', e => {
    const p = e.target.closest('.gpill');
    if (!p || !p.dataset.g || p.dataset.g[0] === '_') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const key = p.dataset.g, g = gameStats().find(x => x.key === key);
    UI.menu(p, [{ label: 'Premenovať hru…', v: 'rename' }, { label: `Vybrať všetky (${g ? g.count : 0})`, v: 'pick' }], it => {
      if (it.v === 'rename') renameGame(g);
      if (it.v === 'pick') { S.clips.filter(c => c.game && gname(c.game) === key).forEach(c => picked.add(c.path)); updPicked(); }
    });
  }, true);
  /* ťahanie klipu: karta letí s kurzorom; pustená na priečinok doň „spadne“, mimo okna sa z nej stane
     skutočný súbor (Discord, Prieskumník, Premiere…) */
  let fly = null, justDragged = 0, flyCleanup = null;
  $('#view-clips').addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const card = e.target.closest('.clip'); if (!card || e.target.closest('.pick, .fav, .g, button')) return;
    if (flyCleanup) flyCleanup();
    const x0 = e.clientX, y0 = e.clientY, path = card.dataset.path;
    let over = false; // po odovzdaní súboru systému už karta nevzniká znova
    const move = ev => {
      if (over) return;
      // tlačidlo už nie je stlačené (pointerup sa stratil, napr. po natívnom ťahaní): ukonči
      if (!(ev.buttons & 1)) { cleanup(); if (fly) flyBack(); return; }
      if (!fly) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 7) return;
        startFly(card, path, ev, x0, y0);
      }
      flyMove(ev);
    };
    const up = ev => { const f = fly; cleanup(); if (f) flyDrop(ev); };
    const key = ev => { if (ev.key === 'Escape' && fly) { ev.stopPropagation(); cleanup(); flyBack(); } };
    // myš opustila okno (aj rýchlo, bez udalosti na okraji): odovzdaj súbor systému
    const leave = ev => { if (fly && (ev.buttons & 1)) handoff(); };
    const lost = () => { cleanup(); if (fly) flyBack(); };
    const cleanup = () => {
      over = true;
      removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('keydown', key, true);
      removeEventListener('blur', lost); document.documentElement.removeEventListener('mouseleave', leave);
      if (flyCleanup === cleanup) flyCleanup = null;
    };
    flyCleanup = cleanup;
    addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('keydown', key, true);
    addEventListener('blur', lost); document.documentElement.addEventListener('mouseleave', leave);
  });
  // po ťahaní nespúšťaj klik (otvorenie editora)
  $('#view-clips').addEventListener('click', e => { if (Date.now() - justDragged < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
  function startFly(card, path, ev, x0, y0) {
    hoverStop();
    const paths = picked.has(path) ? [...picked] : [path];
    const r = card.getBoundingClientRect(), th = card.querySelector('.thumb img');
    const w = Math.min(200, r.width * 0.72), h = w * 9 / 16;
    const el = document.createElement('div');
    el.className = 'fly' + (paths.length > 1 ? ' many' : '');
    el.innerHTML = `${paths.length > 1 ? '<i class="fly-card b2"></i><i class="fly-card b1"></i>' : ''}<div class="fly-card">${th ? `<img src="${th.src}" alt="">` : ''}</div>${paths.length > 1 ? `<b class="fly-n">${paths.length}</b>` : ''}`;
    el.style.width = w + 'px'; el.style.height = h + 'px';
    document.body.appendChild(el);
    // úchop: tam, kde si kartu chytil (zmenšené), nech neodskočí
    const gx = (x0 - r.left) / r.width * w, gy = Math.min(h, (y0 - r.top) / (r.width * 9 / 16) * h);
    paths.forEach(p => { const c = document.querySelector(`.clip[data-path="${CSS.escape(p)}"]`); if (c) c.classList.add('lifted'); });
    fly = { el, paths, path, gx, gy, w, h, x: ev.clientX, y: ev.clientY, vx: 0, rot: 0, raf: 0, target: null, from: r };
    document.body.classList.add('flying');
    const tick = () => {
      if (!fly) return;
      fly.rot += ((Math.max(-14, Math.min(14, fly.vx * 0.6))) - fly.rot) * 0.18; fly.vx *= 0.82;
      fly.el.style.transform = `translate(${fly.x - fly.gx}px, ${fly.y - fly.gy}px) rotate(${fly.rot.toFixed(2)}deg)`;
      fly.raf = requestAnimationFrame(tick);
    };
    fly.raf = requestAnimationFrame(tick);
  }
  function flyMove(ev) {
    fly.vx += ev.clientX - fly.x; fly.x = ev.clientX; fly.y = ev.clientY;
    // mimo okna: odovzdaj skutočný súbor systému (Discord, Prieskumník…)
    if (ev.clientX <= 0 || ev.clientY <= 0 || ev.clientX >= innerWidth - 1 || ev.clientY >= innerHeight - 1) { handoff(); return; }
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const t = under && (under.closest('.fold[data-folder]') || under.closest('#nav button[data-view=clips]'));
    if (t !== fly.target) { if (fly.target) fly.target.classList.remove('drop-on'); fly.target = t; if (t) t.classList.add('drop-on'); fly.el.classList.toggle('over', !!t); }
  }
  function handoff() {
    if (!fly) return;
    const p = fly.path, paths = fly.paths, el = endFly(); justDragged = Date.now();
    if (el) el.remove();
    // vlastný súbor ťahaný späť nad appku nie je import; pustený na priečinok sa doň presunie
    dragPaths = paths; dragAt = Date.now();
    if (api.drag) api.drag(p);
  }
  function endFly() {
    if (!fly) return;
    if (flyCleanup) flyCleanup();
    cancelAnimationFrame(fly.raf);
    if (fly.target) fly.target.classList.remove('drop-on');
    $$('.clip.lifted').forEach(c => c.classList.remove('lifted'));
    document.body.classList.remove('flying');
    const el = fly.el; fly = null;
    return el;
  }
  function flyDrop() {
    justDragged = Date.now();
    const t = fly.target;
    const f = t ? (t.dataset.folder || '') : null;
    const paths = fly.paths.filter(p => { const c = S.clips.find(x => x.path === p); return c && (c.folder || '') !== f; });
    if (!t || !paths.length) return flyBack();
    const { el, rot } = { el: fly.el, rot: fly.rot };
    const ic = (t.querySelector('svg') || t).getBoundingClientRect();
    endFly();
    // spadne do priečinka: zmenší sa, zatočí a zmizne v ikonke
    el.animate([
      { transform: el.style.transform, opacity: 1 },
      { transform: `translate(${ic.left + ic.width / 2 - 20}px, ${ic.top - 30}px) rotate(${rot - 8}deg) scale(.45)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${ic.left + ic.width / 2 - 8}px, ${ic.top + ic.height / 2 - 6}px) rotate(${rot + 20}deg) scale(.08)`, opacity: 0.2 }
    ], { duration: 520, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' }).onfinish = () => el.remove();
    setTimeout(() => { t.classList.remove('gulp'); void t.offsetWidth; t.classList.add('gulp'); }, 430);
    paths.forEach(p => { const c = document.querySelector(`.clip[data-path="${CSS.escape(p)}"]`); if (c) c.classList.add('gone'); });
    setTimeout(() => moveTo(paths, f), 380);
  }
  function flyBack() {
    const from = fly.from, el = endFly();
    el.animate([{ transform: el.style.transform, opacity: 1 }, { transform: `translate(${from.left + 10}px, ${from.top + 10}px) rotate(0deg) scale(1.05)`, opacity: 0 }],
      { duration: 280, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }).onfinish = () => el.remove();
  }
  /* náhľad pri prejdení myšou: poloha myši na karte = miesto vo videu */
  let hv = null;
  function hoverStop() { if (!hv) return; clearTimeout(hv.t); if (hv.v) { hv.v.removeAttribute('src'); hv.v.load(); hv.v.remove(); } if (hv.bar) hv.bar.remove(); if (hv.th) hv.th.classList.remove('scrub'); hv = null; }
  $('#view-clips').addEventListener('pointermove', e => {
    const th = e.target.closest && e.target.closest('.clip .thumb');
    if (!th || e.target.closest('.pick, .fav') || document.body.classList.contains('selecting') || document.body.classList.contains('flying')) { hoverStop(); return; }
    const card = th.closest('.clip'), path = card.dataset.path;
    if (hv && hv.path !== path) hoverStop();
    const r = th.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (!hv) {
      if (/\.mkv$/i.test(path)) return;
      hv = { path, th, f, t: setTimeout(() => {
        // spusti až po chvíli, aby sa pri prechode cez mriežku zbytočne nenačítavali videá
        if (!hv || hv.path !== path) return;
        const v = document.createElement('video'); v.className = 'hp'; v.muted = true; v.preload = 'auto'; v.src = fileUrl(path);
        const bar = document.createElement('i'); bar.className = 'hp-bar';
        th.appendChild(v); th.appendChild(bar); th.classList.add('scrub');
        hv.v = v; hv.bar = bar;
        v.addEventListener('loadedmetadata', () => { if (hv && hv.v === v) seekHv(); }, { once: true });
        v.addEventListener('seeked', () => { if (hv && hv.v === v) { v.classList.add('on'); if (hv.pending != null) seekHv(); } });
      }, 220) };
    }
    hv.f = f;
    if (hv.bar) hv.bar.style.width = (f * 100) + '%';
    if (hv.v && hv.v.readyState >= 1) seekHv();
  });
  function seekHv() {
    const v = hv.v; if (!v.duration) return;
    if (v.seeking) { hv.pending = hv.f; return; }
    hv.pending = null; v.currentTime = Math.min(v.duration - 0.05, hv.f * v.duration);
  }
  $('#view-clips').addEventListener('pointerleave', hoverStop);
  $('#view-clips').addEventListener('pointerdown', hoverStop);

  /* import: videá pretiahnuté z Prieskumníka sa skopírujú do knižnice (do priečinka, na ktorý ich pustíš) */
  const extDrag = e => !(dragPaths && Date.now() - dragAt < 60000) && e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragover', e => {
    if (!extDrag(e) || !$('#modalWrap').hidden) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    const t = dropTarget(e), into = t ? (t.dataset.folder || '') : folderF;
    document.body.classList.add('importing');
    $('#importHint') || document.body.insertAdjacentHTML('beforeend', '<div id="importHint" class="import-hint"><div><b></b><span>MP4, MKV a MOV sa skopírujú do knižnice, originál ostane.</span></div></div>');
    $('#importHint b').textContent = `Pusti a pridaj do ${into || 'Klipy'}`;
    clearTimeout(window.__impT); window.__impT = setTimeout(() => { document.body.classList.remove('importing'); const h = $('#importHint'); if (h) h.remove(); }, 400);
  });
  document.addEventListener('drop', async e => {
    if (!extDrag(e) || !$('#modalWrap').hidden) return;
    e.preventDefault();
    document.body.classList.remove('importing'); const h = $('#importHint'); if (h) h.remove();
    const t = dropTarget(e), into = t ? (t.dataset.folder || '') : folderF;
    const paths = [...e.dataTransfer.files].map(f => api.pathFor ? api.pathFor(f) : '').filter(p => /\.(mp4|mkv|mov)$/i.test(p));
    if (!paths.length) { toast('info', 'Nič na import', 'Pretiahni sem videá vo formáte MP4, MKV alebo MOV.'); return; }
    toast('info', 'Importujem…', `${paths.length} ${paths.length === 1 ? 'video' : paths.length < 5 ? 'videá' : 'videí'}`);
    try {
      const r = await api.action('importClips', { paths, folder: into });
      toast(r.failed.length ? 'error' : 'ok', 'Importované', `${r.imported.length} do ${into || 'Klipy'}${r.failed.length ? ` · nepodarilo sa: ${r.failed.join(', ')}` : ''}`);
    } catch (er) { toast('error', 'Import zlyhal', er.message); }
  });
  document.addEventListener('keydown', e => {
    if (view === 'clips' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && $('#modalWrap').hidden) { e.preventDefault(); const q = $('#q'); if (q) { q.focus(); q.select(); } }
  });

  function askText(title, desc, value, placeholder, chips, extraBtn) {
    return new Promise(res => {
      const m = UI.modal(`<h2>${esc(title)}</h2><p>${desc}</p>
        <input class="input" id="askIn" style="width:100%" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}" spellcheck="false">
        ${chips && chips.length ? `<div class="ask-chips">${chips.map(c => `<button class="chip-btn" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
        <div class="acts">${extraBtn ? `<button class="btn ghost" data-a="extra">${esc(extraBtn)}</button><span style="flex:1"></span>` : ''}<button class="btn" data-a="no">Zrušiť</button><button class="btn primary" data-a="yes">Uložiť</button></div>`, 'small', () => res(null));
      const inp = $('#askIn', m); setTimeout(() => { inp.focus(); inp.select(); }, 50);
      const done = v => { res(v); UI.closeModal(); }; // najprv výsledok, zatvorenie by inak vrátilo „zrušené“
      m.querySelectorAll('.chip-btn').forEach(b => b.onclick = () => { inp.value = b.dataset.v; inp.focus(); });
      m.querySelector('[data-a=no]').onclick = () => UI.closeModal();
      m.querySelector('[data-a=yes]').onclick = () => done({ value: inp.value.trim() });
      const ex = m.querySelector('[data-a=extra]'); if (ex) ex.onclick = () => done({ extra: true });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') done({ value: inp.value.trim() }); });
    });
  }
  async function renameGame(g) {
    if (!g) return;
    const r = await askText('Premenovať hru', `Takto sa bude <b>${esc(g.key)}</b> volať v knižnici aj v názvoch nových clipov.`, g.key, 'Názov hry');
    if (!r || !r.value) return;
    const names = { ...(S.settings.gameNames || {}) };
    for (const raw of g.raws) { const k = String(raw).replace(/\.exe$/i, ''); if (r.value === k) delete names[k]; else names[k] = r.value; }
    if (gameF === g.key) { gameF = r.value; LS.set('gameF', gameF); }
    await save({ gameNames: names });
    renderClips();
  }
  /* výber hry: nainštalované hry + hry z knižnice, s hľadaním; Enter uloží aj novú */
  function setGameFor(paths) {
    const list = S.clips.filter(c => paths.includes(c.path));
    const cur = list.length === 1 && list[0].game ? gname(list[0].game) : '';
    const opts = new Map();
    gameStats().forEach(g => opts.set(norm(g.key), { name: g.key, sub: `${g.count} ${g.count === 1 ? 'klip' : g.count < 5 ? 'klipy' : 'klipov'}`, thumb: g.thumb }));
    (S.installed || []).forEach(g => { if (!opts.has(norm(g.name))) opts.set(norm(g.name), { name: g.name, sub: g.source }); });
    const all = [...opts.values()];
    const m = UI.modal(`<h2>${list.length === 1 ? 'Hra pre klip' : `Hra pre ${list.length} klipov`}</h2>
      <p>${S.installed && S.installed.length ? `Vyber z ${all.length} hier (aj nainštalované) alebo napíš novú.` : 'Vyber zo zoznamu alebo napíš novú. Nainštalované hry nájdeš v Nastavenia → Hry.'}</p>
      <label class="search gp-q">${I.search}<input id="gpQ" placeholder="${cur ? `Teraz: ${esc(cur)} · hľadať alebo napísať inú` : 'Hľadať alebo napísať názov hry'}" value="" spellcheck="false" autocomplete="off"></label>
      <div class="gp-list" id="gpL"></div>
      <div class="acts"><button class="btn ghost" data-a="none">Bez hry</button><span style="flex:1"></span><button class="btn" data-a="no">Zrušiť</button><button class="btn primary" data-a="yes">Uložiť</button></div>`, 'small gp-modal');
    const q = $('#gpQ', m);
    let chosen = cur;
    const draw = () => {
      const t = norm(q.value.trim());
      const shown = all.filter(o => !t || norm(o.name).includes(t)).slice(0, 60);
      const exact = all.some(o => norm(o.name) === t);
      $('#gpL', m).innerHTML = shown.map(o => `<button class="gp-o${norm(o.name) === norm(chosen) ? ' on' : ''}" data-n="${esc(o.name)}">${avatar(o.name, o.thumb)}<span><b>${esc(o.name)}</b><small>${esc(o.sub || '')}</small></span></button>`).join('')
        + (t && !exact ? `<button class="gp-o new" data-n="${esc(q.value.trim())}"><i class="gav">+</i><span><b>${esc(q.value.trim())}</b><small>nová hra</small></span></button>` : '')
        + (!shown.length && !t ? '<div class="ed-empty">Zatiaľ žiadne hry.</div>' : '');
    };
    const done = name => { UI.closeModal(); api.action('setClipMeta', { paths, patch: { game: name } }).then(() => toast('ok', 'Hra zmenená', name || 'Bez hry')); };
    $('#gpL', m).addEventListener('click', e => { const b = e.target.closest('.gp-o'); if (b) done(b.dataset.n); });
    q.addEventListener('input', draw);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = $('#gpL .gp-o', m); done(q.value.trim() && first && norm(first.dataset.n).includes(norm(q.value.trim())) ? first.dataset.n : q.value.trim()); } });
    m.querySelector('[data-a=none]').onclick = () => done('');
    m.querySelector('[data-a=no]').onclick = () => UI.closeModal();
    m.querySelector('[data-a=yes]').onclick = () => done(q.value.trim() || chosen);
    draw(); setTimeout(() => { q.focus(); q.select(); }, 50);
  }

  /* ---------- zmenšenie klipu (Discord 20 MB a pod.) ---------- */
  const ZIP = '<svg viewBox="0 0 20 20"><path d="M7 3H4.5A1.5 1.5 0 0 0 3 4.5V7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13M13 17h2.5a1.5 1.5 0 0 0 1.5-1.5V13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 8l4 4M12 8l-4 4" stroke="currentColor" stroke-width="0" /><rect x="7" y="7" width="6" height="6" rx="1.5" fill="currentColor"/></svg>';
  const DISCORD = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-4.6 0L9.6 4a16.5 16.5 0 0 0-4.1 1.3C2.9 9.2 2.2 13 2.5 16.8a16.7 16.7 0 0 0 5 2.5l1.1-1.7c-.6-.2-1.2-.5-1.7-.9l.4-.3a11.9 11.9 0 0 0 10.2 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.7a16.6 16.6 0 0 0 5-2.5c.4-4.4-.7-8.1-3-11.5zM9.1 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm5.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>';
  async function compressDialog(clips) {
    clips = clips.filter(Boolean);
    if (!clips.length) return;
    const multi = clips.length > 1;
    let mb = LS.get('cmpMB', 20), custom = LS.get('cmpCustom', 25), audio = true, copy = !multi, busy = false;
    const presetIds = Compress.PRESETS.map(p => p.mb);
    let mode = presetIds.includes(mb) ? String(mb) : 'custom';
    const m = UI.modal(`<div class="cmp">
      <div class="cmp-h"><div class="cmp-ic">${ZIP}</div><div><h2>${multi ? `Zmenšiť ${clips.length} klipov` : 'Zmenšiť klip'}</h2>
        <p>${multi ? 'Každý klip sa zmenší zvlášť na zvolenú veľkosť.' : `${esc(clips[0].name)} · ${dur(clips[0].duration)} · ${size(clips[0].size)}`}</p></div></div>
      <div class="cmp-presets" id="cmpP">
        ${Compress.PRESETS.map(p => `<button class="cmp-p" data-m="${p.mb}">${p.id === 'discord' ? `<i class="cmp-dc">${DISCORD}</i>` : ''}<b>${p.mb} MB</b><span>${esc(p.label)}</span><small>${esc(p.sub)}</small></button>`).join('')}
        <label class="cmp-p" data-m="custom"><b><input type="number" id="cmpC" min="1" max="2000" value="${custom}"> MB</b><span>Vlastná</span><small>napr. pre e-mail</small></label>
      </div>
      <div class="cmp-est" id="cmpE"></div>
      <div class="cmp-opts">
        <label class="mx-keep"><span>Zachovať zvuk (prvá stopa, mix)</span><span class="toggle sm"><input type="checkbox" id="cmpA" checked></span></label>
        ${multi ? '' : `<label class="mx-keep"><span>Po dokončení skopírovať do schránky (vložíš cez Ctrl+V)</span><span class="toggle sm"><input type="checkbox" id="cmpK" checked></span></label>`}
      </div>
      <div class="cmp-prog" id="cmpG" hidden><div class="cmp-bar"><i id="cmpBar"></i></div><span id="cmpPct">0 %</span></div>
      <div class="acts" id="cmpActs"><button class="btn" data-a="no">Zrušiť</button><button class="btn primary" data-a="go">${ZIP}<span>Zmenšiť</span></button></div>
    </div>`, 'small cmp-modal', () => { window.__compressProg = null; });
    const target = () => mode === 'custom' ? Math.max(1, Math.min(2000, Number($('#cmpC', m).value) || 1)) : Number(mode);
    // rozmery a fps prvého klipu pre odhad
    const infos = await Promise.all(clips.map(c => api.action('probe', { path: c.path }).catch(() => ({}))));
    function estimate() {
      $$('.cmp-p', m).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
      const T = target();
      const rows = clips.map((c, i) => {
        const inf = infos[i] || {};
        const d = inf.duration || c.duration || 1;
        const pl = Compress.plan({ duration: d, width: inf.width, height: inf.height, fps: inf.fps, targetMB: T, audio });
        return { c, pl, small: c.size <= T * 1e6 };
      });
      const r0 = rows[0];
      const q = { 'výborná': 4, 'dobrá': 3, 'ujde': 2, 'slabá': 1 };
      let html;
      if (!multi && r0.small) html = `<div class="cmp-note ok">${UI.I.ok}<div><b>Netreba zmenšovať.</b> Klip má ${size(r0.c.size)}, čo sa do ${T} MB zmestí. Môžeš ho rovno skopírovať.</div><button class="btn small" id="cmpCopyNow">Kopírovať</button></div>`;
      else if (!multi && !r0.pl.ok) html = `<div class="cmp-note bad">${UI.I.warn}<div><b>Klip je na ${T} MB pridlhý.</b> Zmestí sa najviac ${dur(r0.pl.maxSeconds)}. Orež ho v editore alebo zvoľ väčší limit.</div></div>`;
      else if (!multi) html = `<div class="cmp-q q${q[r0.pl.quality]}"><div class="cmp-qbar">${[1, 2, 3, 4].map(k => `<i class="${k <= q[r0.pl.quality] ? 'on' : ''}"></i>`).join('')}</div>
          <div><b>${r0.pl.width}×${r0.pl.height} · ${r0.pl.fps} fps</b><span>${(r0.pl.vkbps / 1000).toFixed(1).replace('.', ',')} Mb/s · kvalita ${r0.pl.quality} · ${size(r0.c.size)} → do ${T} MB</span></div></div>`;
      else {
        const bad = rows.filter(r => !r.small && !r.pl.ok).length, skip = rows.filter(r => r.small).length;
        html = `<div class="cmp-list">${rows.map(r => `<div class="cmp-row"><span>${esc(r.c.name)}</span><small>${r.small ? 'už je menší' : !r.pl.ok ? 'pridlhý' : `${r.pl.height}p${r.pl.fps} · ${r.pl.quality}`}</small></div>`).join('')}</div>
          ${bad || skip ? `<div class="cmp-sub">${skip ? `${skip} sa preskočí (už je pod limitom). ` : ''}${bad ? `${bad} je pridlhý, ten sa preskočí.` : ''}</div>` : ''}`;
      }
      $('#cmpE', m).innerHTML = html;
      const can = rows.some(r => !r.small && r.pl.ok);
      $('[data-a=go]', m).disabled = !can || busy;
      const cn = $('#cmpCopyNow', m);
      if (cn) cn.onclick = async () => { try { await api.action('copyFile', { path: r0.c.path }); toast('ok', 'Skopírované', 'Vlož do Discordu cez Ctrl+V'); UI.closeModal(); } catch (e) { toast('error', 'Kopírovanie zlyhalo', e.message); } };
      return rows;
    }
    $('#cmpP', m).addEventListener('click', e => {
      const b = e.target.closest('.cmp-p'); if (!b || busy) return;
      mode = b.dataset.m;
      if (mode === 'custom') $('#cmpC', m).focus();
      estimate();
    });
    $('#cmpC', m).addEventListener('input', () => { mode = 'custom'; estimate(); });
    $('#cmpA', m).onchange = e => { audio = e.target.checked; estimate(); };
    const ck = $('#cmpK', m); if (ck) ck.onchange = e => { copy = e.target.checked; };
    $('[data-a=no]', m).onclick = () => UI.closeModal();
    $('[data-a=go]', m).onclick = async () => {
      const T = target();
      LS.set('cmpMB', mode === 'custom' ? T : Number(mode)); if (mode === 'custom') LS.set('cmpCustom', T);
      const rows = estimate().filter(r => !r.small && r.pl.ok);
      busy = true;
      m.classList.add('busy');
      $('#cmpG', m).hidden = false;
      $('[data-a=go]', m).disabled = true;
      $('[data-a=go] span', m).textContent = 'Zmenšujem…';
      const results = [];
      for (let i = 0; i < rows.length; i++) {
        window.__compressProg = ev => {
          if (ev.type !== 'compressProgress') return;
          const f = (i + ev.value) / rows.length;
          $('#cmpBar', m).style.width = (f * 100) + '%';
          $('#cmpPct', m).textContent = `${Math.round(f * 100)} %${rows.length > 1 ? ` · ${i + 1} z ${rows.length}` : ''}`;
        };
        try { results.push(await api.action('compress', { path: rows[i].c.path, targetMB: T, audio, copy: copy && !multi })); }
        catch (e) { toast('error', 'Zmenšenie zlyhalo', e.message); }
      }
      window.__compressProg = null;
      busy = false;
      if (!document.body.contains(m)) return;
      if (!results.length) { UI.closeModal(); return; }
      const r = results[0];
      // hotovo: výsledok priamo v dialógu
      m.querySelector('.cmp').innerHTML = `<div class="cmp-done">
        <svg class="cmp-check" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
        <h2>${multi ? `Hotovo · ${results.length} ${results.length < 5 ? 'klipy' : 'klipov'}` : `Hotovo · ${size(r.size)}`}</h2>
        <p>${multi ? `Uložené vedľa originálov s príponou „(${T} MB)“.` : r.over ? `Ani na viac pokusov sa nepodarilo ísť pod ${T} MB, skús väčší limit alebo kratší klip.` : r.copied ? `Skopírované do schránky. V Discorde stačí <kbd>Ctrl+V</kbd>.` : `Uložené ako ${esc(r.out.split(/[\\/]/).pop())}.`}</p>
        <div class="acts"><button class="btn" data-a="show">${UI.I.folder}<span>Ukázať v priečinku</span></button>${multi ? '' : `<button class="btn" data-a="copy">${r.copied ? 'Kopírovať znova' : 'Kopírovať'}</button>`}<button class="btn primary" data-a="ok">Hotovo</button></div></div>`;
      m.querySelector('[data-a=show]').onclick = () => api.action('reveal', { path: r.out });
      const cb = m.querySelector('[data-a=copy]');
      if (cb) cb.onclick = async () => { try { await api.action('copyFile', { path: r.out }); toast('ok', 'Skopírované', 'Vlož do Discordu cez Ctrl+V'); } catch (e) { toast('error', 'Kopírovanie zlyhalo', e.message); } };
      m.querySelector('[data-a=ok]').onclick = () => UI.closeModal();
      UI.sound('saved');
    };
    estimate();
  }
  window.App = Object.assign(window.App || {}, { compress: compressDialog, state: () => S, save: p => save(p).then(() => S.settings) });

  /* ---------- výber viacerých klipov ---------- */
  const PICK = '<svg viewBox="0 0 16 16"><path d="M4 8.4 6.8 11 12 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const openEditor = list => Player.open(list.map(c => ({ ...c })), { library: () => S.clips, autoWin: !!S.settings.autoWinCrop });
  const pickedClips = () => S.clips.filter(c => picked.has(c.path));
  function updPicked() {
    $$('#view-clips .clip').forEach(el => el.classList.toggle('picked', picked.has(el.dataset.path)));
    document.body.classList.toggle('selecting', picked.size > 0);
    let bar = $('#selbar');
    if (!picked.size) { if (bar) { bar.classList.add('out'); setTimeout(() => { if (!picked.size && bar.parentNode) bar.remove(); }, 220); } return; }
    if (!bar || bar.classList.contains('out')) {
      if (bar) bar.remove();
      bar = document.createElement('div'); bar.id = 'selbar'; bar.className = 'selbar';
      document.body.appendChild(bar);
      bar.addEventListener('click', e => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'all') { visible.forEach(p => picked.add(p)); updPicked(); }
        if (a.dataset.a === 'none') { picked.clear(); updPicked(); }
        if (a.dataset.a === 'edit') { const l = pickedClips().sort((x, y) => x.mtime - y.mtime); picked.clear(); updPicked(); openEditor(l); }
        if (a.dataset.a === 'del') deletePicked();
        if (a.dataset.a === 'fav') { const l = pickedClips(), on = !l.every(c => c.fav); api.action('setClipMeta', { paths: l.map(c => c.path), patch: { fav: on } }); toast('ok', on ? 'Pridané do obľúbených' : 'Odobrané z obľúbených', `${l.length} ${l.length === 1 ? 'klip' : 'klipov'}`); }
        if (a.dataset.a === 'game') setGameFor([...picked]);
        if (a.dataset.a === 'move') moveMenu(a, [...picked]);
        if (a.dataset.a === 'zip') compressDialog(pickedClips());
      });
    }
    const list = pickedClips();
    const secs = list.reduce((a, c) => a + (c.duration || 0), 0), bytes = list.reduce((a, c) => a + c.size, 0);
    const n = list.length;
    bar.innerHTML = `<span class="sb-n">${n}</span><div class="sb-t"><b>${n === 1 ? 'vybraný klip' : n < 5 ? 'vybrané klipy' : 'vybraných klipov'}</b><span>${dur(secs)} · ${size(bytes)}</span></div>
      <button class="btn ghost small" data-a="all"${visible.every(p => picked.has(p)) ? ' disabled' : ''}>Vybrať všetko</button>
      <span class="sb-sep"></span>
      <button class="btn small icon" data-a="fav" title="Obľúbené">${STAR}</button>
      <button class="btn small" data-a="game" title="Priradiť hru">Hra…</button>
      <button class="btn small" data-a="move" title="Presunúť do priečinka">${FOLDER_IC}<span>Priečinok…</span></button>
      <button class="btn small" data-a="zip" title="Zmenšiť (napr. na 20 MB pre Discord)">${ZIP}<span>Zmenšiť</span></button>
      <button class="btn small" data-a="edit">${UI.I.scissors}<span>${n > 1 ? 'Spojiť v editore' : 'Otvoriť v editore'}</span></button>
      <button class="btn small danger" data-a="del">${UI.I.trash}<span>Vymazať</span></button>
      <button class="btn small icon ghost" data-a="none" title="Zrušiť výber (Esc)">${UI.I.x}</button>`;
  }
  async function deletePicked() {
    const list = pickedClips(); if (!list.length) return;
    const choice = await UI.trashDialog(list);
    if (!choice) return;
    // karty v mriežke sa pred zmiznutím scvrknú
    list.forEach(c => { const el = document.querySelector(`.clip[data-path="${CSS.escape(c.path)}"]`); if (el) el.classList.add('gone'); });
    picked.clear(); updPicked();
    try {
      await api.action('deleteClips', { paths: list.map(c => c.path), permanent: choice === 'delete' });
      toast('ok', choice === 'delete' ? 'Vymazané' : 'V Koši', list.length === 1 ? list[0].name : `${list.length} klipov`);
    } catch (e) { toast('error', 'Niečo sa nevymazalo', e.message); }
    // čo sa nevymazalo, nech sa zas ukáže
    setTimeout(() => $$('#view-clips .clip.gone').forEach(el => el.classList.remove('gone')), 600);
  }
  $('#view-clips').addEventListener('click', e => {
    const c = e.target.closest('.clip'); if (!c || e.target.closest('.fav, .g')) return;
    const p = c.dataset.path;
    const toggleOne = () => { if (picked.has(p)) picked.delete(p); else picked.add(p); anchor = p; updPicked(); };
    if (e.shiftKey && anchor) {
      const a = visible.indexOf(anchor), b = visible.indexOf(p);
      if (a >= 0 && b >= 0) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) picked.add(visible[i]); updPicked(); return; }
    }
    if (e.target.closest('.pick') || e.ctrlKey || e.metaKey || picked.size) return toggleOne();
    const clip = S.clips.find(x => x.path === p);
    if (clip) openEditor([clip]);
  });
  document.addEventListener('keydown', e => {
    if (view !== 'clips' || !$('#modalWrap').hidden || e.target.closest('input, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); visible.forEach(p => picked.add(p)); updPicked(); }
    else if (e.key === 'Escape' && picked.size) { picked.clear(); updPicked(); }
    else if (e.key === 'Delete' && picked.size) deletePicked();
  });
  $('#view-clips').addEventListener('contextmenu', e => {
    const c = e.target.closest('.clip'); if (!c) return;
    e.preventDefault();
    const p = c.dataset.path;
    // pravý klik na vybraný klip = akcie pre celý výber
    const group = picked.has(p) && picked.size > 1;
    const items = group
      ? [{ label: `Spojiť ${picked.size} v editore`, v: 'edit' }, { label: `Zmenšiť ${picked.size}…`, v: 'zipAll' }, { label: 'Zmeniť hru…', v: 'gameAll' }, { label: 'Presunúť do priečinka…', v: 'moveAll' }, { sep: true }, { label: `Vymazať ${picked.size}…`, v: 'delAll' }]
      : [{ label: 'Otvoriť v editore', v: 'play' }, { label: picked.has(p) ? 'Odznačiť' : 'Vybrať', v: 'pick' },
        { label: 'Zmenšiť…', v: 'zip' }, { label: 'Kopírovať súbor', v: 'copy' },
        { sep: true }, { label: (S.clips.find(x => x.path === p) || {}).fav ? 'Odobrať z obľúbených' : 'Pridať do obľúbených', v: 'fav' }, { label: 'Zmeniť hru…', v: 'game' }, { label: 'Presunúť do priečinka…', v: 'move' },
        { sep: true }, { label: 'Ukázať v priečinku', v: 'reveal' }, { label: 'Otvoriť v prehrávači', v: 'ext' }, { sep: true }, { label: 'Vymazať…', v: 'trash' }];
    UI.menu({ getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }), contains: () => false, classList: { contains: () => false, add() { }, remove() { } } },
      items,
      async it => {
        const clip = S.clips.find(x => x.path === p);
        if (it.v === 'play' && clip) openEditor([clip]);
        if (it.v === 'pick') { if (picked.has(p)) picked.delete(p); else picked.add(p); anchor = p; updPicked(); }
        if (it.v === 'edit') { const l = pickedClips().sort((x, y) => x.mtime - y.mtime); picked.clear(); updPicked(); openEditor(l); }
        if (it.v === 'delAll') deletePicked();
        if (it.v === 'gameAll') setGameFor([...picked]);
        if (it.v === 'zipAll') compressDialog(pickedClips());
        if (it.v === 'zip' && clip) compressDialog([clip]);
        if (it.v === 'copy') api.action('copyFile', { path: p }).then(() => toast('ok', 'Skopírované', 'Vlož cez Ctrl+V (Discord, Prieskumník…)')).catch(e => toast('error', 'Kopírovanie zlyhalo', e.message));
        if (it.v === 'game') setGameFor([p]);
        if (it.v === 'move') moveMenu(pointAnchor(e.clientX, e.clientY), [p]);
        if (it.v === 'moveAll') moveMenu(pointAnchor(e.clientX, e.clientY), [...picked]);
        if (it.v === 'fav' && clip) api.action('setClipMeta', { paths: [p], patch: { fav: !clip.fav } });
        if (it.v === 'reveal') api.action('reveal', { path: p });
        if (it.v === 'ext') api.action('openExternal', { path: p });
        if (it.v === 'trash' && clip) {
          const choice = await UI.trashDialog([clip]);
          if (choice) api.action('deleteClips', { paths: [p], permanent: choice === 'delete' }).then(() => toast('ok', choice === 'delete' ? 'Vymazané' : 'V Koši', clip.name)).catch(e => toast('error', 'Vymazanie zlyhalo', e.message));
        }
      });
  });
  onSeg($('#view-clips'), (name, v) => { if (name === 'filter') { filter = v; LS.set('kind', v); renderResults(); } });

  /* ---------- ZVUK ---------- */
  function deviceItems(t) {
    const list = (t.flow === 'capture' ? S.devices.capture : S.devices.render) || [];
    const items = [{ label: t.flow === 'capture' ? 'Predvolený mikrofón Windowsu' : 'Predvolený výstup Windowsu', v: '', checked: !t.deviceId && !t.deviceName }];
    if (list.length) items.push({ sep: true });
    for (const d of list) items.push({ label: d.name, v: d.id, name: d.name, sub: d.default ? 'predvolené' : '', checked: d.id === t.deviceId });
    if (t.deviceId && !list.some(d => d.id === t.deviceId)) items.push({ sep: true }, { label: `${t.deviceName || 'Uložené zariadenie'} (nepripojené)`, v: t.deviceId, name: t.deviceName, checked: true, disabled: true });
    return items;
  }
  function appItems(t, withForeground) {
    const items = [];
    if (withForeground) items.push({ label: 'Hra v popredí (automaticky)', v: '__fg', checked: t.kind === 'foreground' }, { sep: true });
    const ses = (S.sessions || []).slice().sort((a, b) => b.active - a.active || a.exe.localeCompare(b.exe));
    if (ses.length) items.push({ head: 'Appky so zvukom' });
    for (const s of ses) items.push({ label: s.exe, v: s.exe, sub: s.active ? 'hrá' : '', checked: t.kind === 'process' && (t.exe || '').toLowerCase() === s.exe.toLowerCase() });
    if (t.kind === 'process' && t.exe && !ses.some(s => s.exe.toLowerCase() === t.exe.toLowerCase())) items.push({ sep: true }, { label: t.exe, v: t.exe, sub: 'nebeží', checked: true });
    items.push({ sep: true }, { label: 'Zadať názov .exe…', v: '__custom' });
    return items;
  }
  function statusLine(t, live) {
    if (!t.on) return `<div class="status">Vypnutá</div>`;
    if (!live || S.engine.state === 'off') return `<div class="status">Buffer nebeží</div>`;
    const how = { id: 'podľa ID', name: 'podľa mena (ID sa zmenilo)', default: 'predvolené zariadenie', process: 'appka', foreground: 'hra v popredí' }[live.how] || '';
    if (live.status === 'bound') {
      const cls = live.how === 'default' && (t.deviceId || t.deviceName) ? 'warn' : 'ok';
      return `<div class="status ${cls}"><b>${esc(live.name || '—')}</b><span>· ${esc(how)}</span></div>`;
    }
    if (live.status === 'missing') {
      if (t.kind === 'foreground') return `<div class="status">Čakám na hru na celú obrazovku…</div>`;
      if (t.kind === 'process') return `<div class="status">${esc(t.exe)} nebeží · píšem ticho</div>`;
      return `<div class="status bad">Zariadenie sa nenašlo · píšem ticho</div>`;
    }
    if (live.status === 'error') return `<div class="status bad">Chyba (${esc(live.how)}) · pozri log</div>`;
    return `<div class="status">Pripájam…</div>`;
  }
  function renderAudio() {
    const root = $('#view-audio');
    const s = S.settings;
    let n = 0;
    root.innerHTML = `<div class="tracks">${s.tracks.map(t => {
      const L = TRACK_LOOK[t.id] || TRACK_LOOK.system;
      const live = S.engine.tracks[t.id];
      const num = t.on ? ++n : 0;
      let src = '';
      if (t.kind === 'device') {
        const cur = deviceItems(t).find(x => x.checked);
        src = `<div class="line">${pb(cur ? cur.label : 'Vyber zariadenie', () => deviceItems(t), it => setTrack(t.id, { deviceId: it.v, deviceName: it.name || '' }))}
          <button class="btn icon" data-refresh title="Načítať zariadenia znova">${I.refresh}</button></div>`;
      } else {
        const label = t.kind === 'foreground' ? 'Hra v popredí (automaticky)' : (t.exe || 'Vyber appku');
        src = `<div class="line">${pb(label, () => appItems(t, t.id === 'game'), it => pickApp(t, it))}
          <button class="btn icon" data-refresh title="Načítať appky znova">${I.refresh}</button></div>`;
        if (t.kind === 'foreground') src += `<div class="hint">Berie appku na celú obrazovku alebo borderless. Výnimky a vlastné hry nastavíš v Nastaveniach.</div>`;
      }
      return `<div class="track${t.on ? '' : ' off'}" data-track="${t.id}" style="--c:${L.c}">
        <div class="track-head"><div class="track-ic">${L.ic}</div><h3>${esc(t.name)}</h3>${num ? `<span class="num">stopa ${num + (s.mixTrack && hasMix() ? 1 : 0)}</span>` : ''}
          <label class="toggle"><input type="checkbox" data-on ${t.on ? 'checked' : ''}></label></div>
        <div class="meter" data-meter="${t.id}">${'<i></i>'.repeat(32)}</div>
        ${statusLine(t, live)}
        <div class="src">${src}${t.kind === 'device' ? `<div class="hint">${esc(L.hint)}</div>` : t.kind === 'process' ? `<div class="hint">${esc(L.hint)}</div>` : ''}</div>
        <div class="sync-row" title="Keď zvuk tejto stopy mešká za obrazom (napr. mikrofón cez VST pluginy), appka ho posunie dopredu.">
          <span>Oneskorenie</span>
          <button class="btn icon small" data-lat="-10" title="Menej o 10 ms">−</button><b data-latv>${latTxt(t.latency)}</b><button class="btn icon small" data-lat="10" title="Viac o 10 ms">+</button>
          ${t.id === 'mic' ? `<button class="btn small" data-calib>${CLAP_IC}<span>Zistiť tlieskaním</span></button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>
    <div class="box" style="margin-top:14px"><div class="row">
      <div class="grow"><b>Stopa 1 = mix systému a mikrofónu</b><span>Prehrávače a Discord hrajú len prvú stopu. Takto v nej budeš počuť všetko, ostatné stopy ostanú zvlášť na strih.</span></div>
      <label class="toggle"><input type="checkbox" id="mixTrack" ${s.mixTrack ? 'checked' : ''}></label></div></div>`;
    $$('[data-on]', root).forEach(cb => cb.addEventListener('change', () => setTrack(cb.closest('[data-track]').dataset.track, { on: cb.checked })));
    $$('[data-refresh]', root).forEach(b => b.addEventListener('click', async () => { b.disabled = true; await api.action('refreshDevices'); b.disabled = false; toast('ok', 'Načítané', `${S.devices.render.length} výstupov, ${S.devices.capture.length} vstupov, ${S.sessions.length} appiek so zvukom`); }));
    $('#mixTrack', root).addEventListener('change', e => save({ mixTrack: e.target.checked }));
    // oneskorenie stopy: ukladá sa až po chvíli (každá zmena reštartuje buffer)
    $$('[data-lat]', root).forEach(b => b.addEventListener('click', () => {
      const card = b.closest('[data-track]'), id = card.dataset.track, t = S.settings.tracks.find(x => x.id === id);
      const v = Math.max(-500, Math.min(1000, (latPending[id] ?? (t.latency || 0)) + Number(b.dataset.lat)));
      latPending[id] = v; card.querySelector('[data-latv]').textContent = latTxt(v);
      clearTimeout(latT); latT = setTimeout(() => { const p = { ...latPending }; latPending = {}; save({ tracks: S.settings.tracks.map(x => x.id in p ? { ...x, latency: p[x.id] } : x) }); }, 900);
    }));
    $$('[data-calib]', root).forEach(b => b.addEventListener('click', clapSync));
    drawMeters();
  }
  let latPending = {}, latT = null;
  const latTxt = v => (v || 0) + ' ms';
  const CLAP_IC = '<svg viewBox="0 0 20 20"><path d="M7.5 9.5 5 7a1.3 1.3 0 0 1 1.8-1.8l4 4M9.4 7.6 7.6 5.8a1.3 1.3 0 0 1 1.8-1.8l4.4 4.4M11 6.2l-.4-.4A1.3 1.3 0 0 1 12.4 4l3 3c2 2 2 5 0 7l-.6.6c-2 2-5 2-7 0L4.5 11.3a1.3 1.3 0 0 1 1.8-1.8l1.7 1.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 2.5l.6-1.2M17 4.6l1.2-.6M16.4 2.3l.9-.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  /* synchronizácia mikrofónu tlieskaním: 4 údery počúvaš, pri ďalších 4 tlieskaš; tiky sa nahrajú do stopy Systém,
     tlesknutia do mikrofónu a rozdiel je oneskorenie mikrofónu */
  /* tlieskanie ako samostatný prvok: v okne zo Zvuku aj priamo v sprievodcovi */
  function clapWidget(host, opts = {}) {
    const tr = id => S.settings.tracks.find(t => t.id === id);
    const N = 8, CLAP = 4, IV = 0.6, HZ = 1600;
    host.innerHTML = `<div class="cal-stage"><div class="cal-big" data-big>Pripravený?</div><div class="cal-dots">${Array.from({ length: N }, (_, k) => `<i class="${k >= CLAP ? 'clap' : ''}"></i>`).join('')}</div></div>
      <div class="cal-res" data-res></div>
      <div class="cal-acts">${opts.closeBtn ? '<button class="btn" data-a="no">Zavrieť</button>' : ''}<button class="btn primary" data-a="go">${CLAP_IC}<span>Štart</span></button></div>`;
    let ac = null, stopped = false;
    const big = host.querySelector('[data-big]'), dots = [...host.querySelectorAll('.cal-dots i')], res = host.querySelector('[data-res]'), go = host.querySelector('[data-a=go]');
    const label = t => { go.querySelector('span').textContent = t; };
    const nb = host.querySelector('[data-a=no]'); if (nb) nb.onclick = () => UI.closeModal();
    go.onclick = run;
    const fail = (title, html) => { big.textContent = title; big.classList.remove('clap'); res.innerHTML = html; go.disabled = false; label('Skúsiť znova'); go.onclick = run; };
    async function run() {
      if (S.engine.state !== 'on') return fail('Buffer nebeží', '<p class="bad">Zapni replay buffer (vľavo dole) a skús to znova.</p>');
      if (!tr('system').on || !tr('mic').on) return fail('Chýba stopa', '<p class="bad">Zapni stopu Systém aj Mikrofón: údery sa nahrávajú do Systému a tlesknutia do mikrofónu.</p>');
      go.disabled = true; res.innerHTML = ''; dots.forEach(d => { d.classList.remove('on', 'done'); });
      try { ac && ac.close(); } catch (e) { }
      ac = new AudioContext();
      const t0 = ac.currentTime + 1.2;
      for (let k = 0; k < N; k++) {
        const o = ac.createOscillator(), g = ac.createGain(), at = t0 + k * IV;
        o.frequency.value = HZ; o.type = 'sine';
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(k >= CLAP ? 0.6 : 0.45, at + 0.002); g.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
        o.connect(g).connect(ac.destination); o.start(at); o.stop(at + 0.07);
      }
      // obraz podľa hodín zvukovej karty, nech blikanie sedí s úderom
      await new Promise(done => {
        let lastK = -2;
        const f = () => {
          if (stopped || !document.body.contains(host)) { stopped = true; return done(); }
          const k = Math.floor((ac.currentTime - t0) / IV + 0.02);
          if (k !== lastK) {
            lastK = k;
            if (k < 0) big.textContent = 'Počúvaj…';
            else if (k < N) {
              dots.forEach((d, i) => { d.classList.toggle('on', i === k); d.classList.toggle('done', i < k); });
              big.textContent = k < CLAP ? String(CLAP - k) : 'TLESK!';
              big.classList.toggle('clap', k >= CLAP); big.classList.remove('beat'); void big.offsetWidth; big.classList.add('beat');
            }
          }
          if (ac.currentTime > t0 + N * IV + 0.2) { dots.forEach(d => { d.classList.remove('on'); d.classList.add('done'); }); return done(); }
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      if (stopped) return;
      big.textContent = 'Vyhodnocujem…'; big.classList.remove('clap');
      try {
        const r = await api.action('calibrateMic', { interval: IV * 1000, count: N, clapFrom: CLAP, tickHz: HZ });
        if (stopped) return;
        if (!r.ok) return fail('Nepodarilo sa', `<p class="bad">${esc(r.msg)}</p>${r.wav ? `<p class="cal-wav">Nahrávku (vľavo údery, vpravo mikrofón) nájdeš tu: <button class="btn small ghost" data-wav>Ukázať súbor</button></p>` : ''}`)
          || bindWav(r);
        if (Math.abs(r.offset) > 900) return fail(r.offset < 0 ? `Predbieha o ${(-r.offset / 1000).toFixed(1).replace('.', ',')} s` : `Mešká o ${(r.offset / 1000).toFixed(1).replace('.', ',')} s`, '<p class="bad">Toľko VST pluginy nepridajú, niečo je zle so zosúladením stôp. Ukonči appku cez lištu, spusti ju znova a skús to ešte raz.</p>');
        const cur = tr('mic').latency || 0, next = Math.max(-500, Math.min(1000, cur + r.offset));
        const okNow = Math.abs(r.offset) <= 10;
        big.textContent = okNow ? 'Sedí to' : r.offset > 0 ? `Mešká o ${r.offset} ms` : `Predbieha o ${-r.offset} ms`;
        res.innerHTML = `<p>${okNow ? `Mikrofón je zosynchronizovaný (odchýlka ${r.offset} ms).` : `Nastavím oneskorenie mikrofónu na <b>${next} ms</b>.`} Presnosť ±${Math.max(5, r.spread)} ms, tlesknutia: ${r.offsets.map(x => (x > 0 ? '+' : '') + x).join(', ')} ms.</p>`;
        go.disabled = false;
        if (okNow) { label('Skúsiť znova'); go.onclick = run; opts.onDone && opts.onDone(cur); return; }
        label('Použiť');
        go.onclick = async () => {
          go.disabled = true;
          await save({ tracks: S.settings.tracks.map(x => x.id === 'mic' ? { ...x, latency: next } : x) });
          toast('ok', 'Mikrofón zosynchronizovaný', `Oneskorenie ${next} ms. Buffer sa reštartuje.`);
          big.textContent = 'Hotovo'; res.innerHTML = `<p>Oneskorenie mikrofónu je <b>${next} ms</b>. Doladiť ho môžeš v Zvuk → Mikrofón.</p>`;
          label('Skúsiť znova'); go.disabled = false; go.onclick = run;
          opts.onDone && opts.onDone(next);
        };
      } catch (e) { fail('Nepodarilo sa', `<p class="bad">${esc(e.message)}</p>`); }
    }
    function bindWav(r) { const wb = res.querySelector('[data-wav]'); if (wb) wb.onclick = () => api.action('reveal', { path: r.wav }); }
    return { stop() { stopped = true; try { ac && ac.close(); } catch (e) { } } };
  }
  /* okno zo Zvuku → Mikrofón */
  function clapSync() {
    let w = null;
    const m = UI.modal(`<div class="cal"><h2>Synchronizácia mikrofónu</h2>
      <p>Appka zahrá 8 úderov. Prvé 4 len počúvaj, pri ďalších 4 <b>tlesni presne s úderom</b>, blízko mikrofónu. Najlepšie so slúchadlami a bez hudby v pozadí.</p>
      <div data-host></div></div>`, 'small cal-modal', () => w && w.stop());
    w = clapWidget(m.querySelector('[data-host]'), { closeBtn: true, onDone: () => { if (view === 'audio') renderAudio(); } });
  }
  window.App = Object.assign(window.App || {}, { clapWidget });
  function hasMix() { const on = S.settings.tracks.filter(t => t.on).map(t => t.id); return on.includes('system') && on.includes('mic'); }
  async function pickApp(t, it) {
    if (it.v === '__fg') return setTrack(t.id, { kind: 'foreground' });
    if (it.v === '__custom') {
      const m = UI.modal(`<h2>Názov appky</h2><p>Napíš názov .exe súboru, napríklad <b>VALORANT-Win64-Shipping.exe</b>. Nájdeš ho v Správcovi úloh → Podrobnosti.</p>
        <input class="input" id="exeIn" style="width:100%" value="${esc(t.exe || '')}" placeholder="appka.exe" spellcheck="false">
        <div class="acts"><button class="btn" data-a="no">Zrušiť</button><button class="btn primary" data-a="yes">Uložiť</button></div>`, 'small');
      const inp = $('#exeIn', m); setTimeout(() => inp.focus(), 50);
      const ok = () => { let v = inp.value.trim(); if (!v) return; if (!/\.exe$/i.test(v)) v += '.exe'; UI.closeModal(); setTrack(t.id, { kind: 'process', exe: v }); };
      m.querySelector('[data-a=no]').onclick = UI.closeModal; m.querySelector('[data-a=yes]').onclick = ok;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      return;
    }
    setTrack(t.id, { kind: 'process', exe: it.v });
  }
  function drawMeters() {
    $$('[data-meter]').forEach(m => {
      const v = lastLevels[m.dataset.meter] || 0;
      // logaritmická mierka, aby bolo vidieť aj tichý mikrofón
      const db = v > 0 ? 20 * Math.log10(v) : -90;
      const lit = Math.round(Math.max(0, Math.min(1, (db + 54) / 54)) * 32);
      const cells = m.children;
      for (let i = 0; i < 32; i++) cells[i].className = i < lit ? 'l' + (i >= 29 ? ' h' : i >= 23 ? ' m' : '') : '';
    });
  }

  /* ---------- NASTAVENIA ---------- */
  function row(title, desc, control) { return `<div class="row"><div class="grow"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div>${control}</div>`; }
  function toggle(id, on) { return `<label class="toggle"><input type="checkbox" data-set="${id}" ${on ? 'checked' : ''}></label>`; }
  function chipList(key, list) {
    return `<div class="chips" data-chips="${key}">${list.map((x, i) => `<span class="chip">${esc(x)}<button data-del="${i}" aria-label="Odobrať">${I.x}</button></span>`).join('')}
      <span class="chip-add"><input class="input" placeholder="appka.exe" data-add="${key}" spellcheck="false"></span></div>`;
  }
  /* aktualizácie (len nainštalovaná verzia) */
  function updDesc() {
    const u = S.update || {};
    if (!u.supported) return 'Spustené zo zdrojákov (Spustit.bat). Aktualizácie rieši nainštalovaná verzia z GitHubu.';
    return { checking: 'Hľadám novú verziu…', latest: 'Máš najnovšiu verziu.', downloading: `Sťahujem verziu ${esc(u.version || '')} · ${u.percent || 0} %`, ready: `Verzia ${esc(u.version || '')} je stiahnutá. Nainštaluje sa, keď appku ukončíš.`, error: esc(u.error || 'Aktualizácia sa nepodarila.') }[u.status] || 'Aktualizácie sa kontrolujú samy každé 4 hodiny.';
  }
  function updBtn() {
    const u = S.update || {};
    if (!u.supported) return '';
    if (u.status === 'ready') return `<button class="btn primary" id="updBtn" data-a="updateInstall">${I.refresh}<span>Reštartovať a aktualizovať</span></button>`;
    return `<button class="btn" id="updBtn" data-a="updateCheck"${['checking', 'downloading'].includes(u.status) ? ' disabled' : ''}>${I.refresh}<span>Skontrolovať</span></button>`;
  }
  /* upozornenie: beží aj iný nahrávací program */
  let recWarnSig = '';
  function renderRecWarn() {
    const el = $('#recWarn'); if (!el) return;
    const list = S.otherRecorders || [];
    const sig = JSON.stringify(list);
    if (sig === recWarnSig) return; recWarnSig = sig;
    el.hidden = !list.length;
    el.innerHTML = list.map(r => `<div class="rw-i" data-id="${esc(r.id)}">
        <i class="rw-ic"><svg viewBox="0 0 20 20"><path d="M10 3.2 18 17H2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 8.3v4M10 14.6v.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></i>
        <div class="grow"><b>Beží aj ${esc(r.name)}</b><span>${esc(r.how)}</span></div>
        ${r.canClose ? '<button class="btn" data-a="close">Zavrieť ho</button>' : ''}${r.settings ? '<button class="btn" data-a="settings">Otvoriť nastavenia</button>' : ''}
        <button class="btn ghost" data-a="ignore" title="Toto upozornenie už nezobrazovať">Nezobrazovať</button></div>`).join('');
  }
  $('#recWarn').addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.closest('.rw-i').dataset.id;
    if (b.dataset.a === 'close') { b.disabled = true; b.textContent = 'Zatváram…'; try { await api.action('closeRecorder', { id }); } catch (er) { toast('error', 'Nepodarilo sa zavrieť', er.message); } }
    if (b.dataset.a === 'settings') api.action('gameBarSettings');
    if (b.dataset.a === 'ignore') api.action('ignoreRecorder', { id });
  });
  function renderUpdPill() {
    const u = S && S.update, b = $('#updPill'); if (!b) return;
    b.hidden = !(u && u.status === 'ready');
    if (!b.hidden) b.querySelector('span').textContent = `Aktualizovať na ${u.version}`;
  }
  $('#updPill').addEventListener('click', () => api.action('updateInstall'));
  function perfDesc(s) {
    const sys = S.system || {}, ef = S.engine.effective;
    const pc = `${sys.cores || '?'} jadier · ${sys.ram || '?'} GB RAM · ${sys.hw ? `HW enkodér (${esc(sys.gpu || 'GPU')})` : 'bez HW enkodéra'}`;
    const now = ef ? (ef.save ? `Teraz zapnutý: ${ef.res ? ef.res + 'p' : 'natívne'} · ${ef.fps} fps.` : 'Teraz vypnutý.') : '';
    return `Na slabšom PC zníži fps, rozlíšenie a záťaž enkodéra, aby hra nesekala. ${now}<br><span class="sys-line">${pc}</span>`;
  }
  function renderSettings() {
    const root = $('#view-settings');
    const s = S.settings, av = S.encoders || {};
    const encName = { auto: 'Automaticky (najlepší dostupný)', nvenc: 'NVIDIA NVENC', amf: 'AMD AMF', qsv: 'Intel QuickSync', x264: 'Procesor (x264)' };
    const famOk = { nvenc: av.h264_nvenc, amf: av.h264_amf, qsv: av.h264_qsv, x264: av.libx264 !== false };
    const encItems = Object.keys(encName).map(k => ({ label: encName[k], v: k, checked: s.encoder === k, sub: k === 'auto' ? '' : S.encoders ? (famOk[k] ? 'dostupný' : 'nedostupný') : '', disabled: k !== 'auto' && S.encoders && !famOk[k] }));
    const codecOk = { h264: true, hevc: av.hevc_nvenc || av.hevc_amf || av.hevc_qsv, av1: av.av1_nvenc };
    const mons = S.monitors || [];
    const monLabel = (mons.find(m => m.idx === Number(s.monitor)) || { label: `Monitor ${Number(s.monitor) + 1}` }).label;
    const accents = ['#ff9f0a', '#0a84ff', '#bf5af2', '#ff375f', '#ff453a', '#ffd60a', '#30d158', '#40c8e0', '#8e8e93'];
    root.innerHTML = `<div class="settings-wrap">
      <div class="sec-title">Clipy</div>
      <div class="box">
        ${row('Replay buffer', 'Beží na pozadí a drží posledné sekundy obrazovky.', toggle('bufferEnabled', s.bufferEnabled))}
        ${row('Dĺžka clipu', 'Koľko sa uloží po stlačení skratky.', seg('bufferSeconds', [15, 30, 60, 120, 180, 300, 600].map(v => ({ v, l: v < 60 ? v + ' s' : v / 60 + ' min' })), s.bufferSeconds))}
        ${row('Upratovanie', `Keď klipy zaberú viac, najstaršie pôjdu do Koša. Obľúbené a klipy v priečinkoch sa nikdy nemažú. Teraz zaberajú ${esc(size(S.clips.reduce((a, c) => a + c.size, 0)))}.`, seg('cleanupGB', [{ v: 0, l: 'Vypnuté' }, { v: 20, l: '20 GB' }, { v: 50, l: '50 GB' }, { v: 100, l: '100 GB' }, { v: 200, l: '200 GB' }], s.cleanupGB || 0))}
        ${row('Priečinok', `<span class="path">${esc(s.clipsDir)}</span>`, `<button class="btn" id="pickDir">${I.folder}<span>Zmeniť</span></button>`)}
      </div>

      <div class="sec-title">Skratky</div>
      <div class="box">
        ${row('Uložiť clip', S.hotkeyErrors.includes('clip') ? '<span style="color:var(--rec)">Túto skratku už používa iná appka.</span>' : 'Funguje aj v hre na celú obrazovku.', `<button class="hk${S.hotkeyErrors.includes('clip') ? ' bad' : ''}" data-hk="clip">${esc(s.hotkeys.clip || 'Nastaviť')}</button>`)}
        ${row('Krátky clip', S.hotkeyErrors.includes('short') ? '<span style="color:var(--rec)">Túto skratku už používa iná appka.</span>' : 'Druhá skratka, ktorá uloží len posledných pár sekúnd. Backspace ju zruší.', `${seg('shortSeconds', [10, 15, 20, 30].map(v => ({ v, l: v + ' s' })), s.shortSeconds || 15)}<button class="hk${S.hotkeyErrors.includes('short') ? ' bad' : ''}" data-hk="short">${esc(s.hotkeys.short || 'Nastaviť')}</button>`)}
        ${row('Spustiť / zastaviť nahrávanie', S.hotkeyErrors.includes('record') ? '<span style="color:var(--rec)">Túto skratku už používa iná appka.</span>' : '', `<button class="hk${S.hotkeyErrors.includes('record') ? ' bad' : ''}" data-hk="record">${esc(s.hotkeys.record || 'Nastaviť')}</button>`)}
        ${row('Značka', S.hotkeyErrors.includes('mark') ? '<span style="color:var(--rec)">Túto skratku už používa iná appka.</span>' : 'Označí zaujímavý moment počas hrania alebo nahrávania. V editore naň skočíš klávesou M.', `<button class="hk${S.hotkeyErrors.includes('mark') ? ' bad' : ''}" data-hk="mark">${esc(s.hotkeys.mark || 'Nastaviť')}</button>`)}
        ${row('Skratky v hrách s anti-cheatom', 'LoL, Valorant a podobné hry bežia ako správca a Windows bežným appkám ich klávesy nepustí. Zapni, ak ti skratka v hre nejde. Pri štarte appky sa Windows raz opýta na povolenie.', toggle('hotkeysAdmin', !!s.hotkeysAdmin))}
      </div>

      <div class="sec-title">Video</div>
      <div class="box">
        ${row('Monitor', '', pb(monLabel, () => mons.map(m => ({ label: m.label, v: m.idx, checked: m.idx === Number(s.monitor) })), it => save({ monitor: it.v })))}
        ${row('Snímky za sekundu', '', seg('fps', [30, 60, 120, 144].map(v => ({ v, l: String(v) })), s.fps))}
        ${row('Rozlíšenie', 'Natívne ide priamo z grafiky bez kopírovania, preto je najľahšie.', seg('resolution', [{ v: 'native', l: 'Natívne' }, { v: '1440', l: '1440p' }, { v: '1080', l: '1080p' }, { v: '720', l: '720p' }], s.resolution))}
        ${row('Kvalita', '', seg('quality', [{ v: 'high', l: 'Vysoká' }, { v: 'medium', l: 'Stredná' }, { v: 'low', l: 'Nízka' }], s.quality))}
        ${row('Enkodér', `<span class="enc-tags">${['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_amf', 'h264_qsv', 'libx264'].map(k => `<span class="${av[k] ? 'ok' : ''}">${k}</span>`).join('')}</span>`, pb(encName[s.encoder] || encName.auto, encItems, it => save({ encoder: it.v })))}
        ${row('Kodek', 'H.264 otvorí všetko. HEVC a AV1 sú menšie súbory, ale nie každý strihový program ich zvládne.', seg('codec', [{ v: 'h264', l: 'H.264' }, { v: 'hevc', l: 'HEVC', disabled: S.encoders && !codecOk.hevc }, { v: 'av1', l: 'AV1', disabled: S.encoders && !codecOk.av1 }], s.codec))}
        ${row('Kurzor myši', '', toggle('cursor', s.cursor !== false))}
        ${row('Vyrezať okno hry v editore', 'Keď hráš v okne, editor sa otvorí rovno s výrezom len okna hry (napr. 16:9 zo širokého monitora). Vrátiš to cez Formát → Celá obrazovka.', toggle('autoWinCrop', !!s.autoWinCrop))}
        ${row('Úsporný režim', perfDesc(s), seg('powerSave', [{ v: 'auto', l: 'Automaticky' }, { v: 'on', l: 'Zapnutý' }, { v: 'off', l: 'Vypnutý' }], s.powerSave || 'auto'))}
      </div>

      <div class="sec-title">Hry</div>
      <div class="box">
        ${row('Nainštalované hry', S.scanningGames ? 'Hľadám v Steame, Epicu, GOG, Ubisofte, Xboxe, Riote a Minecrafte…' : `${(S.installed || []).length} nájdených. Stopa Hra ich spozná aj v okne a klipy dostanú ich názov a ikonku.`, `<button class="btn" id="scanG"${S.scanningGames ? ' disabled' : ''}>${I.refresh}<span>${S.scanningGames ? 'Hľadám…' : 'Hľadať znova'}</span></button>`)}
        ${(S.installed || []).length ? `<div class="inst">${S.installed.map(g => `<span class="inst-g" title="${esc(g.name)} · ${esc(g.source)} · ${esc((g.exes || []).join(', '))}">${avatar(g.name, null, 'sm')}${esc(g.name)}</span>`).join('')}</div>` : ''}
        <div style="height:6px"></div>
        ${row('Vždy brať ako hru', 'Stopa Hra chytí tieto appky, aj keď nebežia na celú obrazovku.', '')}
        ${chipList('games', s.games || [])}
        <div style="height:12px"></div>
        ${row('Nikdy nebrať ako hru', 'Discord, prehliadač na celú obrazovku a podobne.', `<button class="btn ghost small" id="resetEx">Predvolené</button>`)}
        ${chipList('exclude', s.exclude || [])}
      </div>

      <div class="sec-title">Systém</div>
      <div class="box">
        ${row('Spustiť s Windowsom', 'Skryto v lište vedľa hodín, ako to máš teraz s OBS.', toggle('launchAtLogin', s.launchAtLogin))}
        ${row('Zavrieť do lišty', 'Krížik okno len skryje, buffer beží ďalej.', toggle('closeToTray', s.closeToTray))}
        ${row('Notifikácie Windowsu', s.overlay !== false ? 'Pri uložení clipu stačí overlay, notifikácia príde len pri chybe.' : 'Keď sa clip uloží a okno nie je vpredu, aj pri chybe.', toggle('notify', s.notify))}
        ${row('Overlay po uložení clipu', 'V rohu obrazovky sa na chvíľu ukáže oko alebo klapka. Vidno ho nad hrou v okne alebo v borderless režime, nie v exkluzívnom fullscreene.', `<button class="btn small ghost" id="ovTest">Ukážka</button>${toggle('overlay', s.overlay !== false)}`)}
        ${s.overlay !== false ? row('Animácia', '', seg('overlayStyle', [{ v: 'eye', l: 'Oko' }, { v: 'clap', l: 'Klapka' }], s.overlayStyle || 'eye')) : ''}
        ${s.overlay !== false ? row('Roh obrazovky', '', seg('overlayCorner', [{ v: 'tl', l: '↖ Vľavo hore' }, { v: 'tr', l: 'Vpravo hore ↗' }, { v: 'bl', l: '↙ Vľavo dole' }, { v: 'br', l: 'Vpravo dole ↘' }], s.overlayCorner || 'tr')) : ''}
        ${row('Zvuk po uložení clipu', 'Počuť ho aj v hre.', toggle('sounds', s.sounds))}
        ${s.sounds ? `<div class="snd-grid">${UI.SOUNDS.map(x => `<button class="snd${(s.clipSound || 'beep') === x.id ? ' on' : ''}" data-snd="${x.id}">${x.id === 'none' ? '' : '<i>▶</i>'}${esc(x.label)}</button>`).join('')}</div>
        ${row('Hlasitosť zvuku', '', `<input type="range" id="sndVol" min="0" max="100" value="${Math.round((s.soundVolume ?? 0.6) * 100)}" style="--p:${Math.round((s.soundVolume ?? 0.6) * 100)}%;width:180px">`)}` : ''}
        ${row('Vzhľad', '', seg('appearance', [{ v: 'auto', l: 'Podľa Windowsu' }, { v: 'light', l: 'Svetlý' }, { v: 'dark', l: 'Tmavý' }], s.appearance))}
        ${row('Farba', '', `<div class="swatches">${accents.map(a => `<button style="--sw:${a}" data-accent="${a}" class="${a === s.accent ? 'on' : ''}" aria-label="${a}"></button>`).join('')}</div>`)}
      </div>

      <div class="sec-title">O appke</div>
      <div class="box">
        ${row('LookAtThis ' + esc(S.version), updDesc(), updBtn())}
        ${(S.update || {}).supported ? row('Beta verzie', 'Nové funkcie skôr, ale môžu mať chyby.', seg('updateChannel', [{ v: 'stable', l: 'Nie' }, { v: 'beta', l: 'Áno' }], s.updateChannel || 'stable')) : ''}
        ${row('Enkodér', `Práve: ${esc(S.engine.encoder || '—')}`, `<button class="btn" id="redetect">${I.refresh}<span>Zistiť enkodéry</span></button>`)}
        ${row('Sprievodca nastavením', 'Skratky, zvuk, výkon a ukladanie znova krok za krokom.', `<button class="btn" id="runSetup">Spustiť znova</button>`)}
        ${row('Log', 'Keď niečo nejde, tu je napísané prečo.', `<button class="btn" id="openLog">Otvoriť log</button>`)}
        ${row('Ukončiť LookAtThis', 'Vypne buffer aj ikonku v lište.', `<button class="btn danger" id="quit">Ukončiť</button>`)}
      </div>
    </div>`;
    placeThumbs(root);
    $$('[data-set]', root).forEach(cb => cb.addEventListener('change', () => save({ [cb.dataset.set]: cb.checked })));
    $$('[data-accent]', root).forEach(b => b.addEventListener('click', async () => { await save({ accent: b.dataset.accent }); applyLook(); renderSettings(); }));
    $('#pickDir', root).onclick = () => api.action('pickFolder');
    $('#resetEx', root).onclick = () => api.action('resetExclude');
    $('#ovTest', root).onclick = () => api.action('testOverlay');
    $('#runSetup', root).onclick = () => Setup.open();
    $$('[data-snd]', root).forEach(b => b.onclick = () => { sound(b.dataset.snd, S.settings.soundVolume ?? 0.6); $$('[data-snd]', root).forEach(x => x.classList.toggle('on', x === b)); save({ clipSound: b.dataset.snd }); });
    const sv = $('#sndVol', root);
    if (sv) { sv.oninput = () => sv.style.setProperty('--p', sv.value + '%'); sv.onchange = () => { save({ soundVolume: sv.value / 100 }); sound(S.settings.clipSound || 'beep', sv.value / 100); }; }
    $('#scanG', root).onclick = () => api.action('scanGames').then(r => toast('ok', 'Hry nájdené', `${(r.games || []).length} hier`));
    const ub = $('#updBtn', root);
    if (ub) ub.onclick = async () => { ub.disabled = true; try { await api.action(ub.dataset.a); } catch (e) { toast('error', 'Aktualizácia', e.message); } };
    $('#redetect', root).onclick = async e => { const b = e.currentTarget; b.disabled = true; await api.action('detectEncoders'); b.disabled = false; toast('ok', 'Enkodéry zistené'); };
    $('#openLog', root).onclick = () => api.action('openLog');
    $('#quit', root).onclick = () => api.action('quit');
    $$('[data-chips]', root).forEach(box => {
      const key = box.dataset.chips;
      box.addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d) { const l = (S.settings[key] || []).slice(); l.splice(+d.dataset.del, 1); save({ [key]: l }).then(renderSettings); } });
      const inp = $('[data-add]', box);
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        let v = inp.value.trim(); if (!v) return; if (!/\.exe$/i.test(v)) v += '.exe';
        const l = (S.settings[key] || []).filter(x => x.toLowerCase() !== v.toLowerCase()); l.push(v);
        save({ [key]: l }).then(() => { renderSettings(); $(`[data-add="${key}"]`).focus(); });
      });
    });
    $$('[data-hk]', root).forEach(b => b.addEventListener('click', () => captureHotkey(b)));
  }
  onSeg($('#view-settings'), (name, v) => {
    const num = ['bufferSeconds', 'fps', 'shortSeconds', 'cleanupGB'].includes(name);
    save({ [name]: num ? Number(v) : v }).then(() => { if (name === 'appearance') applyLook(); });
  });

  /* nahrávanie skratky: stlač kombináciu, Esc zruší, Backspace vymaže */
  function captureHotkey(btn) {
    const id = btn.dataset.hk;
    btn.classList.add('listening'); btn.textContent = 'Stlač kombináciu…';
    // názov klávesy: najprv podľa znaku (rešpektuje rozloženie), ak ten nie je písmeno/číslica (napr. slovenský číselný rad s Alt),
    // tak podľa fyzickej klávesy
    const CODE = { Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Quote: "'", Semicolon: ';', Space: 'Space', Enter: 'Return', Tab: 'Tab' };
    const keyName = e => {
      const k = e.key, c = e.code || '';
      if (/^F\d{1,2}$/.test(k)) return k;
      if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
      const map = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', PrintScreen: 'PrintScreen', Pause: 'Pause', ScrollLock: 'Scrolllock' };
      if (map[k]) return map[k];
      if (c.startsWith('Numpad')) return 'num' + c.slice(6).toLowerCase().replace('add', 'add').replace('subtract', 'sub').replace('multiply', 'mult').replace('divide', 'div').replace('decimal', 'dec');
      let m;
      if ((m = /^Key([A-Z])$/.exec(c))) return m[1];
      if ((m = /^Digit(\d)$/.exec(c))) return m[1];
      if (CODE[c]) return CODE[c];
      return null;
    };
    const done = () => { document.removeEventListener('keydown', onKey, true); btn.classList.remove('listening'); setTimeout(renderSettings, 10); };
    const onKey = e => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return done();
      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) { save({ hotkeys: { ...S.settings.hotkeys, [id]: '' } }).then(done); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const k = keyName(e); if (!k) { btn.textContent = 'Túto klávesu nepoznám, skús inú'; return; }
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl'); if (e.altKey) parts.push('Alt'); if (e.shiftKey) parts.push('Shift');
      if (!parts.length && !/^F\d+$|^num|^PrintScreen$|^Pause$|^Scrolllock$|^Insert$/.test(k)) { btn.textContent = 'Pridaj Ctrl, Alt alebo Shift'; return; }
      parts.push(k);
      save({ hotkeys: { ...S.settings.hotkeys, [id]: parts.join('+') } }).then(done);
    };
    document.addEventListener('keydown', onKey, true);
    btn.addEventListener('blur', done, { once: true });
  }

  /* ---------- render ---------- */
  function render() {
    if (!S) return;
    renderChrome();
    if (view === 'clips') renderClips();
    else if (view === 'audio') renderAudio();
    else renderSettings();
  }
  // počas písania v poli neprekresľuj nastavenia (stratil by sa fokus)
  const busy = () => { const a = document.activeElement; return a && (a.matches('input:not([type=checkbox])') || a.classList.contains('listening')) && !a.closest('.tools'); };

  api.on('state', st => {
    const firstClips = !S || S.settings.clipsDir !== st.settings.clipsDir;
    S = st; applyLook();
    // pri prvom načítaní (aj po zmene priečinka) nie sú všetky klipy „nové“ a nemajú blikať
    if (firstClips) S.clips.forEach(c => seenClips.add(c.path));
    renderChrome();
    if (busy() || document.querySelector('.pop-menu')) return;
    // klipy prekresli len keď sa naozaj zmenili (inak by karty pri každej zmene stavu znova naskakovali)
    // náhľady pribúdajú po dávkach: vtedy len doplň obrázky, celú knižnicu neprekresľuj
    const sig = (S.folders || []).join('/') + folderF + S.clips.map(c => c.path + c.mtime + c.game + (c.fav ? '★' : '')).join('|') + S.settings.hotkeys.clip + S.settings.bufferSeconds + JSON.stringify(S.settings.gameNames || {}) + (S.installed || []).map(g => g.name + (g.icon || '')).join();
    if (view === 'clips') {
      if (sig !== lastSig) {
        // zmena na pozadí (nový clip, presun…): prekresli potichu, bez nábehovej animácie a so zachovaným posunom
        const sc = $('#view-clips'), top = sc.scrollTop, quiet = !!lastSig;
        lastSig = sig; renderClips(quiet); sc.scrollTop = top;
      } else patchThumbs();
    } else if (view === 'audio') renderAudio(); else renderSettings();
  });
  // okno v pozadí: zastav nekonečné animácie (pulzujúce bodky, pásik buffra)
  const setIdle = () => document.body.classList.toggle('idle', document.hidden || !document.hasFocus());
  addEventListener('blur', setIdle); addEventListener('focus', setIdle); document.addEventListener('visibilitychange', setIdle);
  setIdle();
  api.on('levels', d => {
    lastLevels = d.levels;
    if (S) { S.engine.buffered = d.buffered; updateLive(d); }
    if (view === 'audio') drawMeters();
    window.dispatchEvent(new CustomEvent('lat-levels', { detail: d }));
  });
  api.on('event', ev => {
    if (Player._onEvent) Player._onEvent(ev);
    if (window.__compressProg) window.__compressProg(ev);
    if (ev.type === 'toast') toast(ev.kind, ev.title, ev.body, ev.path ? { action: { label: 'Prehrať', run: () => { const c = S.clips.find(x => x.path === ev.path); if (c) openEditor([c]); } } } : {});
    if (ev.type === 'sound' && ev.name === 'saved') { eyeAnim('wink'); window.dispatchEvent(new Event('lat-saved')); }
    // zvuky hrá hlavný proces cez overlay (fungujú aj so zatvoreným oknom), okno len žmurkne
    if (ev.type === 'update') { S.update = ev.status; renderUpdPill(); if (view === 'settings' && !busy()) renderSettings(); }
    if (ev.type === 'maximized') $('#winMax').classList.toggle('is-max', ev.value);
    else if (ev.type === 'open') { const c = S && S.clips.find(x => x.path === ev.path); if (c) { go('clips'); openEditor([c]); } }
  });
  window.addEventListener('resize', () => { moveInd(); placeThumbs(document); });

  /* oko v logu: pozerá za kurzorom, občas žmurkne, pri uložení clipu žmurkne na teba */
  const brandEye = $('#brandEye'), brandIris = $('#brandIris'), eyeLid = brandEye && brandEye.querySelector('.be-eye');
  let eyeRaf = 0, lastMove = 0;
  document.addEventListener('mousemove', e => {
    if (!brandEye || eyeRaf) return;
    eyeRaf = requestAnimationFrame(() => {
      eyeRaf = 0; lastMove = Date.now();
      const r = brandEye.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
      brandIris.style.transform = `translate(${(dx / d * 6 * k).toFixed(2)}px, ${(dy / d * 4 * k).toFixed(2)}px)`;
    });
  });
  function eyeAnim(cls) { if (!eyeLid) return; eyeLid.classList.remove('blink', 'wink'); void eyeLid.getBBox(); eyeLid.classList.add(cls); }
  (function blinkLoop() { setTimeout(() => { if (!document.hidden) eyeAnim('blink'); if (Date.now() - lastMove > 4000 && brandIris) brandIris.style.transform = ''; blinkLoop(); }, 3500 + Math.random() * 5000); })();

  api.getState().then(st => {
    S = st; applyLook();
    S.clips.forEach(c => seenClips.add(c.path));
    render(); moveInd();
    if (!S.settings.onboarded) setTimeout(() => Setup.open(), 350);
    requestAnimationFrame(() => { $('#navInd').style.transition = 'none'; moveInd(); requestAnimationFrame(() => { $('#navInd').style.transition = ''; }); });
  });
})();
