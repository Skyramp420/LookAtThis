/* Plán kompresie na cieľovú veľkosť: z dĺžky klipu vypočíta dátový tok a vyberie
   najlepšie rozlíšenie a fps, ktoré sa pri tom toku ešte dajú pozerať.
   Beží v main procese (require) aj v okne (window.Compress). */
(function (root) {
  const PRESETS = [
    { id: 'discord', mb: 20, label: 'Discord', sub: '20 MB · bez Nitra' },
    { id: 'small', mb: 10, label: 'Malý', sub: '10 MB · staré limity, iné appky' },
    { id: 'nitro', mb: 50, label: 'Nitro Basic', sub: '50 MB' }
  ];
  const MIN_VKBPS = 150;        // pod týmto už video nemá zmysel
  // bitov na pixel a snímku, pri ktorých hra ešte vyzerá slušne (pri 60 fps sa snímky viac podobajú, stačí menej)
  const BPP60 = 0.042, BPP30 = 0.05;
  const SAFETY = 0.94;          // rezerva na kontajner a nepresnosť enkodéra

  /* o = { duration, width, height, fps, targetMB, audio } → plán */
  function plan(o) {
    const D = Math.max(0.5, Number(o.duration) || 0.5);
    const srcH = Number(o.height) || 1080, srcW = Number(o.width) || Math.round(srcH * 16 / 9), srcFps = Number(o.fps) || 60;
    const ak = o.audio === false ? 0 : o.targetMB <= 12 ? 96 : 128;
    const totalK = (o.targetMB * 1e6 * 8 * SAFETY) / 1000 / D;     // kbit/s; MB = 10^6 B (bezpečnejšie ako MiB)
    const vk = Math.floor(totalK - ak);
    const aspect = srcW / srcH;
    const heights = [1440, 1080, 900, 720, 540, 480, 360].filter(h => h <= srcH);
    if (!heights.includes(srcH) && srcH <= 1440) heights.unshift(srcH); // natívne rozlíšenie, ak nie je v rebríčku
    const fps60 = srcFps >= 50 ? Math.min(60, srcFps) : null, fps30 = Math.min(30, srcFps);
    // poradie: najprv plynulých 60 fps od 720p vyššie, potom 30 fps, nakoniec čokoľvek malé
    const cands = [];
    if (fps60) heights.filter(h => h >= 720).forEach(h => cands.push([h, fps60]));
    heights.forEach(h => cands.push([h, fps30]));
    let pick = cands[cands.length - 1];
    for (const c of cands) {
      const w = Math.round(c[0] * aspect);
      if ((vk * 1000) / (w * c[0] * c[1]) >= (c[1] > 40 ? BPP60 : BPP30)) { pick = c; break; }
    }
    const maxSeconds = Math.floor((o.targetMB * 1e6 * 8 * SAFETY) / 1000 / (MIN_VKBPS + ak));
    return {
      ok: vk >= MIN_VKBPS, vkbps: Math.max(vk, MIN_VKBPS), akbps: ak, height: pick[0] - (pick[0] % 2), fps: pick[1],
      width: Math.round(pick[0] * aspect / 2) * 2, maxSeconds, quality: vk >= 4000 ? 'výborná' : vk >= 1800 ? 'dobrá' : vk >= 700 ? 'ujde' : 'slabá'
    };
  }

  const api = { plan, PRESETS, MIN_VKBPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Compress = api;
})(typeof window !== 'undefined' ? window : globalThis);
