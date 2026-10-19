/* Vytvorí v OBS vlastný profil a scénu „LookAtThis“, nech nezasahujeme do tvojho nastavenia OBS,
   a zapne WebSocket server. Profil aj scénu prepíšeme pri každom štarte nášho OBS, aby sedeli
   s aktuálnym nastavením LookAtThis (monitor, fps, enkodér, zvuk). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function obsConfigDir() {
  const appdata = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(appdata, 'obs-studio');
}

/* názvy enkodérov v jednoduchom režime OBS (frontend/widgets/OBSBasic.hpp, SIMPLE_ENCODER_*) */
const SIMPLE_ENCODERS = ['x264', 'x264_lowcpu', 'qsv', 'qsv_av1', 'nvenc', 'nvenc_av1', 'nvenc_hevc', 'amd', 'amd_hevc', 'amd_av1'];
/* rodina enkodéra z LookAtThis (nvenc/amf/qsv/x264) → OBS id; H.264 kvôli kompatibilite klipov */
function simpleEncoderFor(fam) {
  return { nvenc: 'nvenc', amf: 'amd', qsv: 'qsv', x264: 'x264' }[fam] || 'x264';
}

function source(id, name, settings, extra) {
  return {
    prev_ver: 503381505, name, uuid: crypto.randomUUID(), id, versioned_id: id,
    settings, mixers: 0, sync: 0, flags: 0, volume: 1.0, balance: 0.5,
    enabled: true, muted: false, hotkeys: {},
    deinterlace_mode: 0, deinterlace_field_order: 0, monitoring_type: 0, private_settings: {},
    ...(extra || {}),
  };
}

/* scéna: Game Capture („ľubovoľná hra na celej obrazovke“) roztiahnutý na celé plátno
   + globálny zvuk počítača a mikrofón (ako „Desktop Audio“ a „Mic/Aux“ v bežnom OBS) */
function sceneCollection({ width, height, desktopDevice, micDevice } = {}) {
  const W = width || 1920, H = height || 1080;
  const gameCapture = source('game_capture', 'Hra', {
    capture_mode: 'any',
    capture_cursor: true,
    allow_transparency: false,
    premultiplied_alpha: false,
    limit_framerate: false,
    capture_overlays: false,
    anti_cheat_hook: true,
    hook_rate: 1,
  });
  const sceneItem = {
    name: 'Hra', source_uuid: gameCapture.uuid,
    visible: true, locked: true, rot: 0.0,
    pos: { x: 0, y: 0 }, scale: { x: 1.0, y: 1.0 },
    align: 5,                    // ľavý horný roh
    bounds_type: 2,              // OBS_BOUNDS_SCALE_INNER = „zmenšiť/zväčšiť dovnútra“ (zachová pomer strán)
    bounds_align: 0,             // vycentrovať v hraniciach
    bounds: { x: W, y: H },
    crop_left: 0, crop_top: 0, crop_right: 0, crop_bottom: 0,
    scale_filter: 'disable', blend_method: 'default', blend_type: 'normal',
    show_transition: { duration: 0 }, hide_transition: { duration: 0 },
    private_settings: {}, id: 1, group_item_backup: false,
  };
  const scene = source('scene', 'LookAtThis', { id_counter: 1, custom_size: false, items: [sceneItem] });
  const col = {
    current_scene: 'LookAtThis', current_program_scene: 'LookAtThis',
    scene_order: [{ name: 'LookAtThis' }],
    name: 'LookAtThis',
    sources: [gameCapture, scene],
    current_transition: 'Fade', transition_duration: 300,
    preview_locked: false, scaling_enabled: false,
    modules: {}, resolution: { x: W, y: H }, version: 2,
  };
  // mixers 255 = zvuk ide do všetkých stôp (jednoduchý režim nahráva stopu 1)
  if (desktopDevice) col.DesktopAudioDevice1 = source('wasapi_output_capture', 'Zvuk počítača', { device_id: desktopDevice }, { mixers: 255 });
  if (micDevice) col.AuxAudioDevice1 = source('wasapi_input_capture', 'Mikrofón', { device_id: micDevice }, { mixers: 255 });
  return col;
}

/* profil: jednoduchý režim, replay buffer, HW enkodér, plátno = rozlíšenie monitora */
function profileIni({ clipsDir, seconds, encoder, width, height, fps }) {
  const enc = SIMPLE_ENCODERS.includes(encoder) ? encoder : 'nvenc';
  const W = width || 1920, H = height || 1080, F = Math.max(10, Math.round(fps || 60));
  const kbps = W * H >= 6e6 ? 40000 : W * H >= 2.0e6 ? 25000 : 15000; // 4K / 1440p / 1080p
  return [
    '[General]',
    'Name=LookAtThis',
    '',
    '[Output]',
    'Mode=Simple',
    '',
    '[SimpleOutput]',
    `FilePath=${String(clipsDir || '').replace(/\\/g, '/')}`,
    'RecFormat2=mp4',
    'RecQuality=Stream',          // replay buffer použije enkodér nižšie
    `StreamEncoder=${enc}`,
    `RecEncoder=${enc}`,
    'NVENCPreset2=p5',
    'Preset=veryfast',
    `VBitrate=${kbps}`,
    'ABitrate=192',
    'StreamAudioEncoder=aac',
    'RecAudioEncoder=aac',
    'RecTracks=1',
    'RecRB=true',
    `RecRBTime=${Math.max(10, Math.round(seconds || 60))}`,
    'RecRBSize=4096',
    'RecRBPrefix=Replay',
    '',
    '[Video]',
    `BaseCX=${W}`,
    `BaseCY=${H}`,
    `OutputCX=${W}`,
    `OutputCY=${H}`,
    'FPSType=1',                  // celé číslo fps (aj 120/144)
    `FPSInt=${F}`,
    `FPSCommon=${F}`,
    'FPSNum=' + F,
    'FPSDen=1',
    'ScaleType=bicubic',
    'ColorFormat=NV12',
    'ColorSpace=709',
    'ColorRange=Partial',
    '',
    '[Audio]',
    'SampleRate=48000',
    'ChannelSetup=Stereo',
    'MonitoringDeviceId=default',
    '',
  ].join('\r\n');
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

/* zapíše profil + scénu + websocket; vráti { port, password } pre klienta */
function ensureConfig(o) {
  const dir = obsConfigDir();
  if (!fs.existsSync(dir)) throw new Error('OBS konfigurácia neexistuje — spusti OBS aspoň raz.');
  const L = o.log || { info() {}, warn() {} };
  const port = o.port || 4455;
  const password = o.password || crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);

  const profDir = path.join(dir, 'basic', 'profiles', 'LookAtThis');
  fs.mkdirSync(profDir, { recursive: true });
  fs.writeFileSync(path.join(profDir, 'basic.ini'), profileIni(o), 'utf8');

  const sceneDir = path.join(dir, 'basic', 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'LookAtThis.json'), JSON.stringify(sceneCollection(o), null, 2), 'utf8');

  const wsDir = path.join(dir, 'plugin_config', 'obs-websocket');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'config.json'), websocketConfig(port, password), 'utf8');

  L.info(`OBS profil pripravený: ${o.width}×${o.height} @ ${o.fps} fps, enkodér ${o.encoder}, zvuk ${o.desktopDevice ? 'áno' : 'nie'}, mikrofón ${o.micDevice ? 'áno' : 'nie'} (port ${port})`);
  return { port, password };
}

module.exports = { ensureConfig, obsConfigDir, sceneCollection, profileIni, simpleEncoderFor, SIMPLE_ENCODERS };
