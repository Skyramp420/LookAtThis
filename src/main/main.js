const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, Notification, nativeImage, globalShortcut, screen, nativeTheme } = require('electron');
const U = require('./updater');
const Calib = require('./calib');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const net = require('net');
const os = require('os');
const { Engine, thumbnail, probe, trim, extractTracks, exportSequence, compressClip, detectBars } = require('./engine');
const Compress = require('../shared/compress');
const GameScan = require('./games-scan');
const Store = require('./store');
const Games = require('../shared/games');

app.setAppUserModelId('sk.shapefx.lookatthis');
// v prehrávači chceme prepínať zvukové stopy (video.audioTracks)
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const ROOT = path.join(__dirname, '..', '..');
const unpacked = p => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const FFMPEG = unpacked(require('ffmpeg-static'));
const FXAUDIO = unpacked(path.join(ROOT, 'native', 'fxaudio.exe'));
const FXKEYS = unpacked(path.join(ROOT, 'native', 'fxkeys.exe'));
// novšia verzia pomocníka, ktorá sa nedala prepísať, kým appka bežala → vymeň ju pri štarte
try { const nw = FXAUDIO.replace(/fxaudio\.exe$/, 'fxaudio.new.exe'); if (fs.existsSync(nw)) fs.renameSync(nw, FXAUDIO); } catch (e) { }
const ICON = unpacked(path.join(ROOT, 'assets', 'icon.png'));
const TRAY = unpacked(path.join(ROOT, 'assets', 'tray.png'));
const TRAY_REC = unpacked(path.join(ROOT, 'assets', 'tray-rec.png'));
const HIDDEN = process.argv.includes('--hidden');

const USER = app.getPath('userData');
const THUMBS = path.join(USER, 'thumbs');
const GAMES_FILE = path.join(USER, 'games.json');
const ENC_FILE = path.join(USER, 'encoders.json');
const GAME_ICONS = path.join(USER, 'gameicons');
const TMP = path.join(app.getPath('temp'), 'LookAtThis-buffer');
const LOGF = path.join(USER, 'lookatthis.log');
const EDIT = path.join(app.getPath('temp'), 'LookAtThis-edit');

