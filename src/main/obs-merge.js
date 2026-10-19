/* Spojí obraz z OBS so zvukovými stopami z LookAtThis.

   OBS (Game Capture) dodá len obraz hry. Zvuk má LookAtThis vo svojom buffri vždy, a to po stopách
   (systém, hra, Discord, mikrofón, mix). Pri klipe uložíme oboje naraz a zložíme:
     video = OBS,  zvuk = všetky stopy z klipu LookAtThis.

   Najťažšie je presne trafiť, ktorá sekunda zvuku patrí ku ktorej snímke. OBS preto nahráva aj
   zvuk počítača (len ako referenciu). Porovnáme ho so stopou „Systém“ z LookAtThis (korelácia
   obálky hlasitosti, presnosť ~1 ms) a z toho vieme posun. Keď je ticho a porovnať sa nedá,
   použijeme odhad podľa času uloženia. */
const { spawn } = require('child_process');

function runFF(ffmpeg, args) {
  return new Promise(resolve => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    const out = [], err = [];
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => err.push(d));
    p.on('error', e => resolve({ code: -1, out: Buffer.alloc(0), err: String(e.message) }));
    p.on('close', code => resolve({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString() }));
  });
}

/* „sila nástupu“ zvuku pri 1 kHz z posledných `win` sekúnd jednej stopy:
   priemer |x| na 1 ms, mínus kĺzavý priemer 40 ms, záporné = 0. Nezáleží tak na hlasitosti stopy. */
async function onsetEnvelope(ffmpeg, file, streamSel, win) {
  const r = await runFF(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-sseof', String(-win), '-i', file,
    '-map', streamSel, '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1']);
  if (r.code !== 0 || r.out.length < 8000 * 4) throw new Error('zvuk sa nedal prečítať (' + streamSel + ')');
  const buf = r.out.buffer.slice(r.out.byteOffset, r.out.byteOffset + (r.out.length - r.out.length % 4));
  const x = new Float32Array(buf);
  const n = Math.floor(x.length / 8), env = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 8; k++) s += Math.abs(x[i * 8 + k]); env[i] = s / 8; }
  const W = 40, on = new Float32Array(n); let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += env[i]; if (i >= W) acc -= env[i - W];
    const m = acc / Math.min(i + 1, W);
    on[i] = Math.max(0, env[i] - m);
  }
  return on;
}

/* nájdi d (s) také, že udalosť v čase tO v OBS je v čase tO + d v LookAtThis.
   a = obálka OBS (pokrýva [aStart, aStart+len]), b = obálka LookAtThis (pokrýva [bStart, ...]) */
function bestOffset(a, aStart, b, bStart, dMin, dMax) {
  const lo = Math.round(dMin * 1000), hi = Math.round(dMax * 1000);
  const aOff = Math.round(aStart * 1000), bOff = Math.round(bStart * 1000);
  const scores = [];
  let best = -Infinity, bestD = 0;
  for (let dm = lo; dm <= hi; dm++) {
    // OBS index i ↔ LAT index j = i + aOff + dm - bOff
    const shift = aOff + dm - bOff;
    const i0 = Math.max(0, -shift), i1 = Math.min(a.length, b.length - shift);
    if (i1 - i0 < 2000) { scores.push(0); continue; }   // aspoň 2 s prekryvu
    let sab = 0, saa = 0, sbb = 0;
    for (let i = i0; i < i1; i++) { const va = a[i], vb = b[i + shift]; sab += va * vb; saa += va * va; sbb += vb * vb; }
    const c = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
    scores.push(c);
    if (c > best) { best = c; bestD = dm; }
  }
  // istota: vrchol musí vyčnievať nad ostatné posuny
  const mean = scores.reduce((p, v) => p + v, 0) / (scores.length || 1);
  const sd = Math.sqrt(scores.reduce((p, v) => p + (v - mean) * (v - mean), 0) / (scores.length || 1)) || 1e-9;
  return { d: bestD / 1000, corr: best, z: (best - mean) / sd };
}

/**
 * @param o.ffmpeg   cesta k ffmpeg
 * @param o.probe    async (file) → { duration, audio }
 * @param o.obsFile  replay z OBS (video + referenčný zvuk počítača v stope 0)
 * @param o.latFile  klip z LookAtThis (video plochy + zvukové stopy)
 * @param o.latRef   index zvukovej stopy v latFile, ktorá zodpovedá zvuku počítača (Systém / Mix)
 * @param o.endGap   o koľko s neskôr skončil klip LookAtThis oproti OBS (odhad, keď sa nedá porovnať)
 * @param o.seconds  požadovaná dĺžka klipu (null = celé)
 */
async function mergeObsWithTracks(o) {
  const iv = await o.probe(o.obsFile), ia = await o.probe(o.latFile);
  const Dv = iv.duration, Da = ia.duration;
  if (!Dv || !Da) throw new Error('nepodarilo sa zistiť dĺžku klipov');
  if (!ia.audio) throw new Error('klip z LookAtThis nemá zvuk');

  // odhad: obe nahrávky končia „teraz“, LookAtThis o endGap neskôr
  const dEst = Da - Dv - (o.endGap || 0);
  let d = dEst, how = 'odhad';
  if (iv.audio) {
    try {
      const win = Math.min(20, Dv, Da);
      const a = await onsetEnvelope(o.ffmpeg, o.obsFile, '0:a:0', win);
      const b = await onsetEnvelope(o.ffmpeg, o.latFile, `0:a:${o.latRef || 0}`, win + 4);
      const r = bestOffset(a, Dv - a.length / 1000, b, Da - b.length / 1000, dEst - 2, dEst + 2);
      if (r.corr >= 0.2 && r.z >= 5) { d = r.d; how = `podľa zvuku, zhoda ${r.corr.toFixed(2)}`; }
      else how = `odhad (zvuk sa nedal porovnať, zhoda ${r.corr.toFixed(2)})`;
    } catch (e) { how = 'odhad (' + e.message + ')'; }
  }

  const S = o.seconds ? Math.min(o.seconds, Dv) : Dv;
  const vss = Math.max(0, Dv - S);         // pri kratšom klipe odstrihni začiatok obrazu
  const ass = d + vss;                     // zodpovedajúci čas v klipe LookAtThis
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (vss > 0.05) args.push('-ss', vss.toFixed(3));
  args.push('-i', o.obsFile);
  if (ass >= 0) args.push('-ss', ass.toFixed(3));
  else args.push('-itsoffset', (-ass).toFixed(3));   // zvuk začína neskôr ako obraz (na začiatku ticho)
  args.push('-t', S.toFixed(3), '-i', o.latFile,
    '-map', '0:v:0', '-map', '1:a', '-c:v', 'copy',
    // zvuk prekódujeme: strih na presnú vzorku (kopírovaný zvuk by sa zarovnal na kľúčovú snímku videa)
    '-c:a', 'aac', '-b:a', '192k');
  if (o.comment) args.push('-metadata', 'comment=' + o.comment);
  // posun všetkých stôp rovnako → synchronizácia ostane, aj keď obraz začne na kľúčovej snímke skôr
  args.push('-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', o.out);
  const r = await runFF(o.ffmpeg, args);
  if (r.code !== 0) throw new Error('ffmpeg: ' + (r.err.trim().split(/\r?\n/).pop() || r.code));
  return { d, how, tracks: ia.audio, seconds: S };
}

module.exports = { mergeObsWithTracks, bestOffset, onsetEnvelope };
