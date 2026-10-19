/* Most do OBS — pre hry, ktoré sa skrývajú pred snímaním obrazovky (Valorant a pod.).
   LookAtThis NEvkladá nič do hry. Iba spustí OBS (jeho podpísaný Game Capture berie obraz priamo z hry,
   čo Vanguard toleruje) a riadi ho cez jeho oficiálne WebSocket rozhranie (obs-websocket v5, súčasť OBS 28+).

   Čo robí:
   - nájde a spustí obs64.exe skryto v tray (--minimize-to-tray), s vlastným profilom a scénou LookAtThis,
     aby sme nezasahovali do tvojho nastavenia OBS,
   - cez WebSocket zapne replay buffer a na povel uloží posledných N sekúnd,
   - vráti cestu k uloženému súboru, ktorý si LookAtThis zaradí do knižnice ako každý iný klip,
   - keď hra skončí, OBS po chvíli vypne.

   Všetko je opt-in (nastavenie obsBridge) a nijako nezasahuje do bežného snímania obrazovky. */
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WS = globalThis.WebSocket; // Electron 44 / Node 22: vstavaný WebSocket klient

/* obvyklé miesta inštalácie OBS (64-bit) */
const OBS_GUESSES = [
  'C:\\Program Files\\obs-studio',
  'C:\\Program Files (x86)\\obs-studio',
];
function findObs(custom) {
  const roots = [custom, ...OBS_GUESSES].filter(Boolean);
  for (const r of roots) {
    const exe = path.join(r, 'bin', '64bit', 'obs64.exe');
    if (fs.existsSync(exe)) return { root: r, exe, cwd: path.join(r, 'bin', '64bit') };
  }
  return null;
}

/* obs-websocket v5 autentifikácia: base64(sha256(base64(sha256(heslo+salt)) + challenge)) */
function authString(password, salt, challenge) {
  const s1 = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(s1 + challenge).digest('base64');
}

class Obs {
  constructor({ log }) {
    this.log = log || { info() {}, warn() {}, error() {} };
    this.ws = null;
    this.proc = null;
    this.connected = false;
    this.nextId = 1;
    this.pending = new Map();      // requestId -> {resolve, reject, timer}
    this.waiters = new Map();      // eventType -> [resolve]
    this.quitTimer = null;
    this.spawnedByUs = false;
  }

