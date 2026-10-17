/* Engine: obraz cez ffmpeg (ddagrab + HW enkodér), zvuk cez fxaudio.exe do pomenovaných rúr.
   ffmpeg píše 2-sekundové segmenty do dočasného priečinka. Replay buffer = držíme posledných N sekúnd,
   clip = poskladáme posledné segmenty do mp4. Nahrávanie = segmenty od štartu nezmažeme. */
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const Games = require('../shared/games');
const SEG = 2; // dĺžka segmentu v sekundách = aj interval kľúčových snímok

// vysoká = cq 21: vizuálne takmer rovnaké ako 19, ale zhruba polovičný zápis na disk
const QUALITY = { high: 21, medium: 24, low: 28 };
const ENCODERS = {
  nvenc: { h264: 'h264_nvenc', hevc: 'hevc_nvenc', av1: 'av1_nvenc', zeroCopy: true },
  amf: { h264: 'h264_amf', hevc: 'hevc_amf', zeroCopy: true },
  qsv: { h264: 'h264_qsv', hevc: 'hevc_qsv', zeroCopy: false },
  x264: { h264: 'libx264', hevc: 'libx265', zeroCopy: false }
};
const ORDER = ['nvenc', 'amf', 'qsv', 'x264'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function safeName(s) { return String(s || '').replace(/\.exe$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60); }

/* spusti ffmpeg a počkaj na koniec; vráti { code, err } */
function run(bin, args, opts = {}) {
  return new Promise(resolve => {
    let err = '';
    const p = spawn(bin, args, { windowsHide: true, ...opts });
    // náhľady a sondy na pozadí nesmú brať výkon hre
    if (opts.low) { try { require('os').setPriority(p.pid, require('os').constants.priority.PRIORITY_LOW); } catch (e) { } }
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => resolve({ code: -1, err: e.message }));
    p.on('close', code => resolve({ code, err }));
    if (opts.feed) opts.feed(p);
  });
}

class Engine extends EventEmitter {
  constructor({ ffmpeg, fxaudio, tmpRoot, log }) {
    super();
    this.ffmpeg = ffmpeg; this.fxaudio = fxaudio; this.tmpRoot = tmpRoot; this.log = log || console;
    this.state = 'off';        // off | starting | on | error
    this.error = '';
    this.encoderUsed = '';
    this.recording = null;     // { startIdx, since }
    this.tracks = {};          // id -> { status, name, how, level }
    this.proc = null; this.helpers = [];
    this.dir = null; this.settings = null;
    this.retry = 0; this.wanted = false; this.gen = 0;
    this.available = null;     // detegované enkodéry
  }

  /* ---------- zisti, čo vie grafika ---------- */
  async detectEncoders() {
    const names = ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_amf', 'hevc_amf', 'h264_qsv', 'hevc_qsv', 'libx264'];
    const out = {};
    for (const n of names) {
      const r = await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=1280x720:r=30', '-frames:v', '3', '-c:v', n, '-f', 'null', '-']);
      out[n] = r.code === 0;
    }
    this.available = out;
    return out;
  }

  pickEncoder(s) {
    const av = this.available || {};
    const codec = s.codec || 'h264';
    const list = s.encoder && s.encoder !== 'auto' ? [s.encoder, ...ORDER.filter(x => x !== s.encoder)] : ORDER;
    for (const fam of list) {
      const name = ENCODERS[fam] && (ENCODERS[fam][codec] || ENCODERS[fam].h264);
      if (name && (av[name] || (this.available == null && fam === 'x264'))) return { fam, name };
    }
    return { fam: 'x264', name: 'libx264' };
  }

  /* ---------- argumenty pre ffmpeg ---------- */
  /* úsporný režim: zapnutý ručne, alebo automaticky na slabšom PC (main nastaví this.weak) */
  hasHW() { const a = this.available; return !!(a && (a.h264_nvenc || a.h264_amf || a.h264_qsv)); }
  powerSaving(s) { return s.powerSave === 'on' || (s.powerSave !== 'off' && (!!this.weak || (this.available != null && !this.hasHW()))); }

