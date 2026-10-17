/* Nastavenia v jednom JSON súbore v AppData\Roaming\LookAtThis */
const fs = require('fs');
const path = require('path');

const DEFAULT_EXCLUDE = [
  'explorer.exe', 'electron.exe', 'LookAtThis.exe', 'ClipIt.exe', 'Discord.exe', 'SteelSeriesGG.exe', 'SteelSeriesSonar.exe', 'SteelSeriesEngine.exe',
  'obs64.exe', 'ShellExperienceHost.exe', 'StartMenuExperienceHost.exe', 'SearchHost.exe', 'Taskmgr.exe', 'LockApp.exe', 'Claude.exe'
];

function defaults(videosDir) {
  return {
    clipsDir: path.join(videosDir, 'LookAtThis'),
    bufferEnabled: true,
    bufferSeconds: 60,
    monitor: 0,
    fps: 60,
    resolution: 'native',
    quality: 'high',
    encoder: 'auto',
    codec: 'h264',
    cursor: true,
    tracks: [
      { id: 'system', on: true, name: 'Systém', kind: 'device', flow: 'render', deviceId: '', deviceName: '' },
      { id: 'game', on: true, name: 'Hra', kind: 'foreground', exe: '' },
      { id: 'discord', on: true, name: 'Discord', kind: 'process', exe: 'Discord.exe' },
      { id: 'mic', on: true, name: 'Mikrofón', kind: 'device', flow: 'capture', deviceId: '', deviceName: '' }
    ],
    games: [],
    exclude: DEFAULT_EXCLUDE.slice(),
    mixTrack: true,
    gameNames: {},
    hotkeys: { clip: 'Alt+F10', record: 'Alt+F9', short: '', mark: '' },
    autoWinCrop: false,
    ignoreRecorders: [],
    hotkeysAdmin: false,
    rawInput: true,
    shortSeconds: 15,
    cleanupGB: 0,
    updateChannel: 'stable',
    launchAtLogin: true,
    closeToTray: true,
    sounds: true,
    clipSound: 'beep',
    soundVolume: 0.6,
    overlay: true,
    overlayCorner: 'tr',
    overlayStyle: 'eye',
    powerSave: 'auto',
    notify: true,
    accent: '#ff9f0a',
    appearance: 'auto',
    onboarded: false
  };
}

function create(dir, videosDir) {
  const file = path.join(dir, 'settings.json');
  const meta = path.join(dir, 'clips.json');
  let data = defaults(videosDir);
  let clipMeta = {};
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { ...data, ...saved, hotkeys: { ...data.hotkeys, ...(saved.hotkeys || {}) } };
    // stopy: doplň chýbajúce, zachovaj uložené
    const byId = Object.fromEntries((saved.tracks || []).map(t => [t.id, t]));
    data.tracks = defaults(videosDir).tracks.map(t => ({ ...t, ...(byId[t.id] || {}) }));
  } catch (e) { }
  try { clipMeta = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch (e) { }

  let t = null, tm = null;
  const write = (f, obj) => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(obj, null, 2)); fs.renameSync(f + '.tmp', f); } catch (e) { } };
  return {
    get: () => data,
    set(patch) { data = { ...data, ...patch }; clearTimeout(t); t = setTimeout(() => write(file, data), 150); return data; },
    flush() { clearTimeout(t); write(file, data); clearTimeout(tm); write(meta, clipMeta); },
    meta: () => clipMeta,
    setMeta(p, m) { if (m == null) delete clipMeta[p]; else clipMeta[p] = { ...(clipMeta[p] || {}), ...m }; clearTimeout(tm); tm = setTimeout(() => write(meta, clipMeta), 300); },
    defaults: () => defaults(videosDir),
    DEFAULT_EXCLUDE
  };
}

module.exports = { create };