/* ---------- log ---------- */
function logw(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map(a => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`;
  try { fs.mkdirSync(USER, { recursive: true }); fs.appendFileSync(LOGF, line); } catch (e) { }
  if (!app.isPackaged) process.stdout.write(line);
}
const log = { info: (...a) => logw('info', a), warn: (...a) => logw('warn', a), error: (...a) => logw('error', a) };
try { if (fs.statSync(LOGF).size > 2e6) fs.renameSync(LOGF, LOGF + '.old'); } catch (e) { }

process.on('uncaughtException', err => { log.error('uncaught', err); });
process.on('unhandledRejection', err => { log.error('unhandledRejection', err instanceof Error ? err : new Error(String(err))); });
app.on('render-process-gone', (e, wc, d) => log.error('render-process-gone', d));
app.on('child-process-gone', (e, d) => log.error('child-process-gone', d));
let store, engine, win, tray, quitting = false;
let devices = { render: [], capture: [] }, sessions = [], hotkeyErrors = [];

/* ---------- pomocník fxaudio ---------- */
function fx(cmd) {
  return new Promise(resolve => {
    execFile(FXAUDIO, [cmd], { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (err, out) => {
      if (err) { log.warn('fxaudio ' + cmd, err.message); return resolve(null); }
      try { resolve(JSON.parse(out)); } catch (e) { log.warn('fxaudio json', out); resolve(null); }
    });
  });
}
async function refreshDevices() {
  const [d, s] = await Promise.all([fx('list'), fx('sessions')]);
  if (d) devices = d;
  if (s) sessions = s.filter(x => x.exe && !/^(LookAtThis|ClipIt|electron|audiodg|svchost)\.exe$/i.test(x.exe));
  return { devices, sessions };
}

/* ---------- knižnica clipov ---------- */
const VIDEO = /\.(mp4|mkv|mov)$/i;
let thumbQueue = [], thumbBusy = false;
function thumbFile(p, mtime) { return path.join(THUMBS, crypto.createHash('sha1').update(p + '|' + mtime).digest('hex').slice(0, 20) + '.jpg'); }
/* priečinky = skutočné podpriečinky v priečinku s klipmi (jedna úroveň) */
const cleanName = n => String(n || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 80);
function listFolders() {
  const dir = store.get().clipsDir;
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('$')).map(d => d.name).sort((a, b) => a.localeCompare(b, 'sk')); } catch (e) { return []; }
}
function folderDir(name) {
  const dir = store.get().clipsDir;
  if (!name) return dir;
  const n = cleanName(name); if (!n) throw new Error('Neplatný názov priečinka');
  return path.join(dir, n);
}
function uniquePath(dir, base) {
  const ext = path.extname(base), stem = base.slice(0, -ext.length || undefined);
  let out = path.join(dir, base), k = 2;
  while (fs.existsSync(out)) out = path.join(dir, `${stem} (${k++})${ext}`);
  return out;
}
/* presun súboru klipu aj s metadátami a náhľadom */
function moveClipFile(from, toDir) {
  if (path.dirname(from) === toDir) return from;
  fs.mkdirSync(toDir, { recursive: true });
  const to = uniquePath(toDir, path.basename(from));
  const st = fs.statSync(from);
  fs.renameSync(from, to);
  const m = store.meta()[from]; store.setMeta(from, null); if (m) store.setMeta(to, m);
  try { const a = thumbFile(from, st.mtimeMs), b = thumbFile(to, fs.statSync(to).mtimeMs); if (fs.existsSync(a)) fs.renameSync(a, b); } catch (e) { }
  return to;
}
/* zoznam klipov je v pamäti: pri tisíckach súborov by čítanie disku pri každej zmene stavu brzdilo appku.
   Obnoví sa, keď sa niečo zmení (akcia, uložený clip, nový náhľad, zmena v priečinku na disku). */
let clipCache = null, clipRev = 0, queued = new Set();
const invalidateClips = () => { clipCache = null; };
function listClips() {
  if (clipCache && clipCache.dir === store.get().clipsDir) return clipCache.list;
  const list = scanClips();
  clipCache = { dir: store.get().clipsDir, list }; clipRev++;
  watchClips();
  return list;
}
function scanClips() {
  const dir = store.get().clipsDir;
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => VIDEO.test(f)).map(f => ['', f]); } catch (e) { return []; }
  for (const fo of listFolders()) { try { fs.readdirSync(path.join(dir, fo)).filter(f => VIDEO.test(f)).forEach(f => files.push([fo, f])); } catch (e) { } }
  const meta = store.meta();
  return files.map(([folder, f]) => {
    const p = path.join(dir, folder, f);
    let st; try { st = fs.statSync(p); } catch (e) { return null; }
    const th = thumbFile(p, st.mtimeMs);
    const hasThumb = fs.existsSync(th);
    if (!hasThumb && !queued.has(p)) { queued.add(p); thumbQueue.push(p); }
    const m = meta[p] || {};
    const name = f.replace(VIDEO, '');
    // hru a typ vieme odvodiť aj z názvu súboru (klipy zo starších verzií alebo bez záznamu)
    const kind = m.kind || (/\(\d+ MB\)/.test(name) ? 'small' : /\(strih/.test(name) ? 'cut' : /\(upraven/.test(name) ? 'edit' : /\(orez/.test(name) ? 'trim' : /^nahrávka /i.test(name) ? 'rec' : '');
    return { path: p, folder, name, ext: path.extname(f).slice(1), size: st.size, mtime: st.mtimeMs, thumb: hasThumb ? th : null, duration: m.duration || 0, game: m.game === '-' ? '' : m.game ? m.game : Games.fromFileName(name), kind, fav: !!m.fav, win: m.win || null, marks: m.marks || null, fg: m.fg || null };
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
}
async function pumpThumbs() {
  if (thumbBusy) return;
  thumbBusy = true;
  let did = 0, lastPush = Date.now();
  // najnovšie klipy prvé (tie uvidíš hore), náhľady priebežne po dávkach
  const mt = new Map(thumbQueue.map(f => { try { return [f, fs.statSync(f).mtimeMs]; } catch (e) { return [f, 0]; } }));
  thumbQueue.sort((a, b) => mt.get(b) - mt.get(a));
  while (thumbQueue.length) {
    const p = thumbQueue.shift();
    try {
      const st = fs.statSync(p);
      fs.mkdirSync(THUMBS, { recursive: true });
      await thumbnail(FFMPEG, p, thumbFile(p, st.mtimeMs));
      if (!store.meta()[p] || !store.meta()[p].duration) { const pr = await probe(FFMPEG, p); store.setMeta(p, { duration: pr.duration }); }
      did++;
    } catch (e) { }
    queued.delete(p);
    if (did && Date.now() - lastPush > 2500) { lastPush = Date.now(); invalidateClips(); send('state', fullState()); }
  }
  thumbBusy = false;
  if (did) { invalidateClips(); pushState(); }
}

/* ---------- stav pre okno ---------- */
/* ---------- nainštalované hry ---------- */
let installed = { at: 0, games: [] }, scanning = false;
try { installed = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')); } catch (e) { }
function applyInstalled() {
  const map = {};
  for (const g of installed.games || []) for (const e of g.exes || []) if (!map[e]) map[e] = g.name;
  engine.detectedMap = map;
  engine.detectedExes = Object.keys(map);
}
async function scanGames() {
  if (scanning) return installed;
  scanning = true; pushState();
  try {
    const games = await GameScan.scanAll(GAME_ICONS, p => app.getFileIcon(p, { size: 'large' }));
    installed = { at: Date.now(), games: games.map(({ id, name, source, exes, icon }) => ({ id, name, source, exes, icon })) };
    fs.writeFileSync(GAMES_FILE, JSON.stringify(installed, null, 1));
    const before = (engine.detectedExes || []).join();
    applyInstalled();
    log.info(`nájdené hry: ${installed.games.length}`);
    // nové exe pre stopu Hra → reštart buffra, aby ich pomocník poznal (len keď sa nenahráva)
    if (before !== engine.detectedExes.join() && engine.proc && !engine.recording) engine.restart(store.get());
  } catch (e) { log.warn('hľadanie hier', e.message); }
  scanning = false; pushState();
  return installed;
}

/* ---------- informácie o PC (pre úsporný režim a sprievodcu) ---------- */
let system = { cores: os.cpus().length, ram: Math.round(os.totalmem() / 1e9), gpu: '', weak: false };
async function readSystem() {
  try {
    const info = await app.getGPUInfo('basic');
    const dev = (info.gpuDevice || []).find(d => d.active) || (info.gpuDevice || [])[0];
    const vendors = { 4318: 'NVIDIA', 4098: 'AMD', 32902: 'Intel' };
    if (dev) system.gpu = vendors[dev.vendorId] || '';
  } catch (e) { }
  updateWeak();
}
/* slabší PC: bez HW enkodéra, ≤ 4 jadrá alebo < 8 GB RAM */
function updateWeak() {
  system.hw = engine.hasHW();
  system.weak = (engine.available != null && !system.hw) || system.cores <= 4 || system.ram < 8;
  engine.weak = system.cores <= 4 || system.ram < 8;
}
/* výsledok testu enkodérov si pamätáme (test pri každom štarte zbytočne zaťaží PC pri štarte Windowsu) */
function encKey() { try { const st = fs.statSync(FFMPEG); return `${st.size}-${Math.round(st.mtimeMs)}`; } catch (e) { return ''; } }
function loadEncCache() {
  try {
    const c = JSON.parse(fs.readFileSync(ENC_FILE, 'utf8'));
    if (c.key === encKey() && Date.now() - c.at < 30 * 864e5) engine.available = c.result;
  } catch (e) { }
}
function wrapDetect() {
  const orig = engine.detectEncoders.bind(engine);
  engine.detectEncoders = async () => {
    const r = await orig();
    try { fs.writeFileSync(ENC_FILE, JSON.stringify({ key: encKey(), at: Date.now(), result: r })); } catch (e) { }
    updateWeak(); pushState();
    return r;
  };
}

/* ---------- iné nahrávacie programy na pozadí (dva naraz zbytočne zaťažujú grafiku a disk) ---------- */
const RECORDERS = [
  { id: 'obs', name: 'OBS Studio', exes: ['obs64.exe', 'obs32.exe', 'obs.exe'], how: 'Ak v ňom beží replay buffer alebo nahrávanie, zastav ho, alebo OBS zavri.' },
  { id: 'slobs', name: 'Streamlabs Desktop', exes: ['streamlabs obs.exe', 'streamlabs desktop.exe'], how: 'Zastav v ňom replay buffer, alebo ho zavri.' },
  { id: 'medal', name: 'Medal', exes: ['medal.exe', 'medalencoder.exe'], how: 'Medal nahráva na pozadí stále. Zavri ho, alebo v ňom vypni nahrávanie.' },
  { id: 'outplayed', name: 'Outplayed', exes: ['outplayed.exe'], how: 'Outplayed nahráva hry automaticky. Zavri ho, alebo v ňom vypni nahrávanie.' },
  { id: 'xsplit', name: 'XSplit', exes: ['xsplit.core.exe', 'xsplit.broadcaster.exe'], how: 'Zavri ho, ak práve nestreamuješ.' },
  { id: 'bandicam', name: 'Bandicam', exes: ['bdcam.exe'], how: 'Zavri ho, ak ho práve nepoužívaš.' },
  { id: 'nvidia', name: 'NVIDIA Okamžitý záznam', exes: ['nvsphelper64.exe'], soft: true, how: 'Ak máš v NVIDIA overlayi (Alt+Z) zapnutý Okamžitý záznam / Instant Replay, vypni ho. Ak ho nemáš zapnutý, toto upozornenie skry.' }
];
let otherRecorders = [];
function listProcesses() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(new Set());
    execFile('tasklist.exe', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000, maxBuffer: 8e6 }, (err, out) => {
      if (err) return resolve(new Set());
      const set = new Set();
      for (const line of String(out).split(/\r?\n/)) { const m = /^"([^"]+)"/.exec(line); if (m) set.add(m[1].toLowerCase()); }
      resolve(set);
    });
  });
}
function gameBarRecording() {
  // Xbox Game Bar: „Nahrávať, čo sa stalo“ (nahrávanie na pozadí) = HistoricalCaptureEnabled
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', '/v', 'HistoricalCaptureEnabled'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      resolve(!err && /HistoricalCaptureEnabled\s+REG_DWORD\s+0x1\b/i.test(String(out)));
    });
  });
}
async function detectRecorders() {
  try {
    const [procs, bar] = await Promise.all([listProcesses(), gameBarRecording()]);
    const ign = store.get().ignoreRecorders || [];
    const found = RECORDERS.filter(r => r.exes.some(e => procs.has(e))).map(r => ({ id: r.id, name: r.name, how: r.how, soft: !!r.soft, canClose: !r.soft }));
    if (bar) found.push({ id: 'gamebar', name: 'Xbox Game Bar (nahrávanie na pozadí)', how: 'Vo Windows nastaveniach vypni „Nahrávať, čo sa stalo“. Nahráva to isté čo LookAtThis.', settings: true });
    const list = found.filter(r => !ign.includes(r.id));
    const before = otherRecorders.map(r => r.id).join(','), now = list.map(r => r.id).join(',');
    const fresh = list.filter(r => !otherRecorders.some(o => o.id === r.id));
    otherRecorders = list;
    if (before !== now) {
      pushState();
      if (fresh.length) {
        log.info('iný nahrávací program: ' + fresh.map(r => r.name).join(', '));
        toast('warn', `Beží aj ${fresh.map(r => r.name).join(', ')}`, 'Dva nahrávacie programy naraz zbytočne zaťažujú grafiku a disk. Detaily nájdeš hore v okne.');
      }
    }
  } catch (e) { log.warn('detekcia nahrávačov', e.message); }
}

function fullState() {
  return {
    system, otherRecorders,
    installed: installed.games || [], scanningGames: scanning, folders: listFolders(), update: U.status(),
    settings: store.get(), engine: engine.status(), clips: listClips(), clipsRev: clipRev, devices, sessions,
    encoders: engine.available, hotkeyErrors, monitors: monitors(), version: app.getVersion(), userData: USER
  };
}
function monitors() {
  // poradie v ddagrab = poradie výstupov DXGI; Electron dáva displeje, primárny býva prvý
  const prim = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().sort((a, b) => (b.id === prim) - (a.id === prim) || a.bounds.x - b.bounds.x)
    .map((d, i) => {
      const w = Math.round(d.size.width * d.scaleFactor), h = Math.round(d.size.height * d.scaleFactor);
      return { idx: i, w, h, label: `${i + 1}: ${w}×${h}${d.id === prim ? ' (hlavný)' : ''}` };
    });
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
let pushT = null;
function pushState() { clearTimeout(pushT); pushT = setTimeout(() => { send('state', fullState()); refreshTray(); setTimeout(pumpThumbs, 50); }, 60); }
function toast(kind, title, body, extra) { send('event', { type: 'toast', kind, title, body, ...extra }); }

/* ---------- akcie ---------- */
const CAPTURE_KEYS = ['powerSave', 'monitor', 'fps', 'resolution', 'quality', 'encoder', 'codec', 'cursor', 'tracks', 'games', 'exclude'];
let restartT = null;

/* okno (z fxkeys) → výrez 0–1 vzhľadom na nahrávaný monitor; null pri celej obrazovke / inom monitore */
function regionFrom(r) {
  if (!r || !r.w || !r.h || !r.mw || !r.mh) return null;
  const mon = monitors().find(m => m.idx === (Number(store.get().monitor) || 0));
  if (mon && (Math.abs(mon.w - r.mw) > 2 || Math.abs(mon.h - r.mh) > 2)) return null;
  const c = v => Math.max(0, Math.min(1, v));
  const x = c((r.x - r.mx) / r.mw), y = c((r.y - r.my) / r.mh);
  const w = c(Math.min(r.w / r.mw, 1 - x)), h = c(Math.min(r.h / r.mh, 1 - y));
  if ((w > 0.97 && h > 0.97) || w < 0.15 || h < 0.15) return null;
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}
/* história okna v popredí (prepnutia hier, alt-tab na plochu); hlási ju fxkeys pri každej zmene */
let fgLog = [];
function onForeground(r) {
  const exe = String(r.exe || '').toLowerCase();
  if (!exe || exe === 'lookatthis.exe') return;
  const now = Date.now();
  fgLog.push({ t: now, exe, r });
  if (fgLog.length > 3000 || now - fgLog[0].t > 4 * 3600e3) fgLog = fgLog.filter(e => now - e.t < 3 * 3600e3).slice(-2000);
}
function isGameExe(exe) {
  const n = exe.replace(/\.exe$/i, ''), s = store.get();
  if ((s.exclude || []).some(x => String(x).toLowerCase() === exe)) return false;
  if ((s.games || []).some(x => String(x).toLowerCase() === exe)) return true;
  if (Games.KNOWN[n]) return true;
  return (installed.games || []).some(g => (g.exes || []).map(x => String(x).toLowerCase()).includes(n));
}
function exeName(exe) {
  const n = exe.replace(/\.exe$/i, '');
  const g = (installed.games || []).find(x => (x.exes || []).map(y => String(y).toLowerCase()).includes(n));
  if (g) return g.name;
  if (n === 'explorer') return 'Plocha';
  return Games.pretty(n, store.get().gameNames);
}
/* čo bolo v popredí počas [from, to] (ms): prepnutia pre editor + okno hry, ktoré tam bolo najdlhšie (na výrez) */
function fgDuring(from, to) {
  const ev = [];
  let start = null;
  for (const e of fgLog) { if (e.t <= from) start = e; else if (e.t <= to) ev.push(e); }
  const all = start ? [{ ...start, t: from }, ...ev] : ev;
  const list = [], dur = new Map();
  all.forEach((e, i) => {
    const end = i + 1 < all.length ? all[i + 1].t : to;
    const game = isGameExe(e.exe), rg = game ? regionFrom(e.r) : null;
    if (game) { const k = JSON.stringify(rg); dur.set(k, (dur.get(k) || 0) + (end - e.t)); }
    const last = list[list.length - 1];
    if (!last || last.exe !== e.exe) list.push({ t: +((e.t - from) / 1000).toFixed(2), exe: e.exe, kind: game ? 'game' : e.exe === 'explorer.exe' ? 'desktop' : 'app', name: exeName(e.exe) });
  });
  let best = null, bestD = 0;
  for (const [k, d] of dur) if (d > bestD) { bestD = d; best = JSON.parse(k); }
  return { list, win: best };
}
/* poloha okna v popredí (okno hry) vzhľadom na nahrávaný monitor: editor z nej vie vyrezať len hru */
function windowRegion() {
  return new Promise(resolve => {
    if (process.platform !== 'win32' || !fs.existsSync(FXKEYS)) return resolve(null);
    execFile(FXKEYS, ['--rect'], { windowsHide: true, timeout: 1500 }, (err, out) => {
      if (err) return resolve(null);
      try {
        const r = JSON.parse(String(out).trim());
        if (!r.w || !r.h || !r.mw || !r.mh || /^(lookatthis|explorer)\.exe$/i.test(r.exe || '')) return resolve(null);
        const mon = monitors().find(m => m.idx === (Number(store.get().monitor) || 0));
        if (mon && (Math.abs(mon.w - r.mw) > 2 || Math.abs(mon.h - r.mh) > 2)) return resolve(null); // okno je na inom monitore
        const c = v => Math.max(0, Math.min(1, v));
        const x = c((r.x - r.mx) / r.mw), y = c((r.y - r.my) / r.mh);
        const w = c(Math.min(r.w / r.mw, 1 - x)), h = c(Math.min(r.h / r.mh, 1 - y));
        // celá obrazovka alebo maličké okno: nič na výrez
        if ((w > 0.97 && h > 0.97) || w < 0.15 || h < 0.15) return resolve(null);
        resolve({ x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4), exe: r.exe || '' });
      } catch (e) { resolve(null); }
    });
  });
}
async function saveClip(seconds) {
  try {
    const winP = windowRegion();
    const r = await engine.saveClip(store.get().clipsDir, seconds);
    const region = await winP;
    const end = Date.now(), mk = marksIn(end - r.seconds * 1000, end), fg = fgDuring(end - r.seconds * 1000, end);
    const win = fg.win || region;
    log.info(`clip: okno hry ${win ? JSON.stringify(win) : 'žiadne (celá obrazovka)'}, prepnutia ${fg.list.map(x => x.name).join(' → ') || '—'}`);
    store.setMeta(r.path, { game: r.game, duration: r.seconds, kind: 'clip', ...(win ? { win } : {}), ...(mk.length ? { marks: mk } : {}), ...(fg.list.length ? { fg: fg.list } : {}) });
    announce(r, 'Clip uložený');
  } catch (e) {
    log.warn('clip', e.message);
    toast('error', 'Clip sa neuložil', e.message);
    showOverlay({ kind: 'error', title: 'Clip sa neuložil', sub: e.message, ms: 3500 });
    send('event', { type: 'sound', name: 'error' }); playSound('error');
    if (store.get().notify && (!win || !win.isVisible())) notify('Clip sa neuložil', e.message);
  }
}
async function toggleRecord() {
  try {
    if (engine.recording) {
      const since = engine.recording.since;
      const r = await engine.stopRecording(store.get().clipsDir);
      if (r) { const to = since + r.seconds * 1000, mk = marksIn(since, to), fg = fgDuring(since, to); store.setMeta(r.path, { game: r.game, duration: r.seconds, kind: 'rec', ...(fg.win ? { win: fg.win } : {}), ...(mk.length ? { marks: mk } : {}), ...(fg.list.length ? { fg: fg.list } : {}) }); announce(r, 'Nahrávka uložená'); }
      if (!store.get().bufferEnabled) await engine.stop();
    } else {
      await engine.startRecording();
      send('event', { type: 'sound', name: 'rec' }); playSound('rec');
      showOverlay({ kind: 'rec', title: 'Nahrávam', sub: `Zastavíš cez ${store.get().hotkeys.record}`, ms: 2200 });
      if (wantNotify() && (!win || !win.isVisible())) notify('Nahrávam', `Zastavíš cez ${store.get().hotkeys.record}`);
    }
  } catch (e) { log.warn('nahrávanie', e.message); toast('error', 'Nahrávanie', e.message); }
  pushState();
}
/* ---------- overlay v rohu obrazovky (klapka po uložení clipu) ----------
   Priehľadné okno nad všetkým, myš ním prechádza. Vidno ho nad hrami v okne a v borderless režime;
   v exkluzívnom fullscreene (staré DirectX) ho Windows nad hru nepustí. */
let ov = null, ovReady = null, ovHide = null;
function ensureOverlay() {
  if (ov && !ov.isDestroyed()) return ovReady;
  ov = new BrowserWindow({
    width: 400, height: 120, show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  ov.setAlwaysOnTop(true, 'screen-saver');
  ov.setIgnoreMouseEvents(true);
  ov.setVisibleOnAllWorkspaces(true);
  ovReady = new Promise(res => ov.webContents.once('did-finish-load', res));
  ov.on('closed', () => { ov = null; ovReady = null; });
  ov.loadFile(path.join(ROOT, 'src', 'overlay', 'overlay.html'));
  ov.on('closed', () => { ov = null; });
  return ovReady;
}
let ovKill = null;
function killOverlaySoon() { clearTimeout(ovKill); ovKill = setTimeout(() => { if (ov && !ov.isDestroyed() && !ov.isVisible()) ov.destroy(); }, 15000); }
/* zvuk klipnutia hrá overlay okno (neviditeľne), takže funguje aj keď je hlavné okno zatvorené */
async function playSound(name) {
  const s = store.get();
  if (!s.sounds) return;
  try {
    await ensureOverlay();
    clearTimeout(ovKill);
    await ov.webContents.executeJavaScript(`sound(${JSON.stringify(name === 'saved' ? s.clipSound || 'beep' : name)}, ${Number(s.soundVolume ?? 0.6)})`);
    if (!ov.isVisible()) killOverlaySoon();
  } catch (e) { log.warn('zvuk', e.message); }
}
async function showOverlay(d) {
  const s = store.get();
  if (s.overlay === false && !d.test) return;
  try {
    await ensureOverlay();
    // monitor, ktorý sa nahráva (rovnaké poradie ako v Nastaveniach)
    const prim = screen.getPrimaryDisplay().id;
    const disp = screen.getAllDisplays().sort((a, b) => (b.id === prim) - (a.id === prim) || a.bounds.x - b.bounds.x)[Number(s.monitor) || 0] || screen.getPrimaryDisplay();
    const corner = s.overlayCorner || 'tr', W = 400, H = 120, M = 18, wa = disp.workArea, b = disp.bounds;
    const x = corner.endsWith('l') ? b.x + M : b.x + b.width - W - M;
    const y = corner.startsWith('t') ? b.y + M : wa.y + wa.height - H - M;
    ov.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
    ov.showInactive();
    ov.setAlwaysOnTop(true, 'screen-saver');
    await ov.webContents.executeJavaScript(`play(${JSON.stringify({ ...d, corner, accent: s.accent, style: s.overlayStyle || 'eye' })})`);
    clearTimeout(ovHide);
    ovHide = setTimeout(() => { if (ov && !ov.isDestroyed()) ov.hide(); killOverlaySoon(); }, (d.ms || 2700) + 500);
  } catch (e) { log.warn('overlay', e.message); }
}

/* upratovanie: keď knižnica prekročí limit, najstaršie klipy mimo priečinkov a mimo obľúbených idú do Koša */
let cleanT = null, cleaning = false;
function scheduleCleanup(ms = 5000) { clearTimeout(cleanT); cleanT = setTimeout(runCleanup, ms); }
async function runCleanup() {
  const gb = Number(store.get().cleanupGB) || 0;
  if (!gb || cleaning) return;
  cleaning = true;
  try {
    const all = listClips(), limit = gb * 1e9;
    let total = all.reduce((a, c) => a + c.size, 0);
    if (total <= limit) return;
    const cands = all.filter(c => !c.folder && !c.fav && Date.now() - c.mtime > 10 * 60e3).sort((a, b) => a.mtime - b.mtime);
    const gone = [];
    for (const c of cands) {
      if (total <= limit) break;
      try { await shell.trashItem(c.path); store.setMeta(c.path, null); total -= c.size; gone.push(c); } catch (e) { log.warn('upratovanie', c.path, e.message); }
    }
    if (gone.length) {
      const freed = gone.reduce((a, c) => a + c.size, 0);
      log.info(`upratovanie: ${gone.length} klipov do Koša (${(freed / 1e9).toFixed(1)} GB)`);
      toast('info', 'Upratané', `${gone.length} ${gone.length === 1 ? 'starý klip išiel' : gone.length < 5 ? 'staré klipy išli' : 'starých klipov išlo'} do Koša (${(freed / 1e9).toFixed(1).replace('.', ',')} GB). Obľúbené a klipy v priečinkoch sa nemažú.`);
      pushState();
    }
  } finally { cleaning = false; }
}
/* zmeny v priečinku s klipmi (kopírovanie v Prieskumníkovi, mazanie…) */
let watcher = null, watchDir = '', watchT = null;
function watchClips() {
  const dir = store.get().clipsDir;
  if (dir === watchDir && watcher) return;
  try { watcher && watcher.close(); } catch (e) { }
  watcher = null; watchDir = dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, { recursive: true }, (ev, f) => {
      if (f && !/\.(mp4|mkv|mov)$/i.test(f) && path.extname(f)) return;
      clearTimeout(watchT); watchT = setTimeout(() => { invalidateClips(); pushState(); }, 1200);
    });
    watcher.on('error', () => { });
  } catch (e) { log.warn('sledovanie priečinka', e.message); }
}
function announce(r, title) {
  scheduleCleanup();
  const body = `${path.basename(r.path)}`;
  send('event', { type: 'sound', name: 'saved' }); playSound('saved');
  const g = r.game ? Games.pretty(r.game, store.get().gameNames, engine.detectedMap) : '';
  showOverlay({ kind: title.startsWith('Nahrávka') ? 'recStop' : 'clip', title, game: g, sub: r.seconds ? (r.seconds >= 60 ? `${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}` : `${r.seconds} s`) : '' });
  toast('ok', title, body, { path: r.path });
  if (wantNotify() && (!win || !win.isVisible() || !win.isFocused())) notify(title, body, () => showWindow(() => send('event', { type: 'open', path: r.path })));
  pushState();
}
/* oznámenie o uložení len keď nie je overlay (ten to už ukázal); chyby sa oznamujú vždy */
const wantNotify = () => { const s = store.get(); return s.notify && s.overlay === false; };
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}

function applySettings(before, now) {
  if (JSON.stringify(before.hotkeys) !== JSON.stringify(now.hotkeys) || before.hotkeysAdmin !== now.hotkeysAdmin) { adminAsked = false; registerHotkeys(); }
  if (before.launchAtLogin !== now.launchAtLogin) setLogin(now.launchAtLogin);
  if (before.cleanupGB !== now.cleanupGB) scheduleCleanup(1500);
  engine.settings = now;
  if (before.bufferEnabled !== now.bufferEnabled) {
    if (now.bufferEnabled) engine.start(now); else if (!engine.recording) engine.stop();
  } else if (CAPTURE_KEYS.some(k => JSON.stringify(before[k]) !== JSON.stringify(now[k]))) {
    clearTimeout(restartT);
    restartT = setTimeout(async () => {
      const ok = await engine.restart(store.get());
      if (!ok) toast('info', 'Zmena sa prejaví po nahrávaní', 'Počas nahrávania nič nereštartujem.');
    }, 700);
  }
  if (before.appearance !== now.appearance) nativeTheme.themeSource = now.appearance === 'auto' ? 'system' : now.appearance;
}

async function runAction(type, p = {}) {
  // akcie menia súbory alebo metadáta → zoznam klipov načítaj nanovo (lacné, deje sa len na klik)
  if (!['extractTracks', 'calibrateMic', 'updateCheck', 'libraryInfo', 'refreshDevices', 'testOverlay'].includes(type)) invalidateClips();
  const s = store.get();
  switch (type) {
    case 'saveClip': saveClip(); return true;
    case 'toggleRecord': await toggleRecord(); return true;
    case 'setBuffer': { const before = { ...s }; const now = store.set({ bufferEnabled: !!p.on }); applySettings(before, now); pushState(); return true; }
    case 'restartEngine': engine.retry = 0; engine.error = ''; await engine.restart(store.get()); if (!engine.wanted) engine.start(store.get()); return true;
    case 'closeRecorder': {
      const r = RECORDERS.find(x => x.id === p.id); if (!r || r.soft) return false;
      // bez /F: program dostane normálnu žiadosť o zatvorenie (napr. OBS sa môže opýtať, či naozaj)
      await new Promise(res => execFile('taskkill.exe', r.exes.flatMap(e => ['/IM', e]), { windowsHide: true, timeout: 8000 }, () => res()));
      setTimeout(detectRecorders, 2500); setTimeout(detectRecorders, 7000);
      return true;
    }
    case 'ignoreRecorder': {
      const ign = new Set(store.get().ignoreRecorders || []); ign.add(String(p.id));
      store.set({ ignoreRecorders: [...ign] });
      otherRecorders = otherRecorders.filter(r => r.id !== p.id); pushState();
      return true;
    }
    case 'detectBars': { if (!p || !p.path || !fs.existsSync(p.path)) return null; return detectBars(FFMPEG, p.path); }
    case 'gameBarSettings': shell.openExternal('ms-settings:gaming-gamedvr'); setTimeout(detectRecorders, 20000); return true;
    case 'saveSettings': { const before = JSON.parse(JSON.stringify(s)); const now = store.set(p); applySettings(before, now); pushState(); return now; }
    case 'resetExclude': { const before = JSON.parse(JSON.stringify(s)); const now = store.set({ exclude: store.DEFAULT_EXCLUDE.slice() }); applySettings(before, now); pushState(); return now; }
    case 'refreshDevices': { const r = await refreshDevices(); pushState(); return r; }
    case 'detectEncoders': { const r = await engine.detectEncoders(); pushState(); return r; }
    case 'pickFolder': {
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: s.clipsDir });
      if (r.canceled || !r.filePaths[0]) return null;
      store.set({ clipsDir: r.filePaths[0] }); pushState(); return r.filePaths[0];
    }
    case 'openFolder': { const d = folderDir(p.folder); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); return true; }
    case 'createFolder': {
      const d = folderDir(p.name);
      if (fs.existsSync(d)) throw new Error('Priečinok s týmto názvom už existuje');
      fs.mkdirSync(d, { recursive: true }); pushState(); return path.basename(d);
    }
    case 'renameFolder': {
      const a = folderDir(p.from), b = folderDir(p.to);
      if (a === b) return path.basename(b);
      if (fs.existsSync(b)) throw new Error('Priečinok s týmto názvom už existuje');
      const vids = fs.readdirSync(a).filter(f => VIDEO.test(f)).map(f => [path.join(a, f), path.join(b, f), fs.statSync(path.join(a, f)).mtimeMs]);
      fs.renameSync(a, b);
      for (const [x, y, mt] of vids) { const m = store.meta()[x]; store.setMeta(x, null); if (m) store.setMeta(y, m); try { fs.renameSync(thumbFile(x, mt), thumbFile(y, mt)); } catch (e) { } }
      pushState(); return path.basename(b);
    }
    case 'deleteFolder': {
      // klipy sa vrátia do hlavného priečinka, nič sa nemaže
      const d = folderDir(p.name), root = folderDir('');
      let n = 0;
      for (const f of fs.readdirSync(d)) if (VIDEO.test(f)) { moveClipFile(path.join(d, f), root); n++; }
      let removed = false;
      try { fs.rmdirSync(d); removed = true; } catch (e) { }
      pushState(); return { moved: n, removed };
    }
    case 'calibrateMic': {
      // počkaj, kým sa posledné tlesknutia zapíšu do segmentov, potom porovnaj tiky (Systém) a tlesknutia (Mikrofón)
      await new Promise(r => setTimeout(r, 2200));
      const o = { interval: Number(p.interval) || 600, count: Number(p.count) || 8, clapFrom: Number(p.clapFrom) || 4, tickHz: Number(p.tickHz) || 1600 };
      const [sys, mic] = await engine.grabTracks(o.interval * o.count / 1000 + 4, ['system', 'mic']);
      const r = Calib.analyze(sys, mic, 48000, o);
      // nahrávka na kontrolu: vľavo Systém (údery), vpravo Mikrofón (tlesknutia)
      try {
        const n = Math.min(sys.length, mic.length), buf = Buffer.alloc(44 + n * 4);
        buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
        buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(48000 * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
        for (let i = 0; i < n; i++) { buf.writeInt16LE(sys[i], 44 + i * 4); buf.writeInt16LE(mic[i], 46 + i * 4); }
        r.wav = path.join(USER, 'synchronizacia-posledna.wav'); fs.writeFileSync(r.wav, buf);
      } catch (e) { }
      log.info('synchronizácia mikrofónu', JSON.stringify({ ok: r.ok, offset: r.offset, spread: r.spread, offsets: r.offsets, reason: r.reason, micDb: r.micDb, claps: r.claps && r.claps.length }));
      return r;
    }
    case 'updateCheck': return U.check();
    case 'updateInstall': return U.install(() => { quitting = true; });
    case 'importClips': {
      // pretiahnuté videá z Prieskumníka: skopírujú sa do knižnice (originál ostane)
      const to = folderDir(p.folder || '');
      fs.mkdirSync(to, { recursive: true });
      const done = [], failed = [];
      for (const f of p.paths || []) {
        if (!VIDEO.test(f) || !fs.existsSync(f)) { failed.push(path.basename(f)); continue; }
        if (path.dirname(path.resolve(f)) === path.resolve(to)) continue;
        try { const out = uniquePath(to, path.basename(f)); await fs.promises.copyFile(f, out); const st = fs.statSync(f); fs.utimesSync(out, st.atime, st.mtime); done.push(out); }
        catch (e) { failed.push(path.basename(f)); log.warn('import', f, e.message); }
      }
      pushState(); return { imported: done, failed };
    }
    case 'libraryInfo': return { bytes: listClips().reduce((a, c) => a + c.size, 0) };
    case 'moveClips': {
      const to = folderDir(p.folder || '');
      const out = [], failed = [];
      for (const f of p.paths || []) { try { out.push(moveClipFile(f, to)); } catch (e) { failed.push(path.basename(f)); log.warn('presun', f, e.message); } }
      pushState(); return { moved: out, failed };
    }
    case 'openLog': shell.openPath(LOGF); return true;
    case 'reveal': shell.showItemInFolder(p.path); return true;
    case 'openExternal': shell.openPath(p.path); return true;
    case 'trash': await shell.trashItem(p.path); store.setMeta(p.path, null); pushState(); return true;
    case 'deleteClip': {
      // natrvalo (fs.unlink) alebo do Koša vo Windowse
      if (p.permanent) fs.unlinkSync(p.path); else await shell.trashItem(p.path);
      store.setMeta(p.path, null); pushState(); return true;
    }
    case 'extractTracks': {
      const st = fs.statSync(p.path);
      const dir = path.join(EDIT, crypto.createHash('sha1').update(p.path + '|' + st.mtimeMs).digest('hex').slice(0, 16));
      return extractTracks(FFMPEG, p.path, dir);
    }
    case 'compress': {
      const info = await probe(FFMPEG, p.path);
      const targetMB = Math.max(1, Math.min(2000, Number(p.targetMB) || 20));
      const plan = Compress.plan({ duration: info.duration, width: info.width, height: info.height, fps: info.fps, targetMB, audio: p.audio !== false });
      if (!plan.ok) throw new Error(`Klip je na ${targetMB} MB pridlhý. Zmestí sa najviac ${Math.floor(plan.maxSeconds / 60)} min ${plan.maxSeconds % 60} s, skús ho najprv orezať.`);
      const base = p.path.replace(/\.[^.]+$/, '').replace(/ \(\d+ MB\)$/, '');
      let out = `${base} (${targetMB} MB).mp4`, k = 2;
      while (fs.existsSync(out)) out = `${base} (${targetMB} MB ${k++}).mp4`;
      const tmpDir = path.join(EDIT, 'pass-' + Date.now());
      let r;
      try {
        r = await compressClip(FFMPEG, { file: p.path, out, targetMB, plan, tmpDir }, engine.pickEncoder(store.get()), f => send('event', { type: 'compressProgress', value: f, path: p.path }));
      } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { } }
      const m = store.meta()[p.path] || {};
      store.setMeta(out, { game: m.game, duration: info.duration, kind: 'small' });
      if (p.copy && !r.over) await copyFileToClipboard(out);
      pushState();
      return { out, size: r.size, over: !!r.over, plan, copied: !!(p.copy && !r.over) };
    }
    case 'scanGames': return scanGames();
    case 'testOverlay': showOverlay({ kind: 'clip', title: 'Clip uložený', game: 'Ukážka', sub: '1:00', test: true }); return true;
    case 'copyFile': await copyFileToClipboard(p.path); return true;
    case 'setClipMeta': {
      // obľúbené a ručne priradená hra (game: '' = bez hry, null = podľa názvu súboru)
      const allowed = {};
      if ('fav' in p.patch) allowed.fav = !!p.patch.fav;
      if ('game' in p.patch) allowed.game = p.patch.game == null ? null : String(p.patch.game).trim().slice(0, 60) || '-'; // '-' = výslovne bez hry
      for (const f of p.paths || []) store.setMeta(f, allowed);
      pushState(); return true;
    }
    case 'deleteClips': {
      const failed = [];
      for (const f of p.paths || []) {
        try { if (p.permanent) fs.unlinkSync(f); else await shell.trashItem(f); store.setMeta(f, null); }
        catch (e) { failed.push(path.basename(f)); log.warn('mazanie', f, e.message); }
      }
      pushState();
      if (failed.length) throw new Error(`Nepodarilo sa: ${failed.join(', ')}`);
      return true;
    }
    case 'exportSequence': {
      const first = p.segments[0].file;
      const multi = new Set(p.segments.map(x => x.file)).size > 1;
      const inLib = path.dirname(first).startsWith(store.get().clipsDir);
      const base = path.join(inLib ? path.dirname(first) : store.get().clipsDir, path.basename(first).replace(/\.[^.]+$/, ''));
      const tag = multi ? 'strih' : 'upravené';
      let out = `${base} (${tag}).mp4`, k = 2;
      while (fs.existsSync(out)) out = `${base} (${tag} ${k++}).mp4`;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmp = path.join(EDIT, 'ov-' + Date.now());
      fs.mkdirSync(tmp, { recursive: true });
      const overlays = (p.overlays || []).map((o, i) => {
        const f = path.join(tmp, `o${i}.png`);
        fs.writeFileSync(f, Buffer.from(String(o.png).replace(/^data:image\/png;base64,/, ''), 'base64'));
        // poloha a animácie musia ísť ďalej (inak by sa orezaný obrázok vložil do ľavého horného rohu)
        return { png: f, start: Number(o.start), end: Number(o.end), cx: o.cx == null ? null : Number(o.cx), cy: o.cy == null ? null : Number(o.cy), animIn: o.animIn || 'none', animOut: o.animOut || 'none' };
      });
      const target = Number(p.targetMB) || 0;
      if (target) { const b0 = out.replace(/\)\.mp4$/, ` ${target} MB).mp4`); out = b0; let kk = 2; while (fs.existsSync(out)) out = b0.replace(/\)\.mp4$/, ` ${kk++}).mp4`); }
      try {
        const prog = f => send('event', { type: 'exportProgress', value: target ? f * 0.55 : f });
        if (!target) await exportSequence(FFMPEG, { ...p, out, overlays }, engine.pickEncoder(store.get()), prog);
        else {
          // najprv strih vo vysokej kvalite do dočasného súboru, potom zmenšenie na cieľovú veľkosť
          const mid = path.join(tmp, 'strih.mp4');
          await exportSequence(FFMPEG, { ...p, out: mid, overlays }, engine.pickEncoder(store.get()), prog);
          const info = await probe(FFMPEG, mid);
          const plan = Compress.plan({ duration: info.duration, width: info.width, height: info.height, fps: info.fps, targetMB: target });
          if (!plan.ok) throw new Error(`Strih je na ${target} MB pridlhý (max ${Math.floor(plan.maxSeconds / 60)} min ${plan.maxSeconds % 60} s). Ulož ho v pôvodnej kvalite alebo skráť.`);
          await compressClip(FFMPEG, { file: mid, out, targetMB: target, plan, tmpDir: path.join(tmp, 'pass') }, engine.pickEncoder(store.get()), f => send('event', { type: 'exportProgress', value: 0.55 + f * 0.45 }));
        }
      } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { } }
      const m = store.meta()[first] || {};
      store.setMeta(out, { game: m.game, duration: p.segments.reduce((a, x) => a + (x.out - x.in) / (Number(x.speed) || 1), 0), kind: multi ? 'cut' : 'edit' });
      pushState(); return out;
    }
    case 'rename': {
      const name = String(p.name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
      if (!name) throw new Error('Prázdny názov');
      const to = path.join(path.dirname(p.path), name + path.extname(p.path));
      if (to !== p.path && fs.existsSync(to)) throw new Error('Súbor s týmto názvom už existuje');
      fs.renameSync(p.path, to);
      const m = store.meta()[p.path]; store.setMeta(p.path, null); if (m) store.setMeta(to, m);
      pushState(); return to;
    }
    case 'trim': {
      const base = p.path.replace(/\.[^.]+$/, '');
      let out = `${base} (orez).mp4`, k = 2;
      while (fs.existsSync(out)) out = `${base} (orez ${k++}).mp4`;
      await trim(FFMPEG, p.path, Number(p.a), Number(p.b), out, engine.pickEncoder(store.get()));
      const m = store.meta()[p.path] || {};
      store.setMeta(out, { game: m.game, duration: Number(p.b) - Number(p.a), kind: 'trim' });
      if (p.replace) { await shell.trashItem(p.path); store.setMeta(p.path, null); fs.renameSync(out, p.path); store.setMeta(p.path, store.meta()[out]); store.setMeta(out, null); out = p.path; }
      pushState(); return out;
    }
    case 'probe': return probe(FFMPEG, p.path);
    case 'win': {
      if (p.do === 'min') win.minimize();
      else if (p.do === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (p.do === 'close') win.close();
      return true;
    }
    case 'quit': quitting = true; app.quit(); return true;
    default: throw new Error('Neznáma akcia: ' + type);
  }
}

/* súbor do schránky ako „skopírovaný súbor“ (rovnako ako Ctrl+C v Prieskumníkovi) → v Discorde stačí Ctrl+V */
function copyFileToClipboard(file) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Len vo Windowse'));
    const cmd = `Set-Clipboard -LiteralPath '${String(file).replace(/'/g, "''")}'`;
    const enc = Buffer.from(cmd, 'utf16le').toString('base64');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', enc], { windowsHide: true });
    let err = '';
    ps.stderr.on('data', d => { err += d; });
    ps.on('error', e => reject(e));
    ps.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim() || 'Kopírovanie zlyhalo'))));
  });
}

