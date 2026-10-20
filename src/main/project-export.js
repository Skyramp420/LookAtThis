/* Export z advanced editora (časová os s voľne umiestnenými položkami na stopách).

   job = {
     out, W, H, fps, duration,
     video:   [{ file, start, in, out, speed, srcW, srcH, fit: 'fit'|'cover', zoom, cx, cy, fadeIn, fadeOut }],
     audio:   [{ file, stream, lane, start, in, out, speed, vol, fadeIn, fadeOut }],
     lanes:   [{ id, title }]            poradie samostatných stôp (keepTracks)
     overlays:[{ png, cx, cy, start, end, animIn, animOut }],
     keepTracks
   }
   Video: čierne plátno W×H, na ňom každá položka v jej čase (overlay s posunom PTS).
   Zvuk:  každá položka zvlášť (vlastný -ss/-t), posun cez adelay, mix po stopách → hlavný mix
          (+ voliteľne každá stopa ako samostatná zvuková stopa pre strihový program). */
const { spawn } = require('child_process');

const even = x => Math.max(2, Math.round(x / 2) * 2);
const clamp01 = x => Math.max(0, Math.min(1, Number(x)));
const spd = x => Math.max(0.25, Math.min(4, Number(x) || 1));
const n3 = x => Number(x).toFixed(3);
function atempo(r) {
  const f = [];
  while (r < 0.5) { f.push('atempo=0.5'); r /= 0.5; }
  while (r > 2) { f.push('atempo=2'); r /= 2; }
  if (Math.abs(r - 1) > 1e-3) f.push(`atempo=${r.toFixed(4)}`);
  return f;
}