  videoArgs(s, enc, zeroCopy) {
    const save = this.powerSaving(s), cpu = enc.fam === 'x264';
    let fps = Number(s.fps) || 60;
    let q = QUALITY[s.quality] || QUALITY.high;
    let res = s.resolution && s.resolution !== 'native' ? Number(s.resolution) : 0;
    // šetrenie: menej snímok, menšie rozlíšenie, nižšia kvalita (procesor bez HW enkodéra šetríme vždy)
    // veľmi široké monitory (napr. 5120×1440): H.264 na grafike zvládne najviac 4096 px na šírku, tak obraz zmenšíme na 3840 px
    const px = this.monitorPx ? this.monitorPx(s.monitor) : null, codecN = s.codec || 'h264';
    if (px && px.w > 4096 && codecN !== 'hevc' && codecN !== 'av1') res = Math.min(res || 9999, Math.max(2, Math.floor(3840 * px.h / px.w / 2) * 2));
    if (save || cpu) { fps = Math.min(fps, 30); res = Math.min(res || 9999, cpu && save ? 720 : 1080); }
    if (save) q = Math.max(q, QUALITY.medium);
    const g = fps * SEG;
    const args = ['-f', 'lavfi', '-thread_queue_size', '512', '-analyzeduration', '0', '-i', `ddagrab=output_idx=${Number(s.monitor) || 0}:framerate=${fps}:draw_mouse=${s.cursor === false ? 0 : 1}`];
    const filters = [];
    const H = res ? `'min(ih,${res})'` : null; // nikdy nezväčšovať
    const zero = zeroCopy && ENCODERS[enc.fam].zeroCopy;
    if (zero && res && enc.fam === 'nvenc') {
      // zmenšenie priamo na grafike (CUDA), obraz neprechádza cez procesor
      filters.push('hwmap=derive_device=cuda', `scale_cuda=w=-2:h=${H}`);
    } else if (!(zero && !res)) {
      filters.push('hwdownload', 'format=bgra');
      if (res) filters.push(`scale=w=-2:h=${H}:flags=${cpu ? 'fast_bilinear' : 'bicubic'}`);
      filters.push(cpu ? 'format=yuv420p' : 'format=nv12');
    }
    const out = [];
    if (filters.length) out.push('-vf', filters.join(','));
    out.push('-c:v', enc.name);
    if (enc.fam === 'nvenc') out.push('-preset', save ? 'p2' : 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', String(q), '-b:v', '0', '-maxrate', save ? '40M' : '60M', '-bufsize', save ? '80M' : '120M', '-forced-idr', '1');
    else if (enc.fam === 'amf') out.push('-quality', save ? 'speed' : 'balanced', '-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q + 2));
    else if (enc.fam === 'qsv') out.push('-preset', save ? 'veryfast' : 'faster', '-global_quality', String(q));
    else out.push('-preset', save ? 'ultrafast' : 'superfast', '-tune', 'zerolatency', '-crf', String(q + 3), '-threads', '0');
    out.push('-g', String(g), '-force_key_frames', `expr:gte(t,n_forced*${SEG})`);
    this.effective = { fps, res: res || 0, save };
    return { input: args, output: out };
  }

  helperArgs(t, s, pipe) {
    const a = ['capture', '--pipe', pipe];
    // spoločný začiatok všetkých zvukových stôp (pomocníci sa k ffmpeg pripájajú postupne)
    if (this.dir) a.push('--epoch-file', path.join(this.dir, 'epoch.bin'));
    if (t.kind === 'device') {
      a.push('--flow', t.flow === 'capture' ? 'capture' : 'render');
      if (t.deviceId) a.push('--device', t.deviceId);
      if (t.deviceName) a.push('--name', t.deviceName);
      a.push('--default');
    } else if (t.kind === 'process') {
      a.push('--process', t.exe || 'Discord.exe');
    } else {
      a.push('--foreground');
      // vlastný zoznam + všetky nainštalované hry → spozná ich aj v okne, nielen na celú obrazovku
      const games = [...new Set([...(s.games || []), ...(this.detectedExes || []).map(e => e + '.exe')])];
      if (games.length) a.push('--games', games.join(','));
      a.push('--exclude', (s.exclude || []).join(','));
    }
    return a;
  }

  /* ---------- štart / stop ---------- */
  async start(settings) {
    this.settings = settings;
    this.wanted = true;
    if (this.proc) return;
    if (this.starting) { this.pending = true; return; }
    this.starting = true;
    try { await this._start(settings); } finally {
      this.starting = false;
      // počas štartu prišiel stop + nový štart (zmena nastavení) → rozbehni nanovo
      if (this.pending) { this.pending = false; if (this.wanted && !this.proc) this.start(this.settings); }
    }
  }

  async _start(settings) {
    const gen = ++this.gen;
    this.setState('starting');
    if (!this.available) { try { await this.detectEncoders(); } catch (e) { this.log.warn('detekcia enkodérov', e.message); } }
    if (gen !== this.gen) return;

    const s = settings;
    this.dir = path.join(this.tmpRoot, String(Date.now()));
    fs.mkdirSync(this.dir, { recursive: true });
    const tracks = (s.tracks || []).filter(t => t.on);
    this.tracks = {};
    const enc = this.pickEncoder(s);
    // pokus 1: zero-copy (GPU → enkodér), pokus 2: cez systémovú pamäť, pokus 3: x264 na procesore
    const attempts = [[enc, true], [enc, false], [{ fam: 'x264', name: 'libx264' }, false]];
    const [useEnc, zeroCopy] = attempts[Math.min(this.retry, attempts.length - 1)];

    // pomocníci so zvukom: každý si vytvorí rúru a čaká, kým sa ffmpeg pripojí
    const pipes = [];
    for (const t of tracks) {
      const pipe = `\\\\.\\pipe\\lookatthis-${process.pid}-${t.id}-${gen}`;
      this.tracks[t.id] = { status: 'starting', name: '', how: '', level: 0 };
      const h = spawn(this.fxaudio, this.helperArgs(t, s, pipe), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const ready = new Promise(res => {
        let buf = '';
        const timer = setTimeout(res, 3000);
        h.stderr.on('data', d => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line) continue;
            let m; try { m = JSON.parse(line); } catch (e) { continue; }
            if (m.ev === 'waiting') { clearTimeout(timer); res(); }
            this.onHelper(t, m);
          }
        });
        h.on('error', e => { this.log.error('fxaudio', e.message); clearTimeout(timer); res(); });
      });
      h.on('exit', () => { if (this.tracks[t.id]) this.tracks[t.id].status = 'off'; });
      this.helpers.push(h);
      pipes.push({ t, pipe, ready });
    }
    await Promise.all(pipes.map(p => p.ready));
    if (gen !== this.gen) { this.killHelpers(); return; }

    const v = this.videoArgs(s, useEnc, zeroCopy);
    const args = ['-hide_banner', '-loglevel', 'warning', '-nostats', '-y', ...v.input];
    // bez -probesize/-analyzeduration ffmpeg každú rúru ~1 s „skúma“ a ďalšiu otvorí až potom:
    // každá ďalšia stopa by tak začínala o sekundu neskôr a nesedela s obrazom ani s ostatnými stopami
    for (const p of pipes) args.push('-thread_queue_size', '4096', '-probesize', '32', '-analyzeduration', '0', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', p.pipe);
    args.push('-map', '0:v');
    pipes.forEach((p, i) => args.push('-map', `${i + 1}:a`));
    args.push(...v.output);
    // oneskorenie stopy (napr. mikrofón cez VST pluginy): kladné = zvuk mešká → odstrihni začiatok, záporné = predbieha → pridaj ticho
    pipes.forEach((p, i) => {
      const ms = Math.round(Number(p.t.latency) || 0);
      if (ms > 0) args.push(`-filter:a:${i}`, `atrim=start=${(ms / 1000).toFixed(3)},asetpts=PTS-STARTPTS`);
      else if (ms < 0) args.push(`-filter:a:${i}`, `adelay=${-ms}:all=1`);
    });
    if (pipes.length) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-max_muxing_queue_size', '4096',
      '-f', 'segment', '-segment_time', String(SEG), '-segment_time_delta', '0.05', '-segment_format', 'mpegts', '-reset_timestamps', '0',
      path.join(this.dir, 'seg%06d.ts'));

    this.log.info('ffmpeg ' + args.join(' '));
    this.encoderUsed = useEnc.name + (zeroCopy && ENCODERS[useEnc.fam].zeroCopy ? ' (GPU)' : '');
    let errTail = '';
    const proc = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    this.proc = proc;
    this.liveSince = Date.now();
    this.trackOrder = pipes.map(p => p.t);
    const startedAt = Date.now();
    proc.stderr.on('data', d => { errTail = (errTail + d).slice(-3000); });
    proc.on('error', e => { errTail += e.message; });
    proc.on('close', code => {
      this.proc = null;
      this.killHelpers();
      clearInterval(this.cleaner); clearInterval(this.watch);
      if (!this.wanted) { this.setState('off'); return; }
      const quick = Date.now() - startedAt < 8000;
      this.log.warn(`ffmpeg skončil (${code}) po ${Math.round((Date.now() - startedAt) / 1000)} s: ${errTail.slice(-600)}`);
      if (quick) this.retry++; else this.retry = 0;
      if (this.retry > 3) {
        this.error = lastLine(errTail) || `ffmpeg skončil s kódom ${code}`;
        this.setState('error');
        this.wanted = false;
        return;
      }
      setTimeout(() => { if (this.wanted && !this.proc) this.start(this.settings); }, quick ? 500 : 2000);
    });

    this.cleaner = setInterval(() => this.clean(), 2000);
    // keď do 6 s nevznikne prvý segment, niečo je zle → ffmpeg zostrelíme a skúsime záložný režim
    setTimeout(() => {
      if (this.proc === proc && !this.segments().length) { this.log.warn('žiadne segmenty, skúšam iný režim'); try { proc.kill(); } catch (e) { } }
      else if (this.proc === proc) { this.error = ''; this.setState('on'); }
    }, 6000);
  }

