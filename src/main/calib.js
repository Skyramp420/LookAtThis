/* Synchronizácia mikrofónu tlieskaním.
   Appka prehrá rytmus (tiky), ty tlieskaš do rytmu. Tiky sa nahrajú do stopy Systém (digitálne, bez
   oneskorenia), tlesknutia do stopy Mikrofón (s oneskorením VST, Sonaru…). Rozdiel = oneskorenie mikrofónu.
   Čisté funkcie bez Electronu, aby sa dali otestovať. */

/* obálka: špička absolútnej hodnoty v oknách po winMs */
function envelope(pcm, rate, winMs = 1) {
  const w = Math.max(1, Math.round(rate * winMs / 1000)), n = Math.floor(pcm.length / w);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * w, e = j + w; j < e; j++) { const v = Math.abs(pcm[j]); if (v > m) m = v; } env[i] = m; }
  return { env, winMs };
}
/* nábehy hlasitosti (začiatky úderov) v ms */
function onsets(pcm, rate, { rel = 0.3, gapMs = 220 } = {}) {
  const { env, winMs } = envelope(pcm, rate, 1);
  if (!env.length) return [];
  const sorted = Float32Array.from(env).sort();
  const floor = sorted[Math.floor(sorted.length * 0.5)] || 0, peak = sorted[sorted.length - 1] || 0;
  if (peak < 300) return []; // ticho (16-bit)
  const th = Math.max(floor * 6, floor + (peak - floor) * rel);
  const out = [];
  let last = -1e9;
  for (let i = 1; i < env.length; i++) {
    if (env[i] >= th && env[i - 1] < th && (i - last) * winMs >= gapMs) {
      // spresni: kde signál prvýkrát presiahol štvrtinu prahu tesne pred prekročením
      let k = i; const lo = Math.max(floor * 3, th * 0.25);
      while (k > 0 && i - k < 15 && env[k - 1] >= lo) k--;
      out.push(k * winMs); last = i;
    }
  }
  return out;
}
/* tiky: hľadáme rad úderov s presným rozstupom (appka ich hrá presne podľa hodín zvukovej karty) */
function findTicks(on, interval, count) {
  let best = null;
  for (let a = 0; a < on.length; a++) {
    const chain = [on[a]];
    for (let k = 1; k < count; k++) {
      const want = on[a] + k * interval;
      const hit = on.find(x => Math.abs(x - want) <= 25);
      if (hit != null) chain.push(hit);
    }
    if (!best || chain.length > best.length) best = chain;
  }
  if (!best || best.length < Math.ceil(count * 0.6)) return null;
  // presné časy tikov dopočítaj z prvého a rozstupu (spoľahlivejšie než jednotlivé nábehy)
  const t0 = best[0];
  return Array.from({ length: count }, (_, k) => t0 + k * interval);
}
/* úzke pásmo okolo frekvencie tiku: tik vynikne aj cez hluk hry alebo odposluch mikrofónu */
function bandpass(pcm, rate, f0, Q = 6) {
  const w = 2 * Math.PI * f0 / rate, al = Math.sin(w) / (2 * Q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  const out = new Int16Array(pcm.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i], y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = Math.max(-32768, Math.min(32767, y));
  }
  return out;
}
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* horná priepusť: tlesknutie má veľa výšok, hlas a dunenie menej */
function highpass(pcm, rate, fc = 900) {
  const a = 1 / (1 + 2 * Math.PI * fc / rate), out = new Int16Array(pcm.length);
  let px = 0, py = 0;
  for (let i = 0; i < pcm.length; i++) { const y = a * (py + pcm[i] - px); px = pcm[i]; py = y; out[i] = Math.max(-32768, Math.min(32767, y)); }
  return out;
}
function peakDb(pcm, rate, fromMs, toMs) {
  let m = 0;
  for (let i = Math.max(0, Math.floor(fromMs * rate / 1000)), e = Math.min(pcm.length, Math.floor(toMs * rate / 1000)); i < e; i++) { const v = Math.abs(pcm[i]); if (v > m) m = v; }
  return m ? Math.round(20 * Math.log10(m / 32768)) : -96;
}

/* sys, mic: Int16Array mono; interval a count = rozstup a počet tikov; clapFrom = od ktorého tiku sa tlieska */
function analyze(sys, mic, rate, { interval = 600, count = 8, clapFrom = 4, tickHz = 1600, maxLate = 1500, maxEarly = 4000 } = {}) {
  const ticks = findTicks(onsets(bandpass(sys, rate, tickHz), rate, { rel: 0.35, gapMs: 250 }), interval, count);
  if (!ticks) return { ok: false, reason: 'ticks', msg: 'V stope Systém som nenašiel údery. Je stopa Systém zapnutá a nastavená na zariadenie, z ktorého ich počuješ?' };
  const target = ticks.slice(clapFrom);
  // hľadáme so širokou rezervou: mikrofón cez VST/Sonar môže meškať stovky ms a pri chybe zosúladenia aj predbiehať
  const lo = target[0] - maxEarly, hi = target[target.length - 1] + maxLate;
  const db = peakDb(mic, rate, lo, hi);
  const claps = onsets(highpass(mic, rate), rate, { rel: 0.25, gapMs: 200 }).filter(c => c > lo && c < hi);
  if (claps.length < 2) {
    return db < -42
      ? { ok: false, reason: 'quiet', micDb: db, msg: `Mikrofón počas tlieskania skoro nič nenahral (najviac ${db} dB). Ak máš zapnuté potlačenie šumu (NVIDIA Broadcast, Krisp, ClearCast v Sonare…), tlesknutia často úplne odfiltruje. Skús ho na chvíľu vypnúť, alebo skontroluj, či je v stope Mikrofón správne zariadenie.` }
      : { ok: false, reason: 'claps', micDb: db, msg: `Mikrofón niečo nahral (najviac ${db} dB), ale nenašiel som v tom ostré tlesknutia. Tlieskaj kratšie a ostrejšie, alebo na chvíľu vypni potlačenie šumu či kompresor.` };
  }
  // nájdi stálu odchýlku, pri ktorej sedí najviac tlesknutí na údery (odolné voči falošným nábehom)
  const cands = [];
  for (const c of claps) for (const t of target) { const d = c - t; if (d >= -maxEarly && d <= maxLate) cands.push(d); }
  let best = null;
  for (const d of cands) {
    const offs = [];
    for (const t of target) {
      const c = claps.reduce((b, x) => (b == null || Math.abs(x - t - d) < Math.abs(b - t - d) ? x : b), null);
      if (c != null && Math.abs(c - t - d) <= 45) offs.push(c - t);
    }
    if (offs.length < 2) continue;
    const m = median(offs), spread = median(offs.map(x => Math.abs(x - m)));
    if (!best || offs.length > best.offs.length || (offs.length === best.offs.length && spread < best.spread)) best = { offs, m, spread };
  }
  if (!best || best.offs.length < 3) return { ok: false, reason: 'few', micDb: db, claps: claps.length, msg: 'Tlesknutia som počul, ale nesedeli s údermi. Skús to znova a tlieskaj presne s bodkou, ktorá sa rozsvieti.' };
  if (best.spread > 40) return { ok: false, reason: 'spread', micDb: db, msg: 'Tlesknutia boli príliš nepravidelné. Skús to znova, tlieskaj presne s bodkou.', offsets: best.offs };
  return { ok: true, offset: Math.round(best.m), spread: Math.round(best.spread), offsets: best.offs.map(Math.round), micDb: db, ticks, claps };
}

module.exports = { onsets, findTicks, analyze, median, bandpass, highpass };