/* ---------- skratky ---------- */
const VK_NAMES = { space: 32, enter: 13, return: 13, tab: 9, escape: 27, esc: 27, backspace: 8, delete: 46, insert: 45, home: 36, end: 35, pageup: 33, pagedown: 34, up: 38, down: 40, left: 37, right: 39, plus: 187, ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192, '[': 219, '\\': 220, ']': 221, "'": 222, numadd: 107, numsub: 109, nummult: 106, numdiv: 111, numdec: 110 };
function accelToVk(acc) {
  let mask = 0, vk = 0;
  for (const raw of String(acc).split('+')) {
    const k = raw.trim().toLowerCase();
    if (!k) continue;
    if (['ctrl', 'control', 'commandorcontrol', 'cmdorctrl', 'command', 'cmd'].includes(k)) mask |= 1;
    else if (['alt', 'option', 'altgr'].includes(k)) mask |= 2;
    else if (k === 'shift') mask |= 4;
    else if (['super', 'meta', 'win'].includes(k)) mask |= 8;
    else if (/^f([1-9]|1\d|2[0-4])$/.test(k)) vk = 111 + Number(k.slice(1));
    else if (/^[a-z]$/.test(k)) vk = k.toUpperCase().charCodeAt(0);
    else if (/^[0-9]$/.test(k)) vk = k.charCodeAt(0);
    else if (/^num[0-9]$/.test(k)) vk = 96 + Number(k[3]);
    else if (VK_NAMES[k]) vk = VK_NAMES[k];
  }
  return vk ? { mask, vk } : null;
}

