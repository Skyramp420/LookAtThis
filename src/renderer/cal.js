/* Kalendár s výberom dňa alebo rozsahu dní: Cal.open(kotva, { range, counts }, onChange)
   range = { from, to } (ms, celé dni) alebo null; counts = () => Map('r-m-d' → počet klipov) pre bodky pod dňami */
window.Cal = (() => {
  const { esc, I } = UI;
  const MON = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];
  const DOW = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];
  const day0 = ts => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const day1 = ts => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime(); };
  const key = ts => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const short = ts => { const d = new Date(ts); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
  function label(r) {
    if (!r) return '';
    const same = day0(r.from) === day0(r.to);
    const y = new Date(r.to).getFullYear(), cur = new Date().getFullYear();
    if (same) return short(r.from) + (y !== cur ? ' ' + y : '');
    return `${short(r.from)} – ${short(r.to)}` + (y !== cur ? ' ' + y : '');
  }
  function inRange(ts, r) { return !r || (ts >= r.from && ts <= r.to); }

  let cur = null;
  function close() {
    if (!cur) return;
    const { el, onKey, onDown } = cur; cur = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDown, true);
    el.classList.add('out'); setTimeout(() => el.remove(), 130);
  }

  function open(anchor, opts, onChange) {
    close();
    const counts = opts.counts ? opts.counts() : new Map();
    let r = opts.range ? { ...opts.range } : null;
    let first = null, hover = null;                       // rozpracovaný výber: prvý klik
    const base = r ? r.from : (counts.size ? Math.max(...[...counts.keys()].map(k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); })) : Date.now());
    let view = new Date(new Date(base).getFullYear(), new Date(base).getMonth(), 1);

    const el = document.createElement('div');
    el.className = 'cal';
    document.body.appendChild(el);

    const finish = nr => { onChange(nr); close(); };
    const preset = id => {
      const now = Date.now(), t0 = day0(now);
      if (id === 'today') return { from: t0, to: day1(now) };
      if (id === 'yest') return { from: t0 - 864e5, to: day1(t0 - 864e5) };
      if (id === 'w') return { from: day0(t0 - 6 * 864e5), to: day1(now) };
      if (id === 'm30') return { from: day0(t0 - 29 * 864e5), to: day1(now) };
      if (id === 'mon') { const d = new Date(); return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: day1(now) }; }
      return null;
    };

    function paint() {
      const y = view.getFullYear(), mo = view.getMonth();
      const lead = (new Date(y, mo, 1).getDay() + 6) % 7, n = new Date(y, mo + 1, 0).getDate();
      const today = day0(Date.now());
      let a = first != null ? first : r ? r.from : null, b = first != null ? (hover != null ? hover : first) : r ? r.to : null;
      if (a != null && b != null && a > b) [a, b] = [b, a];
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<i></i>';
      for (let d = 1; d <= n; d++) {
        const t = new Date(y, mo, d).getTime(), c = counts.get(y + '-' + (mo + 1) + '-' + d) || 0;
        const on = a != null && t >= day0(a) && t <= day0(b);
        const edge = on && (t === day0(a) ? ' s' : '') + (t === day0(b) ? ' e' : '');
        cells += `<button class="cd${on ? ' on' : ''}${edge || ''}${t === today ? ' today' : ''}${c ? ' has' : ''}" data-t="${t}"${c ? ` title="${c} ${c === 1 ? 'klip' : c < 5 ? 'klipy' : 'klipov'}"` : ''}>${d}</button>`;
      }
      el.innerHTML = `<div class="cal-top">
          <button class="cal-nav" data-m="-1" aria-label="Predošlý mesiac"><svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <b>${MON[mo]} ${y}</b>
          <button class="cal-nav" data-m="1" aria-label="Ďalší mesiac"><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="cal-dow">${DOW.map(x => `<span>${x}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
        <div class="cal-help">${first != null ? 'Vyber posledný deň. Klik na ten istý deň = len jeden deň.' : 'Klikni na prvý a potom na posledný deň.'}</div>
        <div class="cal-pre">
          <button data-p="today">Dnes</button><button data-p="yest">Včera</button><button data-p="w">7 dní</button><button data-p="m30">30 dní</button><button data-p="mon">Tento mesiac</button>
          ${r ? '<button data-p="clear" class="clr">Zrušiť filter</button>' : ''}
        </div>`;
    }
    paint();

    el.addEventListener('click', e => {
      const nav = e.target.closest('[data-m]');
      if (nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.m), 1); paint(); return; }
      const p = e.target.closest('[data-p]');
      if (p) { finish(p.dataset.p === 'clear' ? null : preset(p.dataset.p)); return; }
      const d = e.target.closest('.cd');
      if (!d) return;
      const t = Number(d.dataset.t);
      if (first == null) { first = t; hover = t; paint(); return; }
      const a = Math.min(first, t), b = Math.max(first, t);
      finish({ from: day0(a), to: day1(b) });
    });
    el.addEventListener('mouseover', e => {
      if (first == null) return;
      const d = e.target.closest('.cd'); if (!d) return;
      const t = Number(d.dataset.t); if (t === hover) return;
      hover = t;
      // len prekresli označenie, bez prestavby DOM (inak by sa stratil klik)
      let a = first, b = t; if (a > b) [a, b] = [b, a];
      el.querySelectorAll('.cd').forEach(x => {
        const v = Number(x.dataset.t), on = v >= a && v <= b;
        x.classList.toggle('on', on); x.classList.toggle('s', on && v === a); x.classList.toggle('e', on && v === b);
      });
    });

    // poloha pod kotvou
    const ar = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    const below = innerHeight - ar.bottom - 8 >= h || ar.top < h;
    const top = below ? Math.min(ar.bottom + 6, innerHeight - h - 8) : Math.max(8, ar.top - h - 6);
    const left = Math.max(8, Math.min(ar.right - w, innerWidth - w - 8));
    el.style.top = top + 'px'; el.style.left = left + 'px';
    el.style.setProperty('--ox', Math.round(ar.left + ar.width / 2 - left) + 'px');
    el.style.setProperty('--oy', below ? '0px' : h + 'px');

    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (first != null) { first = null; paint(); } else close(); } };
    const onDown = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    cur = { el, onKey, onDown };
  }

  /* počty klipov podľa dní pre bodky v kalendári */
  function countsOf(list) { const m = new Map(); for (const c of list) { const k = key(c.mtime); m.set(k, (m.get(k) || 0) + 1); } return m; }

  return { open, close, label, inRange, countsOf };
})();