  onHelper(t, m) {
    const tr = this.tracks[t.id]; if (!tr) return;
    if (m.ev === 'lvl') { tr.level = m.v; return; }
    if (m.ev === 'epoch') { this.log.info(`stopa ${t.id}: zarovnaná na spoločný začiatok (+${m.shift} ms)`); return; }
    if (m.ev === 'bound') {
      tr.status = 'bound'; tr.name = m.name; tr.how = m.how;
      this.emit('track', { id: t.id, ...tr, deviceId: m.id });
    } else if (m.ev === 'missing' || m.ev === 'lost') {
      if (tr.status !== 'missing') { tr.status = 'missing'; tr.name = m.name || tr.name; this.emit('track', { id: t.id, ...tr }); }
    } else if (m.ev === 'error') {
      this.log.warn(`fxaudio ${t.id}: ${m.name} ${m.how}`);
      tr.status = 'error'; tr.how = m.how; this.emit('track', { id: t.id, ...tr });
    }
  }

  killHelpers() { for (const h of this.helpers) { try { h.kill(); } catch (e) { } } this.helpers = []; }

  async stop() {
    this.wanted = false; this.gen++;
    const p = this.proc;
    if (p) {
      try { p.stdin.write('q'); } catch (e) { }
      await Promise.race([new Promise(r => p.once('close', r)), sleep(3000)]);
      if (this.proc === p) { try { p.kill(); } catch (e) { } }
    }
    this.killHelpers();
    this.setState('off');
  }

  async restart(settings) {
    if (this.recording) { this.settings = settings; return false; } // počas nahrávania nemeníme za behu
    const was = this.wanted || this.proc;
    await this.stop();
    this.retry = 0;
    this.removeOld();
    if (was) await this.start(settings);
    return true;
  }

  setState(st) { this.state = st; this.emit('state', this.status()); }

  status() {
    return {
      state: this.state, error: this.error, encoder: this.encoderUsed,
      recording: this.recording ? { since: this.recording.since } : null,
      tracks: this.tracks, buffered: this.bufferedSeconds(), effective: this.effective || null
    };
  }

