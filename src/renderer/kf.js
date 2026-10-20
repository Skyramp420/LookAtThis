/* Keyframy pre advanced editor.
   Stopa vlastnosti = [{ t, v, ease, bz }] zoradená podľa t (sekundy od začiatku položky na osi).
   ease patrí úseku ZA keyframom: linear | in | out | inout | smooth | back | hold | custom (bz = [x1, y1, x2, y2]).
   Tá istá funkcia počíta hodnotu pre náhľad a z nej sa skladá ffmpeg výraz pre export, takže sedia. */
window.KF = (function () {
  const EASES = {
    linear: { l: 'Lineárne', bz: [0, 0, 1, 1] },
    inout: { l: 'Plynulo', bz: [0.42, 0, 0.58, 1] },
    in: { l: 'Rozbeh', bz: [0.42, 0, 1, 1] },
    out: { l: 'Dobeh', bz: [0, 0, 0.58, 1] },
    smooth: { l: 'Mäkko', bz: [0.25, 0.1, 0.25, 1] },
    back: { l: 'S prekmitom', bz: [0.34, 1.56, 0.64, 1] },
    hold: { l: 'Skok', bz: null }
  };
  /* vlastnosti podľa druhu položky: predvolená hodnota, rozsah, zobrazenie */
  const PROPS = {
    video: [
      { k: 'scale', l: 'Priblíženie', def: 1, min: 0.1, max: 5, step: 0.01, fmt: v => Math.round(v * 100) + ' %' },
      { k: 'x', l: 'Poloha X', def: 0, min: -1, max: 1, step: 0.001, fmt: v => Math.round(v * 100) + ' %' },
      { k: 'y', l: 'Poloha Y', def: 0, min: -1, max: 1, step: 0.001, fmt: v => Math.round(v * 100) + ' %' },
      { k: 'rot', l: 'Otočenie', def: 0, min: -360, max: 360, step: 1, fmt: v => Math.round(v) + '°' }
    ],
    text: [
      { k: 'x', l: 'Poloha X', def: 0.5, min: 0, max: 1, step: 0.001, fmt: v => Math.round(v * 100) + ' %' },
      { k: 'y', l: 'Poloha Y', def: 0.8, min: 0, max: 1, step: 0.001, fmt: v => Math.round(v * 100) + ' %' },
      { k: 'scale', l: 'Veľkosť', def: 1, min: 0.1, max: 5, step: 0.01, fmt: v => Math.round(v * 100) + ' %' },
      { k: 'rot', l: 'Otočenie', def: 0, min: -360, max: 360, step: 1, fmt: v => Math.round(v) + '°' }
    ],
    audio: [
      { k: 'vol', l: 'Hlasitosť', def: 1, min: 0, max: 2, step: 0.01, fmt: v => Math.round(v * 100) + ' %' }
    ]
  };
  const propsOf = it => PROPS[it.kind] || [];
  const propDef = (it, k) => (propsOf(it).find(p => p.k === k) || {}).def;

  /* kubická Bézierova krivka (ako CSS cubic-bezier): y pre dané x */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = u => ((ax * u + bx) * u + cx) * u, sy = u => ((ay * u + by) * u + cy) * u, dx = u => (3 * ax * u + 2 * bx) * u + cx;
    return x => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let u = x;
      for (let i = 0; i < 8; i++) { const e = sx(u) - x, d = dx(u); if (Math.abs(e) < 1e-6) return sy(u); if (Math.abs(d) < 1e-6) break; u -= e / d; }
      let lo = 0, hi = 1; u = x;
      for (let i = 0; i < 30; i++) { const e = sx(u); if (Math.abs(e - x) < 1e-6) break; if (e < x) lo = u; else hi = u; u = (lo + hi) / 2; }
      return sy(u);
    };
  }
  const cache = new Map();
  function easeFn(k) {
    if (!k || k.ease === 'hold') return null;
    const bz = k.ease === 'custom' && Array.isArray(k.bz) ? k.bz : (EASES[k.ease || 'linear'] || EASES.linear).bz;
    const key = bz.join(',');
    if (!cache.has(key)) cache.set(key, bz[0] === 0 && bz[1] === 0 && bz[2] === 1 && bz[3] === 1 ? (p => p) : bezier(...bz));
    return cache.get(key);
  }
  const curveOf = k => k.ease === 'custom' && Array.isArray(k.bz) ? k.bz : ((EASES[k.ease || 'linear'] || EASES.linear).bz || [0, 0, 1, 1]);

  /* hodnota stopy v čase T (od začiatku položky) */
  function value(track, T, def) {
    if (!track || !track.length) return def;
    if (T <= track[0].t) return track[0].v;
    const n = track.length;
    if (T >= track[n - 1].t) return track[n - 1].v;
    let i = 0; while (i < n - 2 && T >= track[i + 1].t) i++;
    const a = track[i], b = track[i + 1];
    if (a.ease === 'hold') return a.v;
    const p = (T - a.t) / Math.max(1e-6, b.t - a.t);
    return a.v + (b.v - a.v) * easeFn(a)(p);
  }
  /* hodnota vlastnosti položky (keyframy, inak statická hodnota, inak predvolená) */
  function getStatic(it, k) {
    if (it.kind === 'text' && (k === 'x' || k === 'y')) return it[k] != null ? it[k] : propDef(it, k);
    if (it.kind === 'audio' && k === 'vol') return it.vol != null ? it.vol : 1;
    return it.tf && it.tf[k] != null ? it.tf[k] : propDef(it, k);
  }
  function setStatic(it, k, v) {
    if (it.kind === 'text' && (k === 'x' || k === 'y')) it[k] = v;
    else if (it.kind === 'audio' && k === 'vol') it.vol = v;
    else { it.tf = it.tf || {}; it.tf[k] = v; }
  }
  function at(it, k, T) {
    const tr = it.kf && it.kf[k];
    const def = getStatic(it, k);
    return tr && tr.length ? value(tr, T, def) : def;
  }
  /* nastav hodnotu: keď je vlastnosť animovaná, vloží/upraví keyframe v čase T, inak zmení statickú hodnotu */
  function set(it, k, T, v) { if (it.kf && it.kf[k] && it.kf[k].length) setKey(it, k, T, v); else setStatic(it, k, v); }

  /* ffmpeg výraz pre stopu: T = výraz času od začiatku položky (napr. "(t-12.5)").
     Lineárne úseky presne, krivky po kúskoch (hz vzoriek za sekundu, lineárne medzi nimi → plynulé). */
  const n4 = x => { const s = Number(x).toFixed(4); return s === '-0.0000' ? '0' : s.replace(/\.?0+$/, '') || '0'; };
  function expr(track, def, T, hz = 20) {
    if (!track || !track.length) return n4(def);
    if (track.length === 1) return n4(track[0].v);
    const pts = []; // body po kúskoch lineárnej funkcie
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i], b = track[i + 1], D = b.t - a.t;
      if (D <= 1e-6) continue;
      if (a.ease === 'hold') { pts.push([a.t, a.v, 'hold']); continue; }
      const f = easeFn(a), linear = curveOf(a).join(',') === '0,0,1,1';
      const N = linear ? 1 : Math.max(2, Math.ceil(D * hz));
      for (let j = 0; j < N; j++) { const p = j / N; pts.push([a.t + D * p, a.v + (b.v - a.v) * f(p)]); }
    }
    const last = track[track.length - 1];
    pts.push([last.t, last.v]);
    const parts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ta, va, kind] = pts[i], [tb, vb] = pts[i + 1];
      if (tb - ta <= 1e-6) continue;
      const body = kind === 'hold' || Math.abs(vb - va) < 1e-7 ? n4(va) : `(${n4(va)}+(${T}-${n4(ta)})*${n4((vb - va) / (tb - ta))})`;
      parts.push(`gte(${T},${n4(ta)})*lt(${T},${n4(tb)})*${body}`);
    }
    const first = track[0];
    return `if(lt(${T},${n4(first.t)}),${n4(first.v)},if(gte(${T},${n4(last.t)}),${n4(last.v)},${parts.join('+') || n4(first.v)}))`;
  }
  function exprOf(it, k, T) {
    const tr = it.kf && it.kf[k];
    return tr && tr.length ? expr(tr, getStatic(it, k), T) : n4(getStatic(it, k));
  }
  /* zmena rýchlosti: keyframy ostanú na tých istých miestach obsahu */
  function scaleTimes(it, f) { for (const tr of Object.values(it.kf || {})) for (const x of tr || []) x.t *= f; }
  const animated = (it, k) => !!(it.kf && it.kf[k] && it.kf[k].length);
  const anyKf = it => !!(it.kf && Object.values(it.kf).some(a => a && a.length));
  /* všetky časy keyframov položky (zjednotené cez vlastnosti) */
  function times(it) {
    const s = new Map();
    for (const tr of Object.values(it.kf || {})) for (const k of tr || []) { const key = Math.round(k.t * 1000); if (!s.has(key)) s.set(key, k.t); }
    return [...s.values()].sort((a, b) => a - b);
  }
  /* nastav/vlož keyframe vlastnosti v čase T */
  function setKey(it, k, T, v, ease) {
    it.kf = it.kf || {};
    const tr = it.kf[k] = it.kf[k] || [];
    const near = tr.find(x => Math.abs(x.t - T) < 1 / 120);
    if (near) { near.v = v; if (ease) near.ease = ease; }
    else { tr.push({ t: T, v, ease: ease || inheritEase(it, T) }); tr.sort((a, b) => a.t - b.t); }
  }
  // nový keyframe prevezme krivku iných keyframov v tom istom čase (aby sa krivka správala rovnako pre celý bod)
  function inheritEase(it, T) {
    for (const tr of Object.values(it.kf || {})) for (const x of tr || []) if (Math.abs(x.t - T) < 1 / 120) return x.ease;
    return 'inout';
  }
  function removeKey(it, k, T) {
    const tr = it.kf && it.kf[k]; if (!tr) return;
    const i = tr.findIndex(x => Math.abs(x.t - T) < 1 / 120);
    if (i >= 0) {
      const v = tr[i].v; tr.splice(i, 1);
      if (!tr.length) { delete it.kf[k]; setStatic(it, k, v); }
    }
  }
  const keyAt = (it, k, T) => { const tr = it.kf && it.kf[k]; return tr ? tr.find(x => Math.abs(x.t - T) < 1 / 120) || null : null; };
  /* posun všetkých keyframov v čase from → to (ťahanie kosoštvorca na osi) */
  function moveTime(it, from, to) {
    for (const tr of Object.values(it.kf || {})) {
      for (const x of tr || []) if (Math.abs(x.t - from) < 1 / 120) x.t = to;
      tr.sort((a, b) => a.t - b.t);
    }
  }
  function setEase(it, T, ease, bz) {
    for (const tr of Object.values(it.kf || {})) for (const x of tr || []) if (Math.abs(x.t - T) < 1 / 120) { x.ease = ease; if (bz) x.bz = bz.slice(); else delete x.bz; }
  }
  /* posun všetkých keyframov o d (napr. orez začiatku položky: absolútne miesto na osi ostáva) */
  function shift(it, d) { for (const tr of Object.values(it.kf || {})) for (const x of tr || []) x.t += d; }
  /* rozdelenie položky v čase T (od jej začiatku): ľavá časť dostane keyframy pred T, pravá za T (posunuté), obe hodnotu v T */
  function split(it, T) {
    if (!anyKf(it)) return [it.kf ? {} : undefined, it.kf ? {} : undefined];
    const L = {}, R = {};
    for (const [k, tr] of Object.entries(it.kf)) {
      if (!tr || !tr.length) continue;
      const v = value(tr, T, tr[0].v), e = (tr.filter(x => x.t <= T).pop() || tr[0]).ease;
      L[k] = tr.filter(x => x.t < T - 1e-4).map(x => ({ ...x })); L[k].push({ t: T, v, ease: e });
      R[k] = [{ t: 0, v, ease: e }, ...tr.filter(x => x.t > T + 1e-4).map(x => ({ ...x, t: x.t - T }))];
    }
    return [L, R];
  }
  return { EASES, PROPS, propsOf, propDef, bezier, value, at, set, getStatic, setStatic, scaleTimes, expr, exprOf, animated, anyKf, times, setKey, removeKey, keyAt, moveTime, setEase, shift, split, curveOf };
})();