  /* ---------- WebSocket spojenie ---------- */
  connect(port, password, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      if (!WS) return reject(new Error('WebSocket nie je k dispozícii'));
      let done = false;
      const url = `ws://127.0.0.1:${port || 4455}`;
      let ws;
      try { ws = new WS(url); } catch (e) { return reject(e); }
      const fail = e => { if (!done) { done = true; try { ws.close(); } catch (x) {} reject(e instanceof Error ? e : new Error(String(e))); } };
      const timer = setTimeout(() => fail(new Error('OBS neodpovedá na porte ' + (port || 4455))), timeoutMs);

      ws.onerror = () => fail(new Error('OBS sa nedá pripojiť (beží a má zapnutý WebSocket server?)'));
      ws.onclose = () => { this.connected = false; if (!done) fail(new Error('OBS spojenie zatvorené')); this._flush(new Error('OBS spojenie zatvorené')); };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        // op 0 = Hello
        if (m.op === 0) {
          const d = m.d || {};
          const ident = { rpcVersion: d.rpcVersion || 1 };
          if (d.authentication) {
            if (!password) return fail(new Error('OBS vyžaduje heslo pre WebSocket'));
            ident.authentication = authString(password, d.authentication.salt, d.authentication.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d: ident }));
          return;
        }
        // op 2 = Identified → pripojené
        if (m.op === 2) {
          clearTimeout(timer); done = true; this.ws = ws; this.connected = true;
          this.log.info('OBS pripojené cez WebSocket');
          return resolve();
        }
        // op 7 = RequestResponse
        if (m.op === 7) {
          const d = m.d || {};
          const p = this.pending.get(d.requestId);
          if (p) {
            this.pending.delete(d.requestId); clearTimeout(p.timer);
            if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
            else p.reject(new Error((d.requestStatus && d.requestStatus.comment) || 'OBS požiadavka zlyhala'));
          }
          return;
        }
        // op 5 = Event
        if (m.op === 5) {
          const d = m.d || {};
          const w = this.waiters.get(d.eventType);
          if (w) { this.waiters.delete(d.eventType); w.forEach(fn => fn(d.eventData || {})); }
          return;
        }
      };
    });
  }

  _flush(err) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  request(type, data, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) return reject(new Error('OBS nie je pripojené'));
      const id = 'r' + (this.nextId++);
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('OBS neodpovedá (' + type + ')')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
    });
  }

  once(eventType, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const arr = this.waiters.get(eventType) || [];
      const timer = setTimeout(() => reject(new Error('OBS udalosť neprišla (' + eventType + ')')), timeoutMs);
      arr.push(d => { clearTimeout(timer); resolve(d); });
      this.waiters.set(eventType, arr);
    });
  }

  /* ---------- životný cyklus OBS ---------- */
  launch(obsRoot) {
    const info = findObs(obsRoot);
    if (!info) throw new Error('OBS som nenašiel. Nainštaluj OBS alebo zadaj cestu v nastaveniach.');
    this.log.info('spúšťam OBS skryto: ' + info.exe);
    const args = [
      '--minimize-to-tray', '--disable-shutdown-check',
      '--collection', 'LookAtThis', '--profile', 'LookAtThis',
      '--startreplaybuffer',
    ];
    const p = spawn(info.exe, args, { cwd: info.cwd, windowsHide: true, detached: false });
    p.on('error', e => this.log.warn('OBS spustenie: ' + e.message));
    p.on('exit', () => { if (this.proc === p) this.proc = null; });
    this.proc = p; this.spawnedByUs = true;
    return info;
  }

  /* hneď po štarte OBS hlási „not ready“ → skús to pár krát */
  async ensureReplayBuffer() {
    for (let i = 0; i < 8; i++) {
      try {
        const st = await this.request('GetReplayBufferStatus');
        if (st.outputActive) return true;
        await this.request('StartReplayBuffer'); await sleep(500);
        return true;
      } catch (e) {
        if (i === 7) { this.log.warn('replay buffer: ' + e.message); return false; }
        await sleep(1000);
      }
    }
    return false;
  }

  /* je to „naše“ OBS (beží s kolekciou LookAtThis)? Také môžeme pokojne vypnúť. */
  async isOurs() {
    if (this.spawnedByUs) return true;
    try { const r = await this.request('GetSceneCollectionList'); return r.currentSceneCollectionName === 'LookAtThis'; } catch (e) { return false; }
  }

  /* roztiahni Game Capture na celé plátno (záloha, keby scéna zo súboru nesadla) */
  async fitSource(width, height) {
    try {
      const v = await this.request('GetVideoSettings');
      const W = v.baseWidth || width, H = v.baseHeight || height;
      if (width && height && (W !== width || H !== height)) this.log.warn(`OBS plátno ${W}×${H}, monitor ${width}×${height}`);
      const { sceneItems } = await this.request('GetSceneItemList', { sceneName: 'LookAtThis' });
      for (const it of sceneItems || []) {
        if (it.inputKind !== 'game_capture') continue;
        await this.request('SetSceneItemTransform', {
          sceneName: 'LookAtThis', sceneItemId: it.sceneItemId,
          sceneItemTransform: { positionX: 0, positionY: 0, alignment: 5, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: W, boundsHeight: H },
        });
      }
      return true;
    } catch (e) { this.log.warn('OBS roztiahnutie: ' + e.message); return false; }
  }

  /* uloží posledných N sekúnd (podľa nastavenia bufferu v OBS) a vráti cestu k súboru */
  async saveReplay(timeoutMs = 15000) {
    const savedP = this.once('ReplayBufferSaved', timeoutMs).catch(() => null);
    await this.request('SaveReplayBuffer');
    const ev = await savedP;
    if (ev && ev.savedReplayPath) return ev.savedReplayPath;
    // záloha: niektoré verzie nehlásia cestu v evente → spýtaj sa priamo
    try { const r = await this.request('GetLastReplayBufferReplay'); if (r.savedReplayPath) return r.savedReplayPath; } catch (e) {}
    throw new Error('OBS neoznámil cestu k uloženému klipu');
  }

  scheduleQuit(ms = 20000) {
    clearTimeout(this.quitTimer);
    this.quitTimer = setTimeout(() => this.quit(), ms);
  }
  cancelQuit() { clearTimeout(this.quitTimer); this.quitTimer = null; }

  /* vypni OBS slušne: zastav replay buffer, pošli zatvorenie oknu (taskkill bez /F),
     a až keď sa do 8 s nezavrie, ukonči proces natvrdo. Cudzie OBS (tvoje vlastné) nevypíname. */
  async quit() {
    this.cancelQuit();
    const ours = this.connected ? await this.isOurs() : this.spawnedByUs;
    try { if (this.connected && ours) await this.request('StopReplayBuffer', {}, 3000).catch(() => {}); } catch (e) {}
    try { if (this.ws) this.ws.close(); } catch (e) {}
    this.ws = null; this.connected = false;
    if (!ours) { this.proc = null; return; }
    this.log.info('vypínam OBS (most už netreba)');
    await sleep(800);
    const p = this.proc;
    const args = p && p.pid ? ['/PID', String(p.pid)] : ['/IM', 'obs64.exe'];
    await new Promise(r => execFile('taskkill.exe', args, { windowsHide: true, timeout: 5000 }, () => r()));
    if (p) {
      const gone = await new Promise(r => { if (p.exitCode != null) return r(true); const t = setTimeout(() => r(false), 8000); p.once('exit', () => { clearTimeout(t); r(true); }); });
      if (!gone) { this.log.warn('OBS sa nezavrelo, ukončujem natvrdo'); try { p.kill(); } catch (e) {} }
    }
    this.proc = null; this.spawnedByUs = false;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { Obs, findObs, authString };