  /* ---------- segmenty ---------- */
  segments() {
    if (!this.dir) return [];
    let files = [];
    try { files = fs.readdirSync(this.dir).filter(f => /^seg\d+\.ts$/.test(f)); } catch (e) { return []; }
    return files.map(f => ({ f, idx: Number(f.slice(3, -3)) })).sort((a, b) => a.idx - b.idx);
  }
  /* koľko sekúnd je v buffri: podľa skutočného času od štartu ffmpeg (po 1 s), nie po 2-s segmentoch */
  bufferedSeconds() {
    if (!this.proc || !this.liveSince) return 0;
    return Math.min(Math.floor((Date.now() - this.liveSince) / 1000), (this.settings && this.settings.bufferSeconds) || 60);
  }
  clean() {
    const segs = this.segments(); if (!segs.length) return;
    const keep = Math.ceil(((this.settings && this.settings.bufferSeconds) || 60) / SEG) + 2;
    const maxIdx = segs[segs.length - 1].idx;
    for (const s of segs) {
      if (s.idx >= maxIdx - keep) continue;
      if (this.recording && s.idx >= this.recording.startIdx) continue;
      try { fs.unlinkSync(path.join(this.dir, s.f)); } catch (e) { }
    }
  }
  removeOld() {
    try {
      for (const d of fs.readdirSync(this.tmpRoot)) {
        const p = path.join(this.tmpRoot, d);
        if (p !== this.dir || !this.proc) fs.rmSync(p, { recursive: true, force: true });
      }
    } catch (e) { }
  }

  /* poskladaj segmenty do mp4: TS sa dá spojiť za sebou bajt po bajte, tak ich len pošleme ffmpegu do stdin */
  async mux(segs, outPath, meta) {
    const s = this.settings;
    const order = this.trackOrder || [];
    const names = order.map(t => t.name);
    const sysI = order.findIndex(t => t.id === 'system');
    const micI = order.findIndex(t => t.id === 'mic');
    const mix = s.mixTrack && sysI >= 0 && micI >= 0;
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-probesize', '50M', '-analyzeduration', '10M', '-f', 'mpegts', '-i', 'pipe:0'];
    if (mix) {
      args.push('-filter_complex', `[0:a:${sysI}][0:a:${micI}]amix=inputs=2:duration=longest:normalize=0[mix]`,
        '-map', '0:v', '-map', '[mix]', '-map', '0:a?', '-c', 'copy', '-c:a:0', 'aac', '-b:a:0', '192k');
      names.unshift('Mix (systém + mikrofón)');
    } else args.push('-map', '0', '-c', 'copy');
    // mp4 si názov stopy drží v handler_name (to čítajú DaVinci, Premiere aj prehrávače)
    names.forEach((n, i) => args.push(`-metadata:s:a:${i}`, `title=${n}`, `-metadata:s:a:${i}`, `handler_name=${n}`));
    if (names.length) args.push('-disposition:a:0', 'default');
    args.push('-metadata', `comment=LookAtThis${meta && meta.game ? ' · ' + meta.game : ''}`, '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', outPath);
    const dir = this.dir;
    const r = await run(this.ffmpeg, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      feed: async p => {
        p.stdin.on('error', () => { });
        for (const sg of segs) {
          const file = path.join(dir, sg.f);
          if (!fs.existsSync(file)) continue;
          await new Promise(res => {
            const rs = fs.createReadStream(file);
            rs.on('end', res); rs.on('error', res);
            rs.pipe(p.stdin, { end: false });
          });
        }
        p.stdin.end();
      }
    });
    if (r.code !== 0) throw new Error(lastLine(r.err) || 'Skladanie clipu zlyhalo');
    return outPath;
  }

  /* posledných pár sekúnd dvoch stôp ako 16-bit mono PCM (na synchronizáciu tlieskaním) */
  async grabTracks(seconds, ids) {
    if (!this.proc || this.state !== 'on') throw new Error('Buffer nebeží');
    const order = this.trackOrder || [];
    const idx = ids.map(id => order.findIndex(t => t.id === id));
    if (idx.some(i => i < 0)) throw new Error(`Zapni stopu ${ids.map((id, k) => idx[k] < 0 ? ({ system: 'Systém', mic: 'Mikrofón' }[id] || id) : '').filter(Boolean).join(' a ')}`);
    const segs = this.segments().slice(-(Math.ceil(seconds / SEG) + 2));
    const tmp = path.join(this.tmpRoot, 'calib-' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    const outs = ids.map((id, k) => path.join(tmp, `${k}.raw`));
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'mpegts', '-i', 'pipe:0'];
    idx.forEach((i, k) => args.push('-map', `0:a:${i}`, '-ac', '1', '-ar', '48000', '-f', 's16le', outs[k]));
    const dir = this.dir;
    try {
      const r = await run(this.ffmpeg, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        feed: async p => {
          p.stdin.on('error', () => { });
          for (const sg of segs) {
            const file = path.join(dir, sg.f); if (!fs.existsSync(file)) continue;
            await new Promise(res => { const rs = fs.createReadStream(file); rs.on('end', res); rs.on('error', res); rs.pipe(p.stdin, { end: false }); });
          }
          p.stdin.end();
        }
      });
      if (r.code !== 0) throw new Error(lastLine(r.err) || 'Čítanie stôp zlyhalo');
      return outs.map(f => { const b = fs.readFileSync(f); return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~1))); });
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { } }
  }

  outName(dir, prefix) {
    // pekný názov hry do súboru: „VALORANT 2026-…“ namiesto „VALORANT-Win64-Shipping 2026-…“
    const custom = (this.settings && this.settings.gameNames) || {};
    const game = this.tracks.game && this.tracks.game.status === 'bound' ? safeName(Games.pretty(this.tracks.game.name, custom, this.detectedMap)) : '';
    const base = `${game || prefix} ${stamp()}`;
    let p = path.join(dir, base + '.mp4'), k = 2;
    while (fs.existsSync(p)) p = path.join(dir, `${base} (${k++}).mp4`);
    return { path: p, game };
  }

  async saveClip(dir, seconds) {
    if (!this.proc || this.state !== 'on') throw new Error(this.state === 'starting' ? 'Buffer sa ešte rozbieha' : 'Buffer nebeží');
    // počkaj chvíľu, aby sa do segmentu dostali aj posledné snímky pred stlačením
    await sleep(400);
    const segs = this.segments();
    const want = Math.min(seconds || this.settings.bufferSeconds || 60, this.settings.bufferSeconds || 60);
    const n = Math.ceil(want / SEG) + 1;
    const pick = segs.slice(-n);
    if (!pick.length) throw new Error('Buffer je zatiaľ prázdny');
    fs.mkdirSync(dir, { recursive: true });
    const o = this.outName(dir, 'Clip');
    await this.mux(pick, o.path, o);
    return { path: o.path, game: o.game, seconds: pick.length * SEG };
  }

  async startRecording() {
    if (this.recording) return;
    if (!this.proc) {
      await this.start(this.settings);
      for (let i = 0; i < 40 && this.state !== 'on'; i++) await sleep(250);
      if (this.state !== 'on') throw new Error(this.error || 'Nahrávanie sa nepodarilo spustiť');
    }
    const segs = this.segments();
    this.recording = { startIdx: segs.length ? segs[segs.length - 1].idx : 0, since: Date.now() };
    this.setState(this.state);
  }

  async stopRecording(dir) {
    if (!this.recording) return null;
    const rec = this.recording;
    await sleep(400);
    const segs = this.segments().filter(s => s.idx >= rec.startIdx);
    this.recording = null;
    this.setState(this.state);
    fs.mkdirSync(dir, { recursive: true });
    const o = this.outName(dir, 'Nahrávka');
    await this.mux(segs, o.path, o);
    return { path: o.path, game: o.game, seconds: Math.round((Date.now() - rec.since) / 1000) };
  }
}

