/* Drobnosti rozhrania: vyskakovacie menu, segmentové ovládače, toasty, modály, zvuky, formátovanie. */
window.UI = (function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const I = {
    chev: '<svg viewBox="0 0 16 16"><path d="M5 6.2 8 3.5l3 2.7M5 9.8 8 12.5l3-2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.7l4.6-5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M13.2 13.2L17 17" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    folder: '<svg viewBox="0 0 20 20"><path d="M2.5 6A1.5 1.5 0 0 1 4 4.5h3.6l1.8 2H16A1.5 1.5 0 0 1 17.5 8v6.5A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 10h7.4l.8-10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    scissors: '<svg viewBox="0 0 20 20"><circle cx="5.5" cy="14.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="5.5" cy="5.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 7 17 15M7.5 13 17 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    refresh: '<svg viewBox="0 0 20 20"><path d="M15.5 8A6 6 0 0 0 4.6 6.5M4.5 12a6 6 0 0 0 10.9 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 3v4h4M16 17v-4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ext: '<svg viewBox="0 0 20 20"><path d="M11 4h5v5M16 4l-7 7M14 12v3.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 3 15.5v-8A1.5 1.5 0 0 1 4.5 6H8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    info: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.3" r="1.1" fill="currentColor"/></svg>',
    ok: '<svg viewBox="0 0 16 16"><path d="M3.5 8.4 6.6 11.3 12.5 4.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 16 16"><path d="M8 2.5 14 13H2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.3" r=".9" fill="currentColor"/></svg>',
    err: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    film: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>'
  };

  /* ---------- vyskakovacie menu ---------- */
  let openMenu = null;
  function closeMenu(instant) {
    if (!openMenu) return;
    const { el, btn, onKey, onDown } = openMenu;
    openMenu = null;
    if (btn) btn.classList.remove('open');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDown, true);
    if (instant) el.remove(); else { el.classList.add('out'); setTimeout(() => el.remove(), 140); }
  }
  /* items: [{ label, value, checked, disabled, sub, sep, head }] */
  function menu(anchor, items, onPick) {
    closeMenu(true);
    const el = document.createElement('div');
    el.className = 'pop-menu';
    el.innerHTML = items.map((it, i) => it.sep ? '<hr>' : it.head ? `<div class="lbl">${esc(it.head)}</div>` :
      `<button type="button" data-i="${i}"${it.disabled ? ' disabled' : ''}><i>${it.checked ? I.check : ''}</i><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.minWidth = Math.max(180, r.width) + 'px';
    const mh = el.offsetHeight, mw = el.offsetWidth;
    const below = innerHeight - r.bottom - 8 >= mh || r.top < mh;
    const top = below ? Math.min(r.bottom + 5, innerHeight - mh - 8) : Math.max(8, r.top - mh - 5);
    const left = Math.max(8, Math.min(r.left, innerWidth - mw - 8));
    el.style.top = top + 'px'; el.style.left = left + 'px';
    el.style.setProperty('--ox', Math.round(r.left + r.width / 2 - left) + 'px');
    el.style.setProperty('--oy', below ? '0px' : mh + 'px');
    const btns = $$('button:not([disabled])', el);
    let hl = btns.findIndex(b => items[+b.dataset.i].checked);
    const setHl = i => { btns.forEach((b, k) => b.classList.toggle('hl', k === i)); hl = i; if (btns[i]) btns[i].scrollIntoView({ block: 'nearest' }); };
    btns.forEach((b, k) => { b.onmouseenter = () => setHl(k); b.onclick = () => { const it = items[+b.dataset.i]; closeMenu(); onPick(it); }; });
    el.addEventListener('mouseleave', () => setHl(-1));
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setHl(Math.min(btns.length - 1, hl + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHl(Math.max(0, hl - 1)); }
      if (e.key === 'Enter') { e.preventDefault(); if (btns[hl]) btns[hl].click(); }
    };
    const onDown = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    if (anchor.classList.contains('pb')) anchor.classList.add('open');
    openMenu = { el, btn: anchor, onKey, onDown };
  }

  /* tlačidlo s menu: pb(label, items, onPick) → HTML; naviaž cez bindPb */
  let pbSeq = 0; const pbs = {};
  function pb(label, items, onPick, attrs = '') {
    const id = 'pb' + (++pbSeq);
    pbs[id] = { items, onPick };
    return `<button type="button" class="pb" data-pb="${id}" ${attrs}><span>${esc(label)}</span>${I.chev}</button>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-pb]');
    if (!b) return;
    const d = pbs[b.dataset.pb]; if (!d) return;
    const items = typeof d.items === 'function' ? d.items() : d.items;
    menu(b, items, d.onPick);
  });

  /* ---------- segmentový ovládač ---------- */
  function seg(name, options, value) {
    return `<div class="seg" data-seg="${esc(name)}">${options.map(o => `<button type="button" data-v="${esc(o.v)}" class="${String(o.v) === String(value) ? 'on' : ''}"${o.disabled ? ' disabled' : ''}>${esc(o.l)}</button>`).join('')}</div>`;
  }
  function placeThumbs(root = document, animate = false) {
    $$('.seg', root).forEach(s => {
      let t = s.querySelector('.seg-thumb');
      if (!t) { t = document.createElement('i'); t.className = 'seg-thumb'; s.prepend(t); if (!animate) t.style.transition = 'none'; }
      const on = s.querySelector('button.on');
      if (!on) { t.style.opacity = 0; return; }
      t.style.opacity = 1;
      t.style.width = on.offsetWidth + 'px';
      t.style.transform = `translateX(${on.offsetLeft - 2}px)`;
      if (!animate) requestAnimationFrame(() => { t.style.transition = ''; });
    });
  }
  function onSeg(root, cb) {
    root.addEventListener('click', e => {
      const b = e.target.closest('.seg button'); if (!b || b.disabled) return;
      const s = b.closest('.seg');
      $$('button', s).forEach(x => x.classList.toggle('on', x === b));
      placeThumbs(s.parentElement, true);
      cb(s.dataset.seg, b.dataset.v);
    });
  }

  /* ---------- toasty ---------- */
  function toast(kind, title, body, opts = {}) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    const ic = kind === 'ok' ? I.ok : kind === 'warn' ? I.warn : kind === 'error' ? I.err : I.info;
    el.innerHTML = `<div class="ic">${ic}</div><div class="tx"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}</div>${opts.action ? `<button class="btn small">${esc(opts.action.label)}</button>` : ''}`;
    if (opts.action) el.querySelector('.btn').onclick = () => { opts.action.run(); out(); };
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    const out = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
    setTimeout(out, opts.ms || (kind === 'error' ? 8000 : 4500));
    el.addEventListener('click', e => { if (!e.target.closest('.btn')) out(); });
  }

  /* ---------- modál ---------- */
  let onCloseModal = null, beforeCloseModal = null;
  /* beforeClose: vráti false = nezatváraj (napr. neuložené úpravy v editore); closeModal(true) ho obíde */
  function modal(html, cls = '', onClose, beforeClose) {
    const wrap = $('#modalWrap'), m = $('#modal');
    m.className = 'modal ' + cls; m.innerHTML = html;
    wrap.hidden = false; wrap.classList.remove('closing');
    onCloseModal = onClose || null; beforeCloseModal = beforeClose || null;
    return m;
  }
  function closeModal(force) {
    const wrap = $('#modalWrap');
    if (wrap.hidden) return;
    if (force !== true && beforeCloseModal && beforeCloseModal() === false) return;
    beforeCloseModal = null;
    if (onCloseModal) { try { onCloseModal(); } catch (e) { } onCloseModal = null; }
    wrap.classList.add('closing');
    setTimeout(() => { wrap.hidden = true; $('#modal').innerHTML = ''; }, 180);
  }
  $('#modalWrap').addEventListener('mousedown', e => { if (e.target.id === 'modalWrap') closeModal(); });
  // Esc zavrie dialóg; v malých dialógoch aj keď je kurzor v poli (v editore nie, tam Esc ruší výber)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !openMenu && !$('#modalWrap').hidden && (!e.target.closest('input') || e.target.closest('.modal.small'))) closeModal(); });
  function confirm(title, text, okLabel = 'OK', danger = false) {
    return new Promise(res => {
      const m = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="acts"><button class="btn" data-a="no">Zrušiť</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(okLabel)}</button></div>`, 'small', () => res(false));
      m.querySelector('[data-a=no]').onclick = () => { closeModal(); };
      m.querySelector('[data-a=yes]').onclick = () => { onCloseModal = null; closeModal(); res(true); };
      setTimeout(() => m.querySelector('[data-a=yes]').focus(), 50);
    });
  }


  /* ---------- mazanie s animovaným košom ----------
     clips = jeden klip alebo pole; vráti 'delete' (natrvalo), 'trash' (Kôš vo Windowse) alebo null */
  function trashDialog(clips) {
    clips = Array.isArray(clips) ? clips : [clips];
    const n = clips.length, show = clips.slice(0, 5), k = show.length;
    const bytes = clips.reduce((a, c) => a + (c.size || 0), 0);
    const word = n === 1 ? 'klip' : n < 5 ? 'klipy' : 'klipov';
    return new Promise(res => {
      // karty ako vejár; padajú jedna po druhej, posledná (vrchná) nesie počet
      const cards = show.map((c, i) => {
        const mid = (k - 1) / 2, off = i - mid;
        const th = c.thumb ? `<img src="${esc(fileUrl(c.thumb))}" alt="">` : `<div class="tr-ph">${I.film}</div>`;
        return `<div class="tr-card" style="--x:${off * (k > 3 ? 18 : 24)}px;--y:${Math.abs(off) * 5}px;--r:${off * 6}deg;--d:${(k - 1 - i) * 0.11}s;z-index:${i + 1}">${th}${i === k - 1 && n > 1 ? `<span class="tr-count">${n}</span>` : ''}</div>`;
      }).join('');
      const fallEnd = 0.12 + (k - 1) * 0.11 + 0.62;
      const m = modal(`
        <div class="tr-scene" id="trScene" style="--lid:${(fallEnd + 0.38).toFixed(2)}s;--wob:${(fallEnd + 0.05).toFixed(2)}s">
          <div class="tr-cards">${cards}</div>
          <svg class="tr-bin" viewBox="0 0 80 92" aria-hidden="true">
            <g class="tr-lid"><rect x="6" y="14" width="68" height="9" rx="4.5"/><path d="M30 14v-4a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v4" fill="none" stroke-width="5"/></g>
            <path class="tr-body" d="M12 28h56l-5 56a6 6 0 0 1-6 5.5H23a6 6 0 0 1-6-5.5z"/>
            <path class="tr-ribs" d="M30 40v36M40 40v36M50 40v36" fill="none" stroke-width="4" stroke-linecap="round"/>
          </svg>
        </div>
        <h2>${n === 1 ? 'Vymazať klip?' : `Vymazať ${n} ${word}?`}</h2>
        <p>${n === 1 ? `<b>${esc(clips[0].name)}</b> sa vymaže` : `<b>${n} ${word}</b> (${esc(size(bytes))}) sa vymažú`} natrvalo, ${n === 1 ? 'nepôjde' : 'nepôjdu'} do Koša a nedá sa to vrátiť.</p>
        <div class="acts tr-acts">
          <button class="btn ghost small" data-a="trash">Radšej do Koša</button>
          <span style="flex:1"></span>
          <button class="btn" data-a="no">Zrušiť</button>
          <button class="btn danger strong" data-a="yes">${I.trash}<span>${n === 1 ? 'Vymazať' : `Vymazať ${n}`}</span></button>
        </div>`, 'small trash-modal', () => res(null));
      const scene = m.querySelector('#trScene');
      const yes = m.querySelector('[data-a=yes]');
      yes.addEventListener('mouseenter', () => scene.classList.add('peek'));
      yes.addEventListener('mouseleave', () => scene.classList.remove('peek'));
      m.querySelector('[data-a=no]').onclick = () => closeModal();
      const go = choice => {
        onCloseModal = null;
        m.querySelectorAll('button').forEach(b => { b.disabled = true; });
        scene.classList.remove('peek');
        scene.classList.add('drop');
        sound(choice === 'delete' ? 'trash' : 'stop', 0.6);
        setTimeout(() => { closeModal(); res(choice); }, (fallEnd + 0.45) * 1000);
      };
      yes.onclick = () => go('delete');
      m.querySelector('[data-a=trash]').onclick = () => go('trash');
      setTimeout(() => m.querySelector('[data-a=no]').focus(), 50);
    });
  }

  /* ---------- zvuky (syntetizované, žiadne súbory) ---------- */
  let ac = null, noiseBuf = null;
  const SOUNDS = [
    { id: 'clap', label: 'Klapka' }, { id: 'shutter', label: 'Fotoaparát' }, { id: 'beep', label: 'Pípnutie' },
    { id: 'pop', label: 'Bublina' }, { id: 'chime', label: 'Zvonček' }, { id: 'arcade', label: 'Arkáda' }, { id: 'none', label: 'Žiadny' }
  ];
  function tone(f, at, len, vol, type = 'sine', f2) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, at);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + len);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(ac.destination);
    o.start(at); o.stop(at + len + 0.02);
  }
  function noise(at, len, vol, freq, q = 1, type = 'bandpass') {
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(g).connect(ac.destination);
    src.start(at); src.stop(at + len + 0.02);
  }
  /* všetky zvuky sú syntetizované, žiadne súbory */
  function sound(name, vol = 0.5) {
    try {
      ac = ac || new AudioContext();
      const t = ac.currentTime + 0.01, v = Math.max(0, Math.min(1, vol));
      if (!v || name === 'none') return;
      switch (name) {
        case 'clap': // tlesknutie klapky: krátky šum + tupý úder
          noise(t, 0.09, 0.9 * v, 1800, 0.8); noise(t, 0.035, 0.6 * v, 5200, 1.2); tone(140, t, 0.12, 0.5 * v, 'sine', 60); break;
        case 'shutter': // uzávierka: dve cvaknutia
          noise(t, 0.03, 0.8 * v, 3500, 2); noise(t + 0.07, 0.05, 0.6 * v, 2200, 1.5); tone(1200, t, 0.02, 0.15 * v, 'square'); break;
        case 'pop': tone(520, t, 0.14, 0.45 * v, 'sine', 1400); break;
        case 'chime': [1046.5, 1318.5, 1568].forEach((f, i) => tone(f, t + i * 0.07, 0.5, 0.18 * v, 'sine')); break;
        case 'arcade': tone(988, t, 0.08, 0.16 * v, 'square'); tone(1319, t + 0.08, 0.28, 0.16 * v, 'square'); break;
        case 'beep': case 'saved': tone(880, t, 0.22, 0.25 * v); tone(1318.5, t + 0.09, 0.22, 0.25 * v); break;
        case 'trash': [[523, 0.62], [392, 0.7], [196, 0.78]].forEach(([f, d]) => tone(f, t + d, 0.22, 0.25 * v)); break;
        case 'rec': tone(660, t, 0.18, 0.25 * v); tone(660, t + 0.12, 0.18, 0.25 * v); break;
        case 'stop': tone(880, t, 0.2, 0.25 * v); tone(587, t + 0.1, 0.2, 0.25 * v); break;
        default: tone(220, t, 0.22, 0.25 * v, 'triangle'); tone(196, t + 0.12, 0.22, 0.25 * v, 'triangle');
      }
    } catch (e) { }
  }

  /* ---------- formátovanie ---------- */
  const pad = n => String(n).padStart(2, '0');
  function dur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function durMs(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60), cs = Math.floor((sec * 100) % 100);
    return `${m}:${pad(s)}.${pad(cs)}`;
  }
  function size(b) { return b > 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : b < 100e6 ? Math.max(0.1, b / 1e6).toFixed(1).replace('.', ',') + ' MB' : Math.round(b / 1e6) + ' MB'; }
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const strip = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((strip(now) - strip(d)) / 86400000);
    if (diff === 0) return 'Dnes';
    if (diff === 1) return 'Včera';
    const days = ['nedeľa', 'pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota'];
    if (diff < 7) return days[d.getDay()][0].toUpperCase() + days[d.getDay()].slice(1);
    return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear() !== now.getFullYear() ? d.getFullYear() : ''}`.trim();
  }
  function time(ts) { const d = new Date(ts); return `${d.getHours()}:${pad(d.getMinutes())}`; }
  const fileUrl = p => 'file:///' + String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');

  return { $, $$, esc, I, menu, closeMenu, pb, seg, placeThumbs, onSeg, toast, modal, closeModal, confirm, trashDialog, sound, SOUNDS, dur, durMs, size, dayLabel, time, fileUrl };
})();