/* skratky: hlavne si ich sleduje fxkeys.exe (funguje aj nad hrou bežiacou ako správca),
   globalShortcut ostáva ako záloha; spoločný zámok zabráni dvojitému spusteniu */
let keysProc = null, lastFire = {};
/* značky: časy (ms), keď si stlačil skratku značky; pri uložení klipu/nahrávky sa prepočítajú na čas vo videu */
let marks = [];
function addMark() {
  const now = Date.now();
  marks = marks.filter(t => now - t < 3 * 3600e3 || (engine.recording && t >= engine.recording.since));
  marks.push(now);
  playSound('tick');
  showOverlay({ kind: 'mark', title: 'Značka', sub: engine.recording ? 'v nahrávke ' + fmtSecs((now - engine.recording.since) / 1000) : 'nájdeš ju v editore', ms: 1100 });
}
function fmtSecs(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function marksIn(from, to) { return marks.filter(t => t >= from && t <= to).map(t => +((t - from) / 1000).toFixed(2)); }
function fireHotkey(id) {
  const now = Date.now();
  if (now - (lastFire[id] || 0) < 700) return;
  lastFire[id] = now;
  log.info('skratka ' + id);
  if (id === 'clip') saveClip();
  else if (id === 'record') toggleRecord();
  else if (id === 'short') saveClip(store.get().shortSeconds || 15);
  else if (id === 'mark') addMark();
}
/* skratky so zvýšenými právami: hry s anti-cheatom (LoL/Vanguard, Valorant…) bežia ako správca a Windows
   bežnej appke ich klávesy nepustí. fxkeys sa vtedy spustí ako správca (raz sa opýta UAC) a hlási cez rúru. */
const KEYS_PIPE = `\\\\.\\pipe\\lookatthis-keys-${process.pid}`;
let adminSrv = null, adminSock = null, adminCfg = '', adminAsked = false;
function syncAdminKeys(args) {
  adminCfg = 'cfg ' + args.join(' ') + '\n';
  const want = process.platform === 'win32' && store.get().hotkeysAdmin && args.length && fs.existsSync(FXKEYS);
  if (!want) { stopAdminKeys(); return; }
  if (adminSock) { try { adminSock.write(adminCfg); } catch (e) { } return; }
  if (adminSrv) return; // čaká sa na pripojenie
  adminSrv = net.createServer(sock => {
    if (adminSock) { sock.destroy(); return; }
    adminSock = sock;
    sock.setEncoding('utf8');
    sock.write(adminCfg);
    let buf = '';
    sock.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!l || l === '.') continue;
        if (l.startsWith('ready')) { log.info('fxkeys (správca) ' + l); continue; }
        fireHotkey(l);
      }
    });
    const gone = () => { if (adminSock === sock) adminSock = null; };
    sock.on('close', gone); sock.on('error', gone);
  });
  adminSrv.on('error', e => log.warn('fxkeys rúra', e.message));
  adminSrv.listen(KEYS_PIPE, () => {
    const q = x => "'" + String(x).replace(/'/g, "''") + "'";
    const cmd = `Start-Process -FilePath ${q(FXKEYS)} -ArgumentList ${q('--pipe')},${q(KEYS_PIPE)} -Verb RunAs -WindowStyle Hidden`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
    let err = '';
    ps.stderr.on('data', d => { err += d; });
    ps.on('close', code => {
      if (code !== 0) {
        log.warn('fxkeys správca odmietnutý', err.trim().slice(0, 200));
        if (!adminAsked) toast('warn', 'Skratky bez práv správcu', 'Bez povolenia nemusia skratky fungovať v hrách s anti-cheatom (LoL, Valorant). Skús znova v Nastaveniach.');
        stopAdminKeys();
      }
      adminAsked = true;
    });
  });
}
function stopAdminKeys() {
  if (adminSock) { try { adminSock.end('quit\n'); } catch (e) { } adminSock = null; }
  if (adminSrv) { try { adminSrv.close(); } catch (e) { } adminSrv = null; }
}
function stopKeys() { if (keysProc) { try { keysProc.stdin.end(); keysProc.kill(); } catch (e) { } keysProc = null; } }
function registerHotkeys() {
  globalShortcut.unregisterAll();
  stopKeys();
  hotkeyErrors = [];
  const hk = store.get().hotkeys;
  const args = [];
  for (const id of ['clip', 'record', 'short', 'mark']) {
    const key = hk[id];
    if (!key) continue;
    try { if (!globalShortcut.register(key, () => fireHotkey(id))) hotkeyErrors.push(id); } catch (e) { hotkeyErrors.push(id); }
    const v = accelToVk(key);
    if (v) args.push(`${id}:${v.mask}:${v.vk}`);
  }
  syncAdminKeys(args);
  if (process.platform === 'win32' && fs.existsSync(FXKEYS)) {
    try {
      const p = spawn(FXKEYS, ['--fg', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      keysProc = p;
      let buf = '';
      p.stdout.on('data', d => {
        buf += d; let i;
        while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l || l.startsWith('ready')) continue; if (l.startsWith('fg ')) { try { onForeground(JSON.parse(l.slice(3))); } catch (e) { } continue; } fireHotkey(l); }
      });
      p.on('error', e => log.warn('fxkeys', e.message));
      p.on('exit', () => { if (keysProc === p) keysProc = null; });
    } catch (e) { log.warn('fxkeys', e.message); }
  }
  // ak sa skratku nepodarilo zaregistrovať cez Windows, ale sleduje ju fxkeys, nie je to chyba
  if (keysProc) hotkeyErrors = [];
  if (hotkeyErrors.length) log.warn('skratky obsadené', hotkeyErrors);
}