function lastLine(s) {
  const lines = String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return lines[lines.length - 1] || '';
}

/* ---------- jednorazové veci pre knižnicu ---------- */
async function thumbnail(ffmpeg, file, out) {
  const r = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', out], { low: true });
  if (r.code !== 0) {
    const r2 = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', out], { low: true });
    return r2.code === 0;
  }
  return true;
}
async function probe(ffmpeg, file) {
  const r = await run(ffmpeg, ['-hide_banner', '-i', file]);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.err);
  const audio = (r.err.match(/Stream #0:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio/g) || []).length;
  const titles = [];
  const re = /Stream #0:\d+[^\n]*Audio[^\n]*\n(?:\s+Metadata:\s*\n(?:\s+\w+\s*:[^\n]*\n)*)?/g;
  let mm;
  while ((mm = re.exec(r.err))) { const t = /(?:title|handler_name)\s*:\s*([^\n]+)/.exec(mm[0]); const v = t ? t[1].trim() : ''; titles.push(v === 'SoundHandler' ? '' : v); }
  const vm = /Stream #0:\d+[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(r.err);
  const fm = /Stream #0:\d+[^\n]*Video:[^\n]*?(\d+(?:\.\d+)?) fps/.exec(r.err);
  return { duration: m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0, audio, titles, width: vm ? +vm[1] : 0, height: vm ? +vm[2] : 0, fps: fm ? Math.round(parseFloat(fm[1])) : 0 };
}
/* presný orez: video sa prekóduje (kľúčové snímky sú len každé 2 s), zvuk sa skopíruje */
async function trim(ffmpeg, file, a, b, out, enc) {
  const base = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', a.toFixed(3), '-i', file, '-t', Math.max(0.1, b - a).toFixed(3), '-map', '0', '-map_metadata', '0'];
  const tail = ['-c:a', 'copy', '-movflags', '+faststart', out];
  const encs = [];
  if (enc && enc.fam === 'nvenc') encs.push(['-c:v', enc.name, '-preset', 'p5', '-rc', 'vbr', '-cq', '18', '-b:v', '0']);
  else if (enc && enc.fam === 'amf') encs.push(['-c:v', enc.name, '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20']);
  else if (enc && enc.fam === 'qsv') encs.push(['-c:v', enc.name, '-global_quality', '18']);
  encs.push(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p']);
  let last = '';
  for (const v of encs) {
    const r = await run(ffmpeg, [...base, ...v, ...tail]);
    if (r.code === 0) return out;
    last = lastLine(r.err);
  }
  throw new Error(last || 'Orezanie zlyhalo');
}


/* ---------- editor ---------- */
/* vytiahni každú zvukovú stopu do samostatného súboru (bez prekódovania), aby ich editor mohol hrať zvlášť */
async function extractTracks(ffmpeg, file, outDir) {
  const info = await probe(ffmpeg, file);
  const meta = { duration: info.duration, width: info.width, height: info.height, fps: info.fps };
  if (!info.audio) return { ...meta, tracks: [] };
  fs.mkdirSync(outDir, { recursive: true });
  const tracks = [];
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', file];
  for (let i = 0; i < info.audio; i++) {
    const out = path.join(outDir, `a${i}.m4a`);
    tracks.push({ i, title: info.titles[i] || `Stopa ${i + 1}`, file: out });
    if (fs.existsSync(out) && fs.statSync(out).size > 0) continue;
    args.push('-map', `0:a:${i}`, '-c', 'copy', '-vn', out);
  }
  if (args.length > 6) {
    const r = await run(ffmpeg, args);
    if (r.code !== 0) throw new Error(lastLine(r.err) || 'Stopy sa nepodarilo pripraviť');
  }
  // obálka hlasitosti pre metre v editore: špička každých 50 ms, 0–255
  for (const t of tracks) {
    const lv = t.file.replace(/\.m4a$/, '.lvl');
    try {
      if (!fs.existsSync(lv)) fs.writeFileSync(lv, await envelope(ffmpeg, t.file));
      t.levels = fs.readFileSync(lv).toString('base64');
    } catch (e) { t.levels = ''; }
  }
  return { ...meta, tracks };
}
function envelope(ffmpeg, file) {
  return new Promise((resolve, reject) => {
    const RATE = 8000, STEP = 400; // 8 kHz mono zachytí aj výšky, 400 vzoriek = 50 ms
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', d => chunks.push(d));
    p.on('error', reject);
    p.on('close', code => {
      if (code !== 0) return reject(new Error('envelope'));
      const buf = Buffer.concat(chunks), n = Math.floor(buf.length / 2), out = Buffer.alloc(Math.ceil(n / STEP));
      for (let i = 0, k = 0; i < n; i += STEP, k++) {
        let pk = 0;
        for (let j = i; j < Math.min(n, i + STEP); j++) { const v = Math.abs(buf.readInt16LE(j * 2)); if (v > pk) pk = v; }
        out[k] = Math.min(255, Math.round(pk / 32768 * 255));
      }
      resolve(out);
    });
  });
}

function videoEncArgs(enc) {
  if (enc && enc.fam === 'nvenc') return ['-c:v', enc.name, '-preset', 'p5', '-rc', 'vbr', '-cq', '18', '-b:v', '0'];
  if (enc && enc.fam === 'amf') return ['-c:v', enc.name, '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'];
  if (enc && enc.fam === 'qsv') return ['-c:v', enc.name, '-global_quality', '18'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'];
}

/* uloženie z editora: sekvencia segmentov (aj z rôznych klipov) + overlaye + mix stôp
   job = { out, W, H, fps,
           segments: [{ file, in, out, audio }],      audio = počet zvukových stôp v tom klipe
           overlays: [{ png, start, end }],            čas na výslednej časovej osi
           tracks: [{ i, vol, title }],                ktoré stopy počuť (index podľa poradia)
           allTracks: [titles], keepTracks }           */
async function exportSequence(ffmpeg, job, enc, onProgress) {
  const segs = job.segments.filter(s => s.out - s.in > 0.05);
  if (!segs.length) throw new Error('Časová os je prázdna');
  const W = job.W % 2 ? job.W + 1 : job.W, H = job.H % 2 ? job.H + 1 : job.H, F = job.fps || 60;
  // výrez (napr. 9:16 na výšku): každý úsek má vlastnú vodorovnú polohu výrezu, text a šípky sú už v súradniciach výrezu
  const CW = job.cropW ? Math.min(W, Math.max(16, Math.round(job.cropW / 2) * 2)) : W;
  const T = job.allTracks.length;
  const spd = s => Math.max(0.25, Math.min(4, Number(s.speed) || 1));
  const od = s => (s.out - s.in) / spd(s); // dĺžka úseku vo výsledku
  const total = segs.reduce((a, s) => a + od(s), 0);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats'];
  segs.forEach(s => args.push('-ss', s.in.toFixed(3), '-t', (s.out - s.in).toFixed(3), '-i', s.file));
  // overlaye ako slučka obrázka po celú dĺžku → čas vstupu = čas výsledku (potrebné pre animácie)
  job.overlays.forEach(o => args.push('-loop', '1', '-framerate', String(F), '-t', total.toFixed(3), '-i', o.png));
  // posun zvukových stôp z editora (ms, kladné = stopa meškala → berie sa zvuk o kúsok neskôr): vlastný vstup s iným -ss
  let nIn = segs.length + job.overlays.length;
  const offs = job.offsets || {}, extra = {};
  const shiftIn = (k, s, ms) => {
    const key = k + '|' + ms;
    if (!(key in extra)) {
      const st = s.in + ms / 1000;
      args.push('-ss', Math.max(0, st).toFixed(3), '-t', (s.out - s.in - Math.min(0, st)).toFixed(3), '-i', s.file);
      extra[key] = { idx: nIn++, pad: st < 0 ? -st : 0 };
    }
    return extra[key];
  };
  const fc = [];
  const cin = [];
  // atempo zvláda 0.5–2, menšie/väčšie rýchlosti reťazíme
  const atempo = r => { const f = []; while (r < 0.5) { f.push('atempo=0.5'); r /= 0.5; } while (r > 2) { f.push('atempo=2'); r /= 2; } if (Math.abs(r - 1) > 1e-3) f.push(`atempo=${r.toFixed(4)}`); return f; };
  segs.forEach((s, k) => {
    const D = od(s), d = D.toFixed(3), r = spd(s), F2 = Math.min(0.5, D / 3);
    const n4 = v => Math.max(0, Math.min(1, Number(v) || 0)).toFixed(4);
    const rg = job.region && Number(job.region.w) > 0 && Number(job.region.h) > 0 ? { x: n4(job.region.x), y: n4(job.region.y), w: n4(job.region.w), h: n4(job.region.h) } : null;
    // oblasť záznamu (napr. len okno hry): výrez v pomere k rozmeru zdroja, potom zjednotenie na W×H
    const rgf = rg ? [`crop=trunc(iw*${rg.w}/2)*2:trunc(ih*${rg.h}/2)*2:trunc(iw*${rg.x}):trunc(ih*${rg.y})`] : [];
    const vf = [`setpts=(PTS-STARTPTS)/${r}`, `fps=${F}`, ...rgf, `scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', 'format=yuv420p'];
    if (CW < W) vf.push(`crop=${CW}:${H}:${Math.max(0, Math.min(W - CW, Math.round((s.cropX != null ? Number(s.cropX) : (W - CW) / 2) / 2) * 2))}:0`);
    if (s.fadeIn) vf.push(`fade=t=in:st=0:d=${F2.toFixed(3)}`);
    if (s.fadeOut) vf.push(`fade=t=out:st=${(D - F2).toFixed(3)}:d=${F2.toFixed(3)}`);
    // rôzne rozlíšenia zjednotíme: zmenšiť do rámu + čierne pásy, rovnaké fps; rýchlosť cez setpts
    fc.push(`[${k}:v]${vf.join(',')}[v${k}]`);
    cin.push(`[v${k}]`);
    const af = [];
    if (s.fadeIn) af.push(`afade=t=in:st=0:d=${F2.toFixed(3)}`);
    if (s.fadeOut) af.push(`afade=t=out:st=${(D - F2).toFixed(3)}:d=${F2.toFixed(3)}`);
    for (let i = 0; i < T; i++) {
      const ms = Math.round(Number(offs[i]) || 0);
      if (i < (s.audio || 0) && ms) {
        const x = shiftIn(k, s, ms);
        fc.push(`[${x.idx}:a:${i}]${['aformat=sample_rates=48000:channel_layouts=stereo', 'asetpts=PTS-STARTPTS', ...(x.pad ? [`adelay=${Math.round(x.pad * 1000)}:all=1`] : []), ...atempo(r), `apad=whole_dur=${d}`, `atrim=duration=${d}`, ...af].join(',')}[a${k}_${i}]`);
      } else if (i < (s.audio || 0)) fc.push(`[${k}:a:${i}]${['aformat=sample_rates=48000:channel_layouts=stereo', 'asetpts=PTS-STARTPTS', ...atempo(r), `apad=whole_dur=${d}`, `atrim=duration=${d}`, ...af].join(',')}[a${k}_${i}]`);
      else fc.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[a${k}_${i}]`); // klip túto stopu nemá → ticho
      cin.push(`[a${k}_${i}]`);
    }
  });
  const couts = ['[cv]', ...Array.from({ length: T }, (_, i) => `[ca${i}]`)];
  fc.push(`${cin.join('')}concat=n=${segs.length}:v=1:a=${T}${couts.join('')}`);
  let v = 'cv';
  job.overlays.forEach((o, k) => {
    const s = Math.max(0, o.start), e = Math.min(total, o.end), S = s.toFixed(3), E = e.toFixed(3);
    const inp = `[${segs.length + k}:v]`;
    if (o.cx == null) { // starý formát: PNG cez celý obraz
      fc.push(`[${v}]${inp}overlay=0:0:eof_action=repeat:enable='between(t,${S},${E})'[o${k}]`);
    } else {
      // animácie (rovnaké krivky ako náhľad v editore): fade cez alfu, pop = zväčšenie s prestrelením, zdola = posun
      const f = ['format=rgba'];
      if (o.animIn && o.animIn !== 'none') f.push(`fade=t=in:st=${S}:d=${o.animIn === 'pop' ? 0.2 : 0.35}:alpha=1`);
      if (o.animOut === 'fade') f.push(`fade=t=out:st=${Math.max(s, e - 0.3).toFixed(3)}:d=0.3:alpha=1`);
      if (o.animIn === 'pop') {
        const P = `clip((t-${S})/0.35,0,1)`;
        const sc = `(0.5+0.5*(1+2.70158*pow(${P}-1,3)+1.70158*pow(${P}-1,2)))`;
        f.push(`scale=w='max(2,trunc(iw*${sc}/2)*2)':h='max(2,trunc(ih*${sc}/2)*2)':eval=frame`);
      }
      const dy = o.animIn === 'slide' ? `+pow(1-clip((t-${S})/0.4,0,1),3)*${(H * 0.05).toFixed(1)}` : '';
      fc.push(`${inp}${f.join(',')}[ov${k}]`);
      fc.push(`[${v}][ov${k}]overlay=x='${o.cx.toFixed(1)}-overlay_w/2':y='${o.cy.toFixed(1)}-overlay_h/2${dy}':eval=frame:enable='between(t,${S},${E})'[o${k}]`);
    }
    v = `o${k}`;
  });
  fc.push(`[${v}]format=yuv420p[vout]`);
  const maps = ['-map', '[vout]'];
  const titles = [];
  const on = job.tracks.filter(t => t.vol > 0 && t.i < T);
  const onSet = new Set(on.map(t => t.i));
  // každú spojenú stopu použi: do mixu, ako samostatnú stopu, oboje alebo nikam (anullsink)
  const mixIn = {}, keepIn = {};
  for (let i = 0; i < T; i++) {
    const inMix = onSet.has(i), keep = job.keepTracks;
    if (inMix && keep) { fc.push(`[ca${i}]asplit=2[cm${i}][ck${i}]`); mixIn[i] = `cm${i}`; keepIn[i] = `ck${i}`; }
    else if (inMix) mixIn[i] = `ca${i}`;
    else if (keep) keepIn[i] = `ca${i}`;
    else fc.push(`[ca${i}]anullsink`);
  }
  if (on.length) {
    on.forEach((t, k) => fc.push(`[${mixIn[t.i]}]volume=${t.vol.toFixed(3)}[m${k}]`));
    fc.push(on.length > 1 ? `${on.map((_, k) => `[m${k}]`).join('')}amix=inputs=${on.length}:duration=first:normalize=0[aout]` : `[m0]anull[aout]`);
    maps.push('-map', '[aout]');
    titles.push(on.length === T && T > 1 ? 'Mix' : on.map(t => t.title).join(' + '));
  }
  if (job.keepTracks) for (let i = 0; i < T; i++) { maps.push('-map', `[${keepIn[i]}]`); titles.push(job.allTracks[i]); }
  const head = [...args, '-filter_complex', fc.join(';'), ...maps];
  const tail = [];
  if (titles.length) tail.push('-c:a', 'aac', '-b:a', '192k');
  titles.forEach((n, i) => tail.push(`-metadata:s:a:${i}`, `title=${n}`, `-metadata:s:a:${i}`, `handler_name=${n}`));
  tail.push('-movflags', '+faststart', job.out);

  const tryRun = a => new Promise(resolve => {
    let err = '', buf = '';
    const p = spawn(ffmpeg, a, { windowsHide: true });
    p.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/out_time_us=(\d+)/g);
      if (m) { const us = Number(m[m.length - 1].split('=')[1]); if (onProgress) onProgress(Math.min(1, us / 1e6 / total)); buf = buf.slice(-200); }
    });
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => resolve({ code: -1, err: e.message }));
    p.on('close', code => resolve({ code, err }));
  });
  let r = await tryRun([...head, ...videoEncArgs(enc), ...tail]);
  if (r.code !== 0 && enc && enc.fam !== 'x264') r = await tryRun([...head, ...videoEncArgs(null), ...tail]); // HW zlyhal → procesor
  if (r.code !== 0) throw new Error(lastLine(r.err) || 'Uloženie zlyhalo');
  return job.out;
}


