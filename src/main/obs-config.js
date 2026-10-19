/* Vytvorí v OBS vlastný profil a scénu „LookAtThis“ (len ak ešte nie sú), nech nezasahujeme
   do tvojho nastavenia OBS, a zapne WebSocket server. Je to best-effort pre OBS 30–32;
   ak niečo nesadne, opravíme po prvom teste u teba. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function obsConfigDir() {
  const appdata = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(appdata, 'obs-studio');
}

/* scéna s jedným zdrojom Game Capture v režime „zachyť ľubovoľnú hru na celej obrazovke“ (mode any) */
function sceneCollection() {
  const gameCapture = {
    prev_ver: 503381505,
    name: 'Hra',
    uuid: crypto.randomUUID(),
    id: 'game_capture',
    versioned_id: 'game_capture',
    settings: {
      capture_mode: 'any',
      capture_cursor: true,
      allow_transparency: false,
      premultiplied_alpha: false,
      limit_framerate: false,
      capture_overlays: false,
      anti_cheat_hook: true,
      hook_rate: 1,
    },
    mixers: 0, sync: 0, flags: 0, volume: 1.0, balance: 0.5,
    enabled: true, muted: false,
    'prev_ver': 503381505,
    hotkeys: {},
    deinterlace_mode: 0, deinterlace_field_order: 0, monitoring_type: 0,
    private_settings: {},
  };
  const sceneItem = {
    name: 'Hra', source_uuid: gameCapture.uuid,
    visible: true, locked: false, rot: 0.0,
    pos: { x: 0, y: 0 }, scale: { x: 1.0, y: 1.0 },
    align: 5, bounds_type: 0, bounds_align: 0, bounds: { x: 0, y: 0 },
    scale_filter: 'disable', blend_method: 'default', blend_type: 'normal',
    show_transition: { duration: 0 }, hide_transition: { duration: 0 },
    private_settings: {}, id: 1, group_item_backup: false,
  };
  const scene = {
    prev_ver: 503381505, name: 'LookAtThis', uuid: crypto.randomUUID(),
    id: 'scene', versioned_id: 'scene',
    settings: { id_counter: 1, custom_size: false, items: [sceneItem] },
    mixers: 0, sync: 0, flags: 0, volume: 1.0, balance: 0.5,
    enabled: true, muted: false, hotkeys: {},
    deinterlace_mode: 0, deinterlace_field_order: 0, monitoring_type: 0, private_settings: {},
  };
  return {
    current_scene: 'LookAtThis', current_program_scene: 'LookAtThis',
    scene_order: [{ name: 'LookAtThis' }],
    name: 'LookAtThis',
    sources: [gameCapture, scene],
    current_transition: 'Fade', transition_duration: 300,
    preview_locked: false, scaling_enabled: false,
    modules: {}, resolution: {}, version: 2,
  };
}

/* profil: replay buffer zapnutý, výstup mp4, dĺžka podľa bufferu */
function profileIni(clipsDir, seconds, encoder) {
  const enc = encoder || 'jim_nvenc';
  return [
    '[General]',
    'Name=LookAtThis',
    '',
    '[SimpleOutput]',
    `FilePath=${clipsDir}`,
    'RecFormat2=mp4',
    'RecQuality=Stream',
    `RecEncoder=${enc}`,
    `StreamEncoder=${enc}`,
    'VBitrate=25000',
    'RecRB=true',
    `RecRBTime=${Math.max(10, Math.round(seconds || 60))}`,
    'RecRBSize=0',
    'RecRBPrefix=Replay',
    '',
    '[Output]',
    'Mode=Simple',
    '',
    '[Video]',
    'FPSCommon=60',
    '',
  ].join('\n');
}

function websocketConfig(port, password) {
  return JSON.stringify({
    alerts_enabled: false,
    auth_required: true,
    first_load: false,
    server_enabled: true,
    server_password: password,
    server_port: port || 4455,
  }, null, 4);
}

/* vytvor len to, čo chýba; vráti { port, password } pre klienta */
function ensureConfig({ clipsDir, seconds, encoder, port, password, log }) {
  const dir = obsConfigDir();
  if (!fs.existsSync(dir)) throw new Error('OBS konfigurácia neexistuje — spusti OBS aspoň raz.');
  const L = log || { info() {}, warn() {} };
  port = port || 4455;
  password = password || crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);

  // profil
  const profDir = path.join(dir, 'basic', 'profiles', 'LookAtThis');
  fs.mkdirSync(profDir, { recursive: true });
  const iniPath = path.join(profDir, 'basic.ini');
  fs.writeFileSync(iniPath, profileIni(clipsDir, seconds, encoder), 'utf8');

  // scéna
  const sceneDir = path.join(dir, 'basic', 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  const scenePath = path.join(sceneDir, 'LookAtThis.json');
  if (!fs.existsSync(scenePath)) fs.writeFileSync(scenePath, JSON.stringify(sceneCollection(), null, 2), 'utf8');

  // WebSocket server
  const wsDir = path.join(dir, 'plugin_config', 'obs-websocket');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'config.json'), websocketConfig(port, password), 'utf8');

  L.info(`OBS profil/scéna/websocket pripravené (port ${port})`);
  return { port, password };
}

module.exports = { ensureConfig, obsConfigDir, sceneCollection, profileIni };