/* filtre pre jednu video položku: rýchlosť, fps, zmenšenie/orez do rámu (rovnako ako náhľad v editore) */
function videoChain(it, W, H, F) {
  const len = it.out - it.in, r = spd(it.speed), od = len / r;
  const z = Math.max(1, Math.min(4, Number(it.zoom) || 1));
  const cx = it.cx == null ? 0.5 : clamp01(it.cx), cy = it.cy == null ? 0.5 : clamp01(it.cy);
  const f = [`setpts=(PTS-STARTPTS)/${r}`, `fps=${F}`];
  const tw = W * z, th = H * z;
  if (it.srcW > 0 && it.srcH > 0) {
    // presné čísla: zmenši zdroj do (cover = vyplniť, fit = zmestiť) rámu × zoom, vyrež okno W×H podľa cx/cy, zvyšok čierny
    const s = it.fit === 'cover' ? Math.max(tw / it.srcW, th / it.srcH) : Math.min(tw / it.srcW, th / it.srcH);
    const sw = even(it.srcW * s), sh = even(it.srcH * s);
    const cw = Math.min(sw, W), ch = Math.min(sh, H);
    const x = Math.round((sw - cw) * cx / 2) * 2, y = Math.round((sh - ch) * cy / 2) * 2;
    f.push(`scale=${sw}:${sh}`);
    if (cw < sw || ch < sh) f.push(`crop=${cw}:${ch}:${x}:${y}`);
    if (cw < W || ch < H) f.push(`pad=${W}:${H}:${(W - cw) / 2 | 0}:${(H - ch) / 2 | 0}:color=black`);
  } else {
    f.push(`scale=${even(tw)}:${even(th)}:force_original_aspect_ratio=${it.fit === 'cover' ? 'increase' : 'decrease'}:force_divisible_by=2`,
      `crop='min(iw,${W})':'min(ih,${H})':'(iw-min(iw,${W}))*${cx}':'(ih-min(ih,${H}))*${cy}'`,
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`);
  }
  f.push('setsar=1', 'format=yuv420p');
  const F2 = Math.min(0.5, od / 3);
  if (it.fadeIn) f.push(`fade=t=in:st=0:d=${n3(F2)}`);
  if (it.fadeOut) f.push(`fade=t=out:st=${n3(od - F2)}:d=${n3(F2)}`);
  f.push(`setpts=PTS+${n3(it.start)}/TB`);
  return f;
}

function buildArgs(job, encArgs) {
  const W = even(job.W), H = even(job.H), F = job.fps || 60;
  const video = (job.video || []).filter(v => v.out - v.in > 0.03);
  const audio = (job.audio || []).filter(a => a.out - a.in > 0.03 && a.vol > 0);
  const D = Math.max(0.2, Number(job.duration) || 0);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats'];
  const fc = [];
  let nIn = 0;

  // obraz
  fc.push(`color=c=black:s=${W}x${H}:r=${F}:d=${n3(D)},format=yuv420p[base]`);
  let v = 'base';
  video.forEach((it, k) => {
    args.push('-ss', n3(it.in), '-t', n3(it.out - it.in), '-i', it.file);
    const idx = nIn++;
    fc.push(`[${idx}:v]${videoChain(it, W, H, F).join(',')}[vi${k}]`);
    fc.push(`[${v}][vi${k}]overlay=eof_action=pass:repeatlast=0[vb${k}]`);
    v = `vb${k}`;
  });

  // text (PNG) s animáciami — rovnaké krivky ako náhľad
  (job.overlays || []).forEach((o, k) => {
    args.push('-loop', '1', '-framerate', String(F), '-t', n3(D), '-i', o.png);
    const idx = nIn++;
    const s = Math.max(0, o.start), e = Math.min(D, o.end), S = n3(s), E = n3(e);
    const f = ['format=rgba'];
    if (o.animIn && o.animIn !== 'none') f.push(`fade=t=in:st=${S}:d=${o.animIn === 'pop' ? 0.2 : 0.35}:alpha=1`);
    if (o.animOut === 'fade') f.push(`fade=t=out:st=${n3(Math.max(s, e - 0.3))}:d=0.3:alpha=1`);
    if (o.animIn === 'pop') {
      const P = `clip((t-${S})/0.35,0,1)`;
      const sc = `(0.5+0.5*(1+2.70158*pow(${P}-1,3)+1.70158*pow(${P}-1,2)))`;
      f.push(`scale=w='max(2,trunc(iw*${sc}/2)*2)':h='max(2,trunc(ih*${sc}/2)*2)':eval=frame`);
    }
    const dy = o.animIn === 'slide' ? `+pow(1-clip((t-${S})/0.4,0,1),3)*${(H * 0.05).toFixed(1)}` : '';
    fc.push(`[${idx}:v]${f.join(',')}[tx${k}]`);
    fc.push(`[${v}][tx${k}]overlay=x='${Number(o.cx).toFixed(1)}-overlay_w/2':y='${Number(o.cy).toFixed(1)}-overlay_h/2${dy}':eval=frame:enable='between(t,${S},${E})'[to${k}]`);
    v = `to${k}`;
  });
  fc.push(`[${v}]format=yuv420p[vout]`);

  // zvuk: položky → stopy → mix
  const byLane = new Map();
  audio.forEach((a, k) => {
    args.push('-ss', n3(a.in), '-t', n3(a.out - a.in), '-i', a.file);
    const idx = nIn++;
    const r = spd(a.speed), od = (a.out - a.in) / r, F2 = Math.min(0.5, od / 3);
    const f = ['aformat=sample_rates=48000:channel_layouts=stereo', 'asetpts=PTS-STARTPTS', ...atempo(r)];
    if (Math.abs(a.vol - 1) > 1e-3) f.push(`volume=${Number(a.vol).toFixed(3)}`);
    if (a.fadeIn) f.push(`afade=t=in:st=0:d=${n3(F2)}`);
    if (a.fadeOut) f.push(`afade=t=out:st=${n3(od - F2)}:d=${n3(F2)}`);
    if (a.start > 0.0005) f.push(`adelay=${Math.round(a.start * 1000)}:all=1`);
    fc.push(`[${idx}:a:${a.stream || 0}]${f.join(',')}[ai${k}]`);
    if (!byLane.has(a.lane)) byLane.set(a.lane, []);
    byLane.get(a.lane).push(`[ai${k}]`);
  });
  const laneOrder = (job.lanes || []).filter(l => byLane.has(l.id));
  for (const id of byLane.keys()) if (!laneOrder.some(l => l.id === id)) laneOrder.push({ id, title: id });
  const keep = !!job.keepTracks && laneOrder.length > 1;
  const mixIn = [], keepOut = [];
  laneOrder.forEach((l, i) => {
    const ins = byLane.get(l.id);
    const mixed = ins.length > 1 ? `${ins.join('')}amix=inputs=${ins.length}:duration=longest:normalize=0,` : `${ins[0]}`;
    const body = ins.length > 1 ? mixed : `${ins[0]}anull,`;
    fc.push(`${body}apad=whole_dur=${n3(D)},atrim=duration=${n3(D)}[L${i}]`);
    if (keep) { fc.push(`[L${i}]asplit=2[Lm${i}][Lk${i}]`); mixIn.push(`[Lm${i}]`); keepOut.push({ lab: `[Lk${i}]`, title: l.title }); }
    else mixIn.push(`[L${i}]`);
  });
  const maps = ['-map', '[vout]'];
  const titles = [];
  if (mixIn.length) {
    fc.push(mixIn.length > 1 ? `${mixIn.join('')}amix=inputs=${mixIn.length}:duration=longest:normalize=0[amix]` : `${mixIn[0]}anull[amix]`);
    maps.push('-map', '[amix]'); titles.push('Mix');
    keepOut.forEach(k => { maps.push('-map', k.lab); titles.push(k.title); });
  }
  const tail = ['-t', n3(D), '-r', String(F)];
  if (titles.length) tail.push('-c:a', 'aac', '-b:a', '192k');
  titles.forEach((n, i) => tail.push(`-metadata:s:a:${i}`, `title=${n}`, `-metadata:s:a:${i}`, `handler_name=${n}`));
  if (titles.length) tail.push('-disposition:a:0', 'default');
  tail.push('-metadata', 'comment=LookAtThis · advanced editor', '-movflags', '+faststart', job.out);
  return [...args, '-filter_complex', fc.join(';'), ...maps, ...encArgs, ...tail];
}

function run(ffmpeg, args, D, onProgress) {
  return new Promise(resolve => {
    let err = '', buf = '';
    const p = spawn(ffmpeg, args, { windowsHide: true });
    p.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/out_time_us=(\d+)/g);
      if (m) { const us = Number(m[m.length - 1].split('=')[1]); if (onProgress) onProgress(Math.min(1, us / 1e6 / D)); buf = buf.slice(-200); }
    });
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => resolve({ code: -1, err: e.message }));
    p.on('close', code => resolve({ code, err }));
  });
}

/* videoEncArgs(enc) z engine; keď HW enkodér zlyhá, skúsi to procesor */
async function exportProject(ffmpeg, job, enc, videoEncArgs, onProgress) {
  if (!(job.video || []).length && !(job.audio || []).length && !(job.overlays || []).length) throw new Error('Časová os je prázdna');
  const D = Math.max(0.2, Number(job.duration) || 0);
  let r = await run(ffmpeg, buildArgs(job, videoEncArgs(enc)), D, onProgress);
  if (r.code !== 0 && enc && enc.fam !== 'x264') r = await run(ffmpeg, buildArgs(job, videoEncArgs(null)), D, onProgress);
  if (r.code !== 0) throw new Error((String(r.err).trim().split(/\r?\n/).pop()) || 'Export zlyhal');
  return job.out;
}

module.exports = { exportProject, buildArgs, videoChain };
