/* Sprievodca prvým spustením: nastav si veci raz a potom na ne nemusíš myslieť.
   Každý krok ukladá hneď, takže zatvorenie v polovici nič nepokazí. */
window.Setup = (function () {
  const { $, $$, esc, I, modal, closeModal, toast, dur, pb, seg, placeThumbs, sound, SOUNDS } = UI;

  const EYE = `<svg class="su-eye" viewBox="0 0 64 64" aria-hidden="true">
    <defs><radialGradient id="suIris" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#ffc35a"/><stop offset=".6" stop-color="var(--accent)"/><stop offset="1" stop-color="#ff5e3a"/></radialGradient>
    <clipPath id="suClip"><path d="M12 32c5.5-9 12.5-13.5 20-13.5S46.5 23 52 32c-5.5 9-12.5 13.5-20 13.5S17.5 41 12 32z"/></clipPath></defs>
    <rect x="2" y="2" width="60" height="60" rx="15" fill="#232325"/>
    <path d="M15 14h-3.5A3.5 3.5 0 0 0 8 17.5V21M49 14h3.5a3.5 3.5 0 0 1 3.5 3.5V21M15 50h-3.5A3.5 3.5 0 0 1 8 46.5V43M49 50h3.5a3.5 3.5 0 0 0 3.5-3.5V43" fill="none" stroke="var(--accent)" stroke-width="3.2" stroke-linecap="round"/>
    <g class="su-lid"><path d="M12 32c5.5-9 12.5-13.5 20-13.5S46.5 23 52 32c-5.5 9-12.5 13.5-20 13.5S17.5 41 12 32z" fill="#f5f5f7"/>
    <g clip-path="url(#suClip)"><g class="su-iris"><circle cx="32" cy="32" r="10.5" fill="url(#suIris)"/><path d="M29.2 27.2v9.6l8-4.8z" fill="#1c1c1e" stroke="#1c1c1e" stroke-width="1.6" stroke-linejoin="round"/><circle cx="35.6" cy="27.6" r="2" fill="#fff" opacity=".9"/></g></g></g></svg>`;

  const STEPS = ['Vitaj', 'Skratky', 'Zvuk', 'Synchronizácia', 'Výkon', 'Ukladanie', 'Hotovo'];
  const PRESETS = {
    high: { label: 'Vysoká kvalita', sub: 'Natívne rozlíšenie · 60 fps · vysoká kvalita', s: { resolution: 'native', fps: 60, quality: 'high', powerSave: 'off' } },
    balanced: { label: 'Vyvážená', sub: '1080p · 60 fps · stredná kvalita', s: { resolution: '1080', fps: 60, quality: 'medium', powerSave: 'auto' } },
    saver: { label: 'Úsporná', sub: 'Max. 1080p · 30 fps · úsporný režim', s: { resolution: '1080', fps: 30, quality: 'medium', powerSave: 'on' } }
  };

  function open(startAt = 0) {
    let step = startAt, dir = 1, firstClip = false;
    const St = () => App.state();
    const m = modal(`<div class="su">
      <div class="su-top"><div class="su-dots" id="suDots"></div><button class="su-skip" id="suSkip">Preskočiť</button></div>
      <div class="su-body" id="suBody"></div>
      <div class="su-foot"><button class="btn ghost" id="suBack">Späť</button><span class="grow"></span><button class="btn primary" id="suNext">Ďalej</button></div>
    </div>`, 'setup', () => { if (clap) clap.stop(); if (!St().settings.onboarded) App.save({ onboarded: true }); window.removeEventListener('lat-levels', onLv); window.removeEventListener('lat-saved', onSaved); });

    const save = patch => App.save(patch);
    function render() {
      $('#suDots', m).innerHTML = STEPS.map((n, i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}" title="${n}"></i>`).join('');
      $('#suBack', m).style.visibility = step === 0 || step === STEPS.length - 1 ? 'hidden' : 'visible';
      $('#suSkip', m).style.visibility = step === STEPS.length - 1 ? 'hidden' : 'visible';
      $('#suNext', m).textContent = step === 0 ? 'Poďme na to' : step === STEPS.length - 1 ? 'Hotovo' : 'Ďalej';
      const body = $('#suBody', m);
      body.style.setProperty('--dir', dir);
      body.classList.remove('in'); void body.offsetWidth; body.classList.add('in');
      if (clap) { clap.stop(); clap = null; }
      body.innerHTML = [welcome, keys, audio, sync, perf, saving, done][step]();
      placeThumbs(body);
      bind[step] && bind[step](body);
    }
    const s = () => St().settings;

    /* ---------- kroky ---------- */
    function welcome() {
      return `<div class="su-hero">${EYE}
        <h1>Ahoj, ja som Look<b>At</b>This</h1>
        <p>Beží potichu na pozadí a keď sa v hre stane niečo, na čo sa treba pozrieť, jedným stlačením to uložím.</p>
        <p class="su-muted">Za minútku spolu nastavíme skratky, zvuk a kvalitu. Potom už na to nemusíš myslieť.</p></div>`;
    }
    function keys() {
      const st = s();
      return `<h2>Skratky</h2><p class="su-muted">Fungujú aj v hre na celú obrazovku. Klikni na skratku a stlač novú kombináciu.</p>
        <div class="su-cards">
          <div class="su-card"><b>Uložiť clip</b><span>posledných ${dur(st.bufferSeconds)} z buffra</span><button class="hk" data-hk="clip">${esc(st.hotkeys.clip || 'Nastaviť')}</button></div>
          <div class="su-card"><b>Nahrávanie</b><span>spustí a zastaví dlhé nahrávanie</span><button class="hk" data-hk="record">${esc(st.hotkeys.record || 'Nastaviť')}</button></div>
          <div class="su-card"><b>Značka</b><span>označí moment, v editore naň skočíš klávesou M</span><button class="hk" data-hk="mark">${esc(st.hotkeys.mark || 'Nastaviť')}</button></div>
        </div>
        <div class="su-row"><span>Hráš LoL, Valorant alebo inú hru s anti-cheatom?<small class="su-muted">Tieto hry bežia ako správca a skratky by v nich bez toho nefungovali. Windows sa pri štarte raz opýta na povolenie.</small></span><label class="toggle"><input type="checkbox" data-set="hotkeysAdmin" ${st.hotkeysAdmin ? 'checked' : ''}></label></div>
        <p class="su-muted small">Skratky zmeníš aj neskôr: stačí na ne kliknúť v karte buffra vľavo dole.</p>
        <div class="su-row"><span>Koľko sa uloží</span>${seg('bufferSeconds', [30, 60, 120, 180, 300].map(v => ({ v, l: v < 60 ? v + ' s' : v / 60 + ' min' })), st.bufferSeconds)}</div>`;
    }
    function trackRow(t, label, hint) {
      const st = St();
      const list = (t.flow === 'capture' ? st.devices.capture : st.devices.render) || [];
      const cur = list.find(d => d.id === t.deviceId) || (t.deviceName ? { name: t.deviceName } : null);
      return `<div class="su-trk" data-trk="${t.id}">
        <div class="su-trk-h"><b>${label}</b><label class="toggle sm"><input type="checkbox" data-on="${t.id}" ${t.on ? 'checked' : ''}></label></div>
        <span class="su-muted">${hint}</span>
        ${t.kind === 'device' ? pb(cur ? cur.name : (t.flow === 'capture' ? 'Predvolený mikrofón' : 'Predvolený výstup'), () => [{ label: t.flow === 'capture' ? 'Predvolený mikrofón Windowsu' : 'Predvolený výstup Windowsu', v: '', checked: !t.deviceId }, { sep: true }, ...list.map(d => ({ label: d.name, v: d.id, name: d.name, sub: d.default ? 'predvolené' : '', checked: d.id === t.deviceId }))], it => setTrack(t.id, { deviceId: it.v, deviceName: it.name || '' })) : ''}
        <div class="su-meter"><i data-m="${t.id}"></i></div></div>`;
    }
    function audio() {
      const tr = Object.fromEntries(s().tracks.map(t => [t.id, t]));
      return `<h2>Zvuk</h2><p class="su-muted">Každá stopa ide do klipu zvlášť. Pusti si niečo a povedz pár slov do mikrofónu, merače by sa mali hýbať.</p>
        <div class="su-trks">
          ${trackRow(tr.system, 'Čo počuješ', 'Slúchadlá alebo reproduktory, na ktorých počúvaš (pri Sonare tvoje skutočné slúchadlá).')}
          ${trackRow(tr.mic, 'Mikrofón', 'Tvoj hlas vo vlastnej stope.')}
          ${trackRow(tr.game, 'Hra', 'Zvuk hry v popredí sa chytí sám, aj z nainštalovaných hier v okne.')}
          ${trackRow(tr.discord, 'Discord', 'Hlasový chat zvlášť, aby si ho mohol pri strihu stlmiť.')}
        </div>`;
    }
    let clap = null;
    function sync() {
      const mic = s().tracks.find(t => t.id === 'mic') || {};
      return `<h2>Synchronizácia mikrofónu</h2>
        <p class="su-muted">Ak máš mikrofón cez VST pluginy, Sonar alebo potlačenie šumu, jeho zvuk môže za obrazom trochu meškať. Za 10 sekúnd to zmeriam: appka zahrá 8 úderov, prvé 4 počúvaj, pri ďalších 4 <b>tlesni presne s úderom</b>.</p>
        ${mic.on === false ? '<p class="su-muted">Mikrofón máš vypnutý, tento krok môžeš preskočiť.</p>' : ''}
        <div class="su-clap" id="suClap"></div>
        <p class="su-muted small">Nechceš? Klikni Ďalej. Spraviť to môžeš kedykoľvek v Zvuk → Mikrofón → Zistiť tlieskaním.${mic.latency ? ` Teraz je nastavené ${mic.latency} ms.` : ''}</p>`;
    }
    function recommend() {
      const sys = St().system || {};
      if (sys.weak) return 'saver';
      if (sys.hw && sys.cores >= 8 && sys.ram >= 16) return 'high';
      return 'balanced';
    }
    function curPreset() {
      const st = s();
      return Object.keys(PRESETS).find(k => Object.entries(PRESETS[k].s).every(([a, b]) => String(st[a]) === String(b))) || null;
    }
    function perf() {
      const sys = St().system || {}, enc = St().engine.encoder || '';
      const rec = recommend(), cur = curPreset() || rec;
      const hwText = sys.hw ? `grafika ${esc(sys.gpu || '')} nahráva sama (${esc(enc.split(' ')[0] || 'HW enkodér')})` : 'HW enkodér som nenašiel, nahrával by procesor';
      return `<h2>Výkon a kvalita</h2>
        <div class="su-sys"><div><b>${sys.cores || '?'}</b><span>jadier</span></div><div><b>${sys.ram || '?'} GB</b><span>RAM</span></div><div><b>${esc(sys.gpu || '—')}</b><span>${sys.hw ? 'HW enkodér' : 'bez HW enkodéra'}</span></div></div>
        <p class="su-muted">Tvoj PC: ${hwText}. Odporúčam <b>${PRESETS[rec].label.toLowerCase()}</b>.</p>
        <div class="su-presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="su-pre${k === cur ? ' on' : ''}" data-pre="${k}">${k === rec ? '<em>odporúčané</em>' : ''}<b>${p.label}</b><span>${p.sub}</span></button>`).join('')}</div>
        <p class="su-muted small">Všetko zmeníš neskôr v Nastavenia → Video. Úsporný režim sa na slabšom PC zapne aj sám.</p>`;
    }
    function saving() {
      const st = s();
      return `<h2>Ukladanie a štart</h2>
        <div class="su-row"><span>Priečinok</span><div class="su-path"><code>${esc(st.clipsDir)}</code><button class="btn small" id="suDir">${I.folder}<span>Zmeniť</span></button></div></div>
        <div class="su-row col"><span>Upratovanie</span>${seg('cleanupGB', [{ v: 0, l: 'Vypnuté' }, { v: 20, l: '20 GB' }, { v: 50, l: '50 GB' }, { v: 100, l: '100 GB' }, { v: 200, l: '200 GB' }], st.cleanupGB || 0)}
          <small class="su-muted">Keď klipy zaberú viac, najstaršie pôjdu do <b>Koša</b> (dajú sa ešte obnoviť). Obľúbené a klipy v priečinkoch sa nikdy nemažú.</small>
          <div class="su-warn"${(st.cleanupGB || 0) ? '' : ' hidden'} id="suCleanWarn">Pozor: ak si vybral priečinok, kde už máš staršie klipy, aj tie sa počítajú do limitu a najstaršie z nich môžu ísť do Koša. Dôležité si daj do priečinka alebo medzi obľúbené.</div></div>
        <div class="su-row"><span>Vyrezať okno hry v editore<small class="su-muted">Keď hráš v okne, editor otvorí klip rovno s výrezom len hry.</small></span><label class="toggle"><input type="checkbox" data-set="autoWinCrop" ${st.autoWinCrop ? 'checked' : ''}></label></div>
        <div class="su-row"><span>Spúšťať s Windowsom</span><label class="toggle"><input type="checkbox" data-set="launchAtLogin" ${st.launchAtLogin ? 'checked' : ''}></label></div>
        <div class="su-row"><span>Overlay po uložení</span><div class="su-inline">${seg('overlayStyle', [{ v: 'eye', l: 'Oko' }, { v: 'clap', l: 'Klapka' }], st.overlayStyle || 'eye')}<button class="btn small ghost" id="suOv">Ukážka</button><label class="toggle"><input type="checkbox" data-set="overlay" ${st.overlay !== false ? 'checked' : ''}></label></div></div>
        <div class="su-row col"><span>Zvuk po uložení</span><div class="snd-grid">${SOUNDS.map(x => `<button class="snd${(st.clipSound || 'beep') === x.id ? ' on' : ''}" data-snd="${x.id}">${x.id === 'none' ? '' : '<i>▶</i>'}${esc(x.label)}</button>`).join('')}</div></div>`;
    }
    function done() {
      const st = s();
      return `<div class="su-hero">${EYE}
        <h1 id="suDoneT">Všetko je pripravené</h1>
        <p id="suDoneP">Skús to: prepni sa do hry alebo hocikam a stlač <kbd>${esc(st.hotkeys.clip)}</kbd>. Uloží sa posledných ${dur(st.bufferSeconds)}.</p>
        <div class="su-wait" id="suWait"><i></i><span>Čakám na prvý klip…</span></div>
        <p class="su-muted">Sprievodcu spustíš znova v Nastavenia → O appke.</p></div>`;
    }

    /* ---------- obsluha krokov ---------- */
    function setTrack(id, patch) { save({ tracks: s().tracks.map(t => t.id === id ? { ...t, ...patch } : t) }).then(render); }
    const bind = {
      1: body => {
        body.querySelectorAll('[data-hk]').forEach(b => b.onclick = () => captureKey(b));
        body.querySelectorAll('[data-set]').forEach(cb => cb.onchange = () => save({ [cb.dataset.set]: cb.checked }));
        segHandler(body);
      },
      2: body => {
        body.querySelectorAll('[data-on]').forEach(cb => cb.onchange = () => setTrack(cb.dataset.on, { on: cb.checked }));
        api.action('refreshDevices');
      },
      3: body => { clap = App.clapWidget($('#suClap', body), { onDone: () => { const n = $('#suNext', m); n.classList.add('pulse'); } }); },
      4: body => body.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => {
        save(PRESETS[b.dataset.pre].s);
        body.querySelectorAll('[data-pre]').forEach(x => x.classList.toggle('on', x === b));
      }),
      5: body => {
        $('#suDir', body).onclick = () => api.action('pickFolder').then(() => setTimeout(render, 200));
        $('#suOv', body).onclick = () => api.action('testOverlay');
        body.querySelectorAll('[data-set]').forEach(cb => cb.onchange = () => save({ [cb.dataset.set]: cb.checked }));
        body.querySelectorAll('[data-snd]').forEach(b => b.onclick = () => { sound(b.dataset.snd, s().soundVolume ?? 0.6); body.querySelectorAll('[data-snd]').forEach(x => x.classList.toggle('on', x === b)); save({ clipSound: b.dataset.snd }); });
        segHandler(body);
      },
      6: () => { if (firstClip) celebrate(); }
    };
    function segHandler(body) {
      body.querySelectorAll('.seg').forEach(sg => sg.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); placeThumbs(body, true);
        const k = sg.dataset.seg, v = b.dataset.v;
        save({ [k]: ['bufferSeconds', 'cleanupGB'].includes(k) ? Number(v) : v });
        if (k === 'cleanupGB') { const w = $('#suCleanWarn', body); if (w) w.hidden = !Number(v); }
        if (k === 'overlayStyle') setTimeout(() => api.action('testOverlay'), 150);
      }));
    }
    function captureKey(btn) {
      const id = btn.dataset.hk;
      btn.classList.add('listening'); btn.textContent = 'Stlač kombináciu…';
      const onKey = e => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { finish(); return; }
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
        const k = App.keyName ? App.keyName(e) : null;
        if (!k) { btn.textContent = 'Túto klávesu nepoznám, skús inú'; return; }
        const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
        if (!mods.length && !/^F\d+$|^num|^PrintScreen$|^Pause$|^Scrolllock$|^Insert$/.test(k)) { btn.textContent = 'Pridaj Ctrl, Alt alebo Shift'; return; }
        save({ hotkeys: { ...s().hotkeys, [id]: [...mods, k].join('+') } }).then(finish);
      };
      const finish = () => { document.removeEventListener('keydown', onKey, true); btn.classList.remove('listening'); render(); };
      document.addEventListener('keydown', onKey, true);
    }

    /* živé merače v kroku Zvuk */
    const disp = {};
    function onLv(e) {
      if (step !== 2) return;
      const lv = e.detail.levels || {};
      $$('[data-m]', m).forEach(b => {
        const v = lv[b.dataset.m] || 0, db = v > 0 ? 20 * Math.log10(v) : -90;
        const pct = Math.max(0, Math.min(100, (db + 54) / 54 * 100));
        disp[b.dataset.m] = Math.max(pct, (disp[b.dataset.m] || 0) * 0.85);
        b.style.width = disp[b.dataset.m] + '%';
      });
    }
    window.addEventListener('lat-levels', onLv);
    /* prvý klip počas sprievodcu = oslava */
    function onSaved() { firstClip = true; if (step === STEPS.length - 1) celebrate(); }
    window.addEventListener('lat-saved', onSaved);
    function celebrate() {
      const t = $('#suDoneT', m); if (!t) return;
      t.textContent = 'Prvý klip je tu!';
      $('#suDoneP', m).innerHTML = 'Nájdeš ho v knižnici. Klikni naň a môžeš ho strihať, pridať text alebo zmenšiť pre Discord.';
      const w = $('#suWait', m); w.classList.add('ok'); w.innerHTML = `${I.ok}<span>Uložené</span>`;
      m.querySelector('.su-lid') && m.querySelector('.su-lid').classList.add('wink');
    }

    const finishAll = () => { save({ onboarded: true }); closeModal(); };
    $('#suNext', m).onclick = () => { if (step >= STEPS.length - 1) return finishAll(); dir = 1; step++; render(); };
    $('#suBack', m).onclick = () => { if (step > 0) { dir = -1; step--; render(); } };
    $('#suSkip', m).onclick = finishAll;
    render();
  }

  return { open };
})();
