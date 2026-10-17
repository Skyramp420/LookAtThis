/* Automatické aktualizácie cez GitHub Releases (electron-updater), rovnako ako vo WorkingOnIt.
   Funguje v nainštalovanej verzii (inštalačka z electron-builder). Pri spúšťaní zo zdrojákov
   (Spustit.bat) sa len ukáže, že aktualizácie rieši inštalačka. */
const { app } = require('electron');

const HOUR = 3600000;
let au = null, log = console;
let state = { status: 'idle', version: null, percent: 0, error: null, checkedAt: null, notes: '' };
let send = () => { }, notify = () => { }, getSettings = () => ({});
let timer = null, notified = false;

function supported() {
  if (!app.isPackaged && !process.env.LAT_UPDATE_TEST) return { ok: false, reason: 'source' };
  return { ok: true };
}
function set(patch) { state = Object.assign({}, state, patch); send(status()); }
function status() {
  const s = supported();
  return Object.assign({ supported: s.ok, reason: s.reason || null, current: app.getVersion() }, state);
}

/* zrozumiteľná chyba namiesto technickej hlášky */
function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|network|getaddrinfo/i.test(m)) return 'Nie si pripojený na internet, skúsim to neskôr.';
  if (/404|Cannot find latest|No published versions|latest\.yml/i.test(m)) return 'Zatiaľ nie je vydaná žiadna verzia na stiahnutie.';
  if (/sha512|checksum/i.test(m)) return 'Stiahnutá aktualizácia bola poškodená, stiahnem ju znova.';
  if (/signature|publisher|not signed/i.test(m)) return 'Aktualizácia nemá správny podpis, preto som ju neinštaloval.';
  return 'Aktualizácia sa nepodarila: ' + m.split('\n')[0].slice(0, 160);
}

function init(opts) {
  send = opts.send || send; notify = opts.notify || notify; getSettings = opts.getSettings || getSettings; log = opts.log || log;
  if (!supported().ok) return status();
  try { au = require('electron-updater').autoUpdater; } catch (e) { log.warn('update: electron-updater chýba', e.message); return status(); }
  au.logger = { info: m => log.info('update:', m), warn: m => log.warn('update:', m), error: m => log.error('update:', m), debug: () => { } };
  if (process.env.LAT_UPDATE_TEST) {
    au.forceDevUpdateConfig = true;
    if (process.env.LAT_UPDATE_URL) au.setFeedURL({ provider: 'generic', url: process.env.LAT_UPDATE_URL });
  }
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.allowDowngrade = false;
  au.on('checking-for-update', () => set({ status: 'checking', error: null }));
  au.on('update-available', i => set({ status: 'downloading', version: i.version, percent: 0, notes: notesOf(i) }));
  au.on('update-not-available', () => set({ status: 'latest', checkedAt: new Date().toISOString() }));
  au.on('download-progress', p => set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
  au.on('update-downloaded', i => {
    set({ status: 'ready', version: i.version, percent: 100, notes: notesOf(i), checkedAt: new Date().toISOString() });
    if (!notified) { notified = true; notify(i.version); }
  });
  au.on('error', e => { log.warn('update: chyba', e && e.message); set({ status: 'error', error: friendly(e) }); });
  // prvá kontrola chvíľu po štarte (nech nebrzdí štart s Windowsom), potom každé 4 hodiny
  clearTimeout(timer);
  timer = setTimeout(function tick() { check(); timer = setTimeout(tick, 4 * HOUR); }, 60000);
  return status();
}

function notesOf(i) {
  const n = i && i.releaseNotes;
  if (!n) return '';
  const text = Array.isArray(n) ? n.map(x => x.note || '').join('\n') : String(n);
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim().slice(0, 1200);
}

async function check() {
  if (!au) return status();
  if (state.status === 'downloading' || state.status === 'ready') return status();
  au.allowPrerelease = getSettings().updateChannel === 'beta';
  try {
    const r = await au.checkForUpdates();
    if (r && r.downloadPromise) r.downloadPromise.catch(() => { });
  } catch (e) { set({ status: 'error', error: friendly(e) }); }
  return status();
}

/* reštart a inštalácia; onBefore v main.js nastaví, že appka naozaj končí (nie len do lišty) */
function install(onBefore) {
  if (!au || state.status !== 'ready') return false;
  if (onBefore) onBefore();
  setImmediate(() => au.quitAndInstall(true, true));
  return true;
}

module.exports = { init, check, install, status };
