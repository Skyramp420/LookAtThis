/* Pekné názvy hier podľa názvu .exe a odvodenie hry z názvu súboru.
   Beží v main procese (require) aj v okne (window.Games). */
(function (root) {
  const KNOWN = {
    'valorant-win64-shipping': 'VALORANT', 'valorant': 'VALORANT',
    'javaw': 'Minecraft', 'java': 'Minecraft', 'minecraft': 'Minecraft', 'minecraft.windows': 'Minecraft', 'lunar client': 'Minecraft',
    'cs2': 'Counter-Strike 2', 'csgo': 'CS:GO',
    'fortniteclient-win64-shipping': 'Fortnite', 'fortniteclient-win64-shipping_eac_eos': 'Fortnite',
    'r5apex': 'Apex Legends', 'r5apex_dx12': 'Apex Legends',
    'league of legends': 'League of Legends', 'leagueoflegends': 'League of Legends',
    'robloxplayerbeta': 'Roblox', 'windows10universal': 'Roblox',
    'gta5': 'GTA V', 'gta5_enhanced': 'GTA V', 'gtavlauncher': 'GTA V',
    'rocketleague': 'Rocket League', 'overwatch': 'Overwatch 2',
    'eldenring': 'Elden Ring', 'cod': 'Call of Duty', 'cod24': 'Call of Duty', 'blackops6': 'Call of Duty',
    'brawlhalla': 'Brawlhalla', 'rainbowsix': 'Rainbow Six Siege', 'rainbowsix_vulkan': 'Rainbow Six Siege',
    'dota2': 'Dota 2', 'destiny2': 'Destiny 2', 'deadlock': 'Deadlock', 'project8': 'Deadlock',
    'marvel-win64-shipping': 'Marvel Rivals', 'osu!': 'osu!', 'beat saber': 'Beat Saber', 'beatsaber': 'Beat Saber',
    'terraria': 'Terraria', 'stardew valley': 'Stardew Valley', 'helldivers2': 'Helldivers 2',
    'palworld-win64-shipping': 'Palworld', 'tslgame': 'PUBG', 'aces': 'War Thunder', 'escapefromtarkov': 'Escape from Tarkov',
    'thefinals': 'THE FINALS', 'discovery': 'THE FINALS', 'cyberpunk2077': 'Cyberpunk 2077', 'witcher3': 'The Witcher 3',
    'hollow_knight': 'Hollow Knight', 'among us': 'Among Us', 'phasmophobia': 'Phasmophobia', 'lethal company': 'Lethal Company',
    'rust': 'Rust', 'rustclient': 'Rust', 'geometrydash': 'Geometry Dash', 'blender': 'Blender', 'resolve': 'DaVinci Resolve',
    'afterfx': 'After Effects', 'chrome': 'Chrome', 'msedge': 'Edge', 'firefox': 'Firefox'
  };
  const GENERIC = ['clip', 'nahrávka', 'nahravka', ''];

  /* „VALORANT-Win64-Shipping.exe“ → „VALORANT“
     poradie: vlastné premenovanie > nainštalované hry (exe → názov) > známe > očistený názov exe */
  function pretty(raw, custom, detected) {
    if (!raw) return '';
    const key = String(raw).replace(/\.exe$/i, '').trim();
    if (custom && custom[key]) return custom[key];
    const k = key.toLowerCase();
    if (detected && detected[k]) return custom && custom[detected[k]] ? custom[detected[k]] : detected[k];
    if (KNOWN[k]) return KNOWN[k];
    // odstráň typické prípony buildov
    return key.replace(/[-_ ](win64|win32|x64)?[-_ ]?shipping$/i, '').replace(/[-_](dx1[12]|vulkan|eac|eos)$/i, '').trim() || key;
  }

  /* hra z názvu súboru „VALORANT 2026-10-16 19-42-10 (strih).mp4“ */
  function fromFileName(name) {
    const m = /^(.*?)\s+\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}/.exec(String(name || ''));
    if (!m) return '';
    const g = m[1].trim();
    return GENERIC.includes(g.toLowerCase()) ? '' : g;
  }

  const api = { pretty, fromFileName, KNOWN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Games = api;
})(typeof window !== 'undefined' ? window : globalThis);