/* premenovanie ClipIt → LookAtThis: prenes nastavenia, zoznam klipov, hry a náhľady zo starého priečinka */
function migrateFromClipIt() {
  const old = path.join(app.getPath('appData'), 'ClipIt');
  if (!fs.existsSync(old) || fs.existsSync(path.join(USER, 'settings.json'))) return false;
  try {
    fs.mkdirSync(USER, { recursive: true });
    for (const n of ['settings.json', 'clips.json', 'games.json', 'thumbs', 'gameicons']) {
      const src = path.join(old, n);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(USER, n), { recursive: true });
    }
    // cesty k ikonkám hier ukazujú do starého priečinka
    const gf = path.join(USER, 'games.json');
    if (fs.existsSync(gf)) fs.writeFileSync(gf, fs.readFileSync(gf, 'utf8').split(JSON.stringify(old).slice(1, -1)).join(JSON.stringify(USER).slice(1, -1)));
    log.info('nastavenia prenesené z ClipIt');
    return true;
  } catch (e) { log.warn('prenos z ClipIt', e.message); return false; }
}
/* starý záznam „ClipIt“ v štarte Windowsu by spúšťal druhú appku → zruš ho */
function removeOldLogin() {
  try {
    const base = app.isPackaged ? {} : { path: process.execPath, args: [ROOT, '--hidden'] };
    app.setLoginItemSettings({ ...base, openAtLogin: false, name: 'sk.shapefx.clipit' });
    app.setLoginItemSettings({ ...base, openAtLogin: false, name: 'ClipIt' });
  } catch (e) { }
}