/* ---------- kompresia na cieľovú veľkosť (napr. 20 MB pre Discord) ----------
   job = { file, out, targetMB, plan, tmpDir }; HW enkodér + kontrola veľkosti, keď prestrelí, ide znova s menším tokom.
   Bez HW (alebo keď nevyjde) x264 v dvoch prechodoch, ten trafí veľkosť najpresnejšie. */
async function compressClip(ffmpeg, job, enc, onProgress) {
  const { plan } = job;
  const limit = job.targetMB * 1e6;
  const info = await probe(ffmpeg, job.file);
  const D = info.duration || 1;
  const vf = `scale=-2:${plan.height}:flags=lanczos,fps=${plan.fps},format=yuv420p`;
  const audio = plan.akbps > 0 && info.audio > 0 ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', `${plan.akbps}k`, '-ac', '2'] : ['-an'];
  const runP = (args, part, parts) => new Promise(resolve => {
    let err = '', buf = '';
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true });
    p.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/out_time_us=(\d+)/g);
      if (m) { const us = Number(m[m.length - 1].split('=')[1]); if (onProgress) onProgress(Math.min(1, (part + Math.min(1, us / 1e6 / D)) / parts)); buf = buf.slice(-200); }
    });
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => resolve({ code: -1, err: e.message }));
    p.on('close', code => resolve({ code, err }));
  });
  const size = () => { try { return fs.statSync(job.out).size; } catch (e) { return 0; } };

  // 1) HW enkodér s riadeným tokom, max 3 pokusy
  if (enc && enc.fam !== 'x264') {
    let vk = plan.vkbps;
    for (let attempt = 0; attempt < 3; attempt++) {
      const v = ['-c:v', enc.name, '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.3)}k`, '-bufsize', `${vk * 2}k`];
      if (enc.fam === 'nvenc') v.push('-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-multipass', 'fullres', '-spatial-aq', '1');
      else if (enc.fam === 'amf') v.push('-rc', 'vbr_peak', '-quality', 'quality');
      else if (enc.fam === 'qsv') v.push('-preset', 'slower');
      const r = await runP(['-i', job.file, '-map', '0:v:0', '-vf', vf, ...v, '-g', String(plan.fps * 4), ...audio, '-movflags', '+faststart', job.out], 0, 1);
      if (r.code !== 0) break; // HW nejde → x264
      const got = size();
      if (got > 0 && got <= limit) return { out: job.out, size: got, encoder: enc.name };
      vk = Math.max(100, Math.floor(vk * (limit / got) * 0.93));
    }
  }
  // 2) x264, dva prechody
  fs.mkdirSync(job.tmpDir, { recursive: true });
  const log = path.join(job.tmpDir, 'pass');
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  let vk = plan.vkbps;
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = ['-i', job.file, '-map', '0:v:0', '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${vk}k`, '-passlogfile', log, '-g', String(plan.fps * 4)];
    let r = await runP([...base, '-pass', '1', '-an', '-f', 'mp4', nul], 0, 2);
    if (r.code !== 0) throw new Error(lastLine(r.err) || 'Kompresia zlyhala');
    r = await runP([...base, '-pass', '2', ...audio, '-movflags', '+faststart', job.out], 1, 2);
    if (r.code !== 0) throw new Error(lastLine(r.err) || 'Kompresia zlyhala');
    const got = size();
    if (got <= limit) return { out: job.out, size: got, encoder: 'libx264' };
    vk = Math.max(100, Math.floor(vk * (limit / got) * 0.94));
  }
  return { out: job.out, size: size(), encoder: 'libx264', over: true };
}

module.exports = { compressClip, Engine, thumbnail, probe, trim, extractTracks, exportSequence, SEG, stamp };
