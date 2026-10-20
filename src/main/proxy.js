/* Náhľadové kópie (proxy) pre editory.

   Prečo: klipy z bufferu majú kľúčovú snímku každé 2 s (pri 60 fps = 120 snímok). Keď skočíš doprostred,
   prehrávač musí dekódovať všetko od poslednej kľúčovej snímky — pri 1440p60 to trvá citeľne a pri ťahaní
   po časovej osi to vyťaží procesor. Proxy je tá istá stopa obrazu v 720p s kľúčovou snímkou každých
   ~0,25 s, kódovaná na grafike (NVENC/AMF/QSV). Skok je potom okamžitý a náhľad nič nestojí.
   Export vždy berie pôvodný súbor, proxy slúži len na náhľad. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function encArgs(fam) {
  if (fam === 'nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'vbr', '-cq', '27', '-b:v', '0', '-bf', '0'];
  if (fam === 'amf') return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '26', '-qp_p', '28', '-bf', '0'];
  if (fam === 'qsv') return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '27'];
  return ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '26', '-bf', '0'];
}

function run(ffmpeg, args) {
  return new Promise(resolve => {
    let err = '';
    const p = spawn(ffmpeg, args, { windowsHide: true });
    p.stderr.on('data', d => { err = (err + d).slice(-3000); });
    p.on('error', e => resolve({ code: -1, err: e.message }));
    p.on('close', code => resolve({ code, err }));
    // proxy má nízku prioritu, nech nebrzdí hru ani buffer
    try { if (process.platform === 'win32') require('os').setPriority(p.pid, require('os').constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { }
  });
}

class Proxies {
  constructor({ ffmpeg, dir, log, pickFam }) {
    this.ffmpeg = ffmpeg; this.dir = dir; this.log = log || { info() {}, warn() {} }; this.pickFam = pickFam;
    this.jobs = new Map();   // kľúč → Promise<cesta>
    this.queue = Promise.resolve();
  }
  key(file) { const st = fs.statSync(file); return crypto.createHash('sha1').update(file + '|' + st.mtimeMs + '|' + st.size).digest('hex').slice(0, 16); }
  /* vráti cestu k proxy (hneď, ak už existuje; inak ju vyrobí — jedna naraz, v poradí) */
  get(file) {
    const k = this.key(file);
    const out = path.join(this.dir, k + '.mp4');
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return Promise.resolve(out);
    if (this.jobs.has(k)) return this.jobs.get(k);
    const job = this.queue.then(() => this.make(file, out));
    this.queue = job.catch(() => { });
    this.jobs.set(k, job);
    job.finally(() => this.jobs.delete(k));
    return job;
  }
  async make(file, out) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = out.replace(/\.mp4$/, '.part.mp4');
    const fam = this.pickFam ? this.pickFam() : null;
    const vf = "scale=-2:'min(720,ih)':flags=fast_bilinear,format=yuv420p";
    // kľúčová snímka každých 15 snímok (pri 60 fps = 0,25 s)
    const common = ['-map', '0:v:0', '-vf', vf, '-g', '15', '-keyint_min', '15', '-an', '-sn', '-movflags', '+faststart', tmp];
    const t0 = Date.now();
    const tries = [
      ['-hide_banner', '-loglevel', 'error', '-y', '-hwaccel', 'auto', '-i', file, ...encArgs(fam), ...common],
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, ...encArgs(fam), ...common],
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, ...encArgs(null), ...common]
    ];
    let r;
    for (const a of tries) { r = await run(this.ffmpeg, a); if (r.code === 0) break; }
    if (r.code !== 0) { try { fs.unlinkSync(tmp); } catch (e) { } throw new Error('proxy: ' + (String(r.err).trim().split(/\r?\n/).pop() || r.code)); }
    fs.renameSync(tmp, out);
    this.log.info(`proxy hotová za ${((Date.now() - t0) / 1000).toFixed(1)} s: ${path.basename(file)}`);
    this.prune();
    return out;
  }
  /* drž priečinok do ~6 GB, najstaršie preč */
  prune() {
    try {
      const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.mp4') && !f.includes('.part')).map(f => { const p = path.join(this.dir, f), st = fs.statSync(p); return { p, t: st.atimeMs || st.mtimeMs, s: st.size }; }).sort((a, b) => b.t - a.t);
      let sum = 0;
      for (const f of files) { sum += f.s; if (sum > 6e9) try { fs.unlinkSync(f.p); } catch (e) { } }
    } catch (e) { }
  }
}

module.exports = { Proxies };