function setLogin(on) {
  try {
    // keď je nainštalovaná verzia, štart s Windowsom patrí jej; Spustit.bat ho neprepisuje
    if (!app.isPackaged) {
      const items = (app.getLoginItemSettings().launchItems || []);
      if (items.some(i => /LookAtThis\.exe$/i.test(i.path || ''))) return;
    }
    const opts = app.isPackaged
      ? { openAtLogin: !!on, args: ['--hidden'] }
      : { openAtLogin: !!on, path: process.execPath, args: [ROOT, '--hidden'] };
    app.setLoginItemSettings(opts);
  } catch (e) { log.warn('štart s Windowsom', e.message); }
}

/* ---------- okno a lišta ---------- */
function bg() {
  const a = store.get().appearance;
  const dark = a === 'dark' || (a !== 'light' && nativeTheme.shouldUseDarkColors);
  return dark ? '#252527' : '#ebebed';
}
function createWindow(show) {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600,
    backgroundColor: bg(), title: 'LookAtThis', icon: ICON, show, frame: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true }
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  const maxState = () => send('event', { type: 'maximized', value: win.isMaximized() });
  win.on('maximize', maxState); win.on('unmaximize', maxState);
  win.on('show', () => { pushState(); refreshDevices().then(pushState); });
  win.on('focus', () => { if (otherRecorders.length) detectRecorders(); });
  win.on('close', e => {
    if (quitting) return;
    if (!store.get().closeToTray) { quitting = true; return; }
    e.preventDefault(); win.hide();
    // skryté okno o minútu úplne zavri: na pozadí ostane len malý hlavný proces (ušetrí ~100 MB RAM)
    clearTimeout(winKill);
    const kill = () => {
      if (!win || win.isDestroyed() || win.isVisible()) return;
      // otvorený editor (neuložený strih) nezahadzuj, skús neskôr
      win.webContents.executeJavaScript("typeof Player !== 'undefined' && Player.busy ? Player.busy() : false")
        .then(busy => { if (busy) winKill = setTimeout(kill, 60000); else if (win && !win.isDestroyed() && !win.isVisible()) { win.destroy(); win = null; } })
        .catch(() => { });
    };
    winKill = setTimeout(kill, 60000);
  });
  win.on('closed', () => { win = null; });
}
let winKill = null;
/* after() sa zavolá, keď je okno pripravené (pri novom okne až po načítaní) */
function showWindow(after) {
  clearTimeout(winKill);
  const fresh = !win || win.isDestroyed();
  if (fresh) createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  // z lišty/menu príde ako argument udalosť, nie funkcia → tú ignoruj
  if (typeof after === 'function') { if (fresh) win.webContents.once('did-finish-load', () => setTimeout(after, 250)); else after(); }
}
function refreshTray() {
  if (!tray) return;
  const s = store.get(), st = engine.status();
  const rec = !!st.recording;
  try { tray.setImage(nativeImage.createFromPath(rec ? TRAY_REC : TRAY)); } catch (e) { }
  const what = rec ? 'nahrávam' : st.state === 'on' ? `buffer ${s.bufferSeconds} s` : st.state === 'starting' ? 'štartujem' : st.state === 'error' ? 'chyba' : 'vypnuté';
  tray.setToolTip(`LookAtThis · ${what}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Otvoriť LookAtThis', click: () => showWindow() },
    { type: 'separator' },
    { label: `Uložiť clip (${s.hotkeys.clip})`, enabled: st.state === 'on', click: () => saveClip() },
    { label: rec ? `Zastaviť nahrávanie (${s.hotkeys.record})` : `Nahrávať (${s.hotkeys.record})`, click: toggleRecord },
    { label: 'Replay buffer', type: 'checkbox', checked: s.bufferEnabled, click: m => runAction('setBuffer', { on: m.checked }) },
    { type: 'separator' },
    { label: 'Otvoriť priečinok s clipmi', click: () => runAction('openFolder') },
    { type: 'separator' },
    ...(U.status().status === 'ready' ? [{ label: `Reštartovať a aktualizovať na ${U.status().version}`, click: () => U.install(() => { quitting = true; }) }, { type: 'separator' }] : []),
    { label: 'Ukončiť', click: () => { quitting = true; app.quit(); } }
  ]));
}

/* ---------- štart ---------- */
app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  const migrated = migrateFromClipIt();
  store = Store.create(USER, app.getPath('videos'));
  { const sm = store.setMeta.bind(store); store.setMeta = (a, b) => { invalidateClips(); return sm(a, b); }; }
  if (migrated || !store.get().oldLoginRemoved) { removeOldLogin(); store.set({ oldLoginRemoved: true }); }
  // nový predvolený zvuk klipnutia: kto mal pôvodnú klapku, dostane raz pípnutie (v Nastaveniach si ho vie zmeniť späť)
  if (!store.get().beepDefault) store.set({ beepDefault: true, ...(store.get().clipSound === 'clap' ? { clipSound: 'beep' } : {}) });
  const s = store.get();
  nativeTheme.themeSource = s.appearance === 'auto' ? 'system' : s.appearance;
  engine = new Engine({ ffmpeg: FFMPEG, fxaudio: FXAUDIO, tmpRoot: TMP, log });
  // skutočné rozlíšenie monitora v pixeloch (enkodéry majú strop šírky, napr. H.264 do 4096 px)
  engine.monitorPx = idx => { try { return monitors().find(m => m.idx === (Number(idx) || 0)) || null; } catch (e) { return null; } };
  applyInstalled();
  wrapDetect();
  loadEncCache();
  updateWeak();
  readSystem().then(pushState);
  fs.mkdirSync(TMP, { recursive: true });
  engine.removeOld();
  try { fs.rmSync(EDIT, { recursive: true, force: true }); } catch (e) { }
  engine.on('state', () => pushState());
  engine.on('track', t => {
    const cur = store.get();
    const tr = cur.tracks.find(x => x.id === t.id);
    if (!tr) return;
    // Sonar prehodil zariadenia: našli sme ho podľa mena → uložíme nové ID, nabudúce sedí hneď
    if (t.status === 'bound' && tr.kind === 'device' && t.deviceId && t.how === 'name' && t.deviceId !== tr.deviceId) {
      log.info(`stopa ${t.id}: nové ID pre ${t.name}`);
      store.set({ tracks: cur.tracks.map(x => x.id === t.id ? { ...x, deviceId: t.deviceId } : x) });
      toast('info', `${tr.name}: zariadenie sa zmenilo`, `Našiel som „${t.name}“ podľa mena a zapamätal si ho.`);
    }
    if (t.status === 'bound' && tr.kind === 'device' && t.how === 'default' && (tr.deviceId || tr.deviceName)) {
      toast('warn', `${tr.name}: zvolené zariadenie chýba`, `Používam predvolené („${t.name}“), kým sa „${tr.deviceName || '?'}“ nevráti.`);
    }
    pushState();
  });
  engine.on('state', st => { if (st.state === 'error') { toast('error', 'Buffer spadol', st.error); notify('LookAtThis: buffer spadol', st.error); } });

  if (!HIDDEN || !s.onboarded) createWindow(true);
  tray = new Tray(nativeImage.createFromPath(TRAY));
  tray.on('click', () => showWindow());
  refreshTray();
  registerHotkeys();
  U.init({
    log, getSettings: () => store.get(),
    send: st => { send('event', { type: 'update', status: st }); refreshTray(); },
    notify: v => {
      toast('ok', `Nová verzia ${v} je pripravená`, 'Nainštaluje sa, keď appku ukončíš. Alebo ju reštartuj hneď v Nastavenia → O appke.');
      if (!win || !win.isVisible()) notify(`LookAtThis ${v} je pripravená`, 'Nainštaluje sa, keď appku ukončíš. Klikni a reštartuj ju hneď.', () => U.install(() => { quitting = true; }));
    }
  });
  scheduleCleanup(90e3); setInterval(() => scheduleCleanup(0), 3600e3);
  setTimeout(detectRecorders, HIDDEN ? 45000 : 6000);
  // bez upozornenia stačí raz za 5 min; keď svieti, kontroluj každých 10 s, nech zmizne hneď po zatvorení programu
  let recTick = 0; setInterval(() => { recTick++; if (otherRecorders.length || recTick % 30 === 0) detectRecorders(); }, 10000);
  setLogin(s.launchAtLogin);
  if (s.bufferEnabled) engine.start(s);
  refreshDevices().then(pushState);
  // hry hľadaj na pozadí: pri prvom štarte a potom raz za deň
  setTimeout(() => { if (!installed.at || Date.now() - installed.at > 864e5) scanGames(); }, HIDDEN ? 90000 : 8000);

  // úrovne zvuku do okna 10× za sekundu, keď je vidieť
  // keď okno nie je v popredí (hráš), stačí 2× za sekundu (časovač a stav buffra); merače naplno len pri pohľade na appku
  let lvTick = 0;
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
    if (!win.isFocused() && (++lvTick % 5)) return;
    const lv = {}; for (const [id, t] of Object.entries(engine.tracks)) lv[id] = t.level || 0;
    send('levels', { levels: lv, buffered: engine.bufferedSeconds(), recording: engine.recording ? Date.now() - engine.recording.since : 0 });
  }, 100);
});

ipcMain.handle('state', () => fullState());
ipcMain.handle('action', async (e, { type, payload }) => {
  try { return { ok: true, result: await runAction(type, payload) }; }
  catch (err) { log.warn('akcia ' + type, err.message); return { ok: false, error: err.message }; }
});
// ťahanie klipu z knižnice von (do Discordu, Prieskumníka, strihového programu)
let dragBusy = 0;
ipcMain.on('drag', (e, file) => {
  // natívne ťahanie súboru: nikdy nie dvakrát naraz (druhé spustenie počas prvého appku zhodí)
  if (Date.now() - dragBusy < 1500) return;
  try {
    const dir = path.resolve(store.get().clipsDir);
    if (!path.resolve(file).startsWith(dir) || !fs.existsSync(file)) return;
    dragBusy = Date.now();
    const st = fs.statSync(file), th = thumbFile(file, st.mtimeMs);
    let icon = fs.existsSync(th) ? nativeImage.createFromPath(th) : nativeImage.createFromPath(ICON);
    if (icon.isEmpty()) icon = nativeImage.createFromPath(ICON);
    if (!icon.isEmpty()) icon = icon.resize({ width: 120 });
    if (icon.isEmpty()) { log.warn('drag: chýba ikonka'); return; }
    e.sender.startDrag({ file, icon });
  } catch (err) { log.warn('drag', err.message); }
  finally { dragBusy = Date.now(); }
});
ipcMain.on('log', (e, { level, msg }) => log[level] ? log[level]('[okno] ' + msg) : null);

app.on('window-all-closed', e => { /* beží ďalej v lište */ });
app.on('before-quit', async e => {
  quitting = true;
  if (engine && (engine.proc || engine.helpers.length)) {
    e.preventDefault();
    try { if (engine.recording) await engine.stopRecording(store.get().clipsDir); } catch (err) { }
    await engine.stop();
    engine.removeOld();
    store.flush();
    app.exit(0);
  } else if (store) store.flush();
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopKeys(); stopAdminKeys(); });
