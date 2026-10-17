/* Nájdi nainštalované hry: Steam, Epic, GOG, Ubisoft, Xbox / Game Pass, Riot, Minecraft.
   Pre každú hru: názov, jej .exe súbory (aby sa dala spoznať v popredí) a ikonka. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const SKIP_EXE = /^(unins|uninstall|setup|install|vc_?redist|dxsetup|dotnet|ue4prereq|crash|crashreport|crashhandler|unitycrashhandler|easyanticheat|eac|beservice|be_|launcherpatcher|cefprocess|cefsharp|activationui|touchup|cleanup|redist|directx|oalinst|physx|steamworks|7z|quicksfv|notification_helper|zfgamebrowser|errorreporter|bugreport|report|sentry|update|updater|patcher)/i;
const SKIP_STEAM = /(redistributable|steamworks common|proton|steam linux runtime|steamvr|soundtrack|dedicated server|sdk)/i;

function reg(args) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve('');
    execFile('reg', args, { windowsHide: true, timeout: 8000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (e, out) => resolve(e ? '' : out || ''));
  });
}
async function exists(p) { try { await fsp.access(p); return true; } catch (e) { return false; } }
async function readText(p) { try { return await fsp.readFile(p, 'utf8'); } catch (e) { return ''; } }

/* .exe súbory hry do hĺbky 3, najväčší je asi hlavný */
async function findExes(dir, depth = 3) {
  const out = [];
  async function walk(d, lvl) {
    let items; try { items = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) {
        if (lvl < depth && !/^(redist|_commonredist|directx|vcredist|support|tools|__installer|installers|dotnet|prereq|easyanticheat|battleye|crashreport)/i.test(it.name)) await walk(p, lvl + 1);
      } else if (/\.exe$/i.test(it.name) && !SKIP_EXE.test(it.name)) {
        try { const st = await fsp.stat(p); out.push({ p, size: st.size }); } catch (e) { }
      }
      if (out.length > 40) return;
    }
  }
  await walk(dir, 0);
  return out.sort((a, b) => b.size - a.size).slice(0, 8);
}
const exeName = p => path.basename(p).replace(/\.exe$/i, '').toLowerCase();

/* ---------- Steam ---------- */
function vdfValues(text, key) {
  const re = new RegExp(`"${key}"\\s+"([^"]*)"`, 'gi'); const out = []; let m;
  while ((m = re.exec(text))) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}
async function steam() {
  const games = [];
  const q = await reg(['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
  let root = (/SteamPath\s+REG_SZ\s+(.+)/i.exec(q) || [])[1];
  root = process.env.CLIPIT_STEAM_ROOT || (root ? root.trim().replace(/\//g, '\\') : 'C:\\Program Files (x86)\\Steam');
  if (!(await exists(root))) return games;
  const libs = new Set([root]);
  const vdf = await readText(path.join(root, 'steamapps', 'libraryfolders.vdf'));
  vdfValues(vdf, 'path').forEach(p => libs.add(p));
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps');
    let files = []; try { files = (await fsp.readdir(apps)).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch (e) { continue; }
    for (const f of files) {
      const acf = await readText(path.join(apps, f));
      const appid = vdfValues(acf, 'appid')[0], name = vdfValues(acf, 'name')[0], dir = vdfValues(acf, 'installdir')[0];
      if (!appid || !name || !dir || SKIP_STEAM.test(name) || appid === '228980') continue;
      const full = path.join(apps, 'common', dir);
      const exes = await findExes(full);
      // ikonka: stará aj nová štruktúra librarycache
      const lc = path.join(root, 'appcache', 'librarycache');
      let icon = null;
      for (const c of [path.join(lc, `${appid}_icon.jpg`)]) if (await exists(c)) icon = c;
      if (!icon) {
        try {
          const sub = path.join(lc, appid);
          const items = await fsp.readdir(sub);
          // ikonka je malý .jpg s hashom v názve; inak vezmi obal hry
          const small = [];
          for (const it of items) if (/^[0-9a-f]{40}\.jpg$/i.test(it)) { const st = await fsp.stat(path.join(sub, it)); small.push({ p: path.join(sub, it), s: st.size }); }
          small.sort((a, b) => a.s - b.s);
          if (small.length) icon = small[0].p;
          else for (const n of ['library_600x900.jpg', 'header.jpg']) if (items.includes(n)) { icon = path.join(sub, n); break; }
        } catch (e) { }
      }
      games.push({ id: 'steam-' + appid, name, source: 'Steam', dir: full, exes: exes.map(e => exeName(e.p)), mainExe: exes[0] && exes[0].p, iconFile: icon });
    }
  }
  return games;
}

/* ---------- Epic ---------- */
async function epic() {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  const games = [];
  let files = []; try { files = (await fsp.readdir(dir)).filter(f => /\.item$/i.test(f)); } catch (e) { return games; }
  for (const f of files) {
    try {
      const j = JSON.parse(await readText(path.join(dir, f)));
      if (!j.DisplayName || !j.InstallLocation || (j.AppCategories && !j.AppCategories.includes('games'))) continue;
      const main = j.LaunchExecutable ? path.join(j.InstallLocation, j.LaunchExecutable) : null;
      const exes = await findExes(j.InstallLocation, 4);
      const list = [...new Set([main && exeName(main), ...exes.map(e => exeName(e.p))].filter(Boolean))];
      games.push({ id: 'epic-' + (j.AppName || j.CatalogItemId), name: j.DisplayName, source: 'Epic', dir: j.InstallLocation, exes: list, mainExe: main && (await exists(main)) ? main : exes[0] && exes[0].p });
    } catch (e) { }
  }
  return games;
}

/* ---------- GOG a Ubisoft (register) ---------- */
async function gog() {
  const out = await reg(['query', 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s']);
  const games = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const name = (/gameName\s+REG_SZ\s+(.+)/i.exec(block) || [])[1];
    const exe = (/\bexe\s+REG_SZ\s+(.+)/i.exec(block) || [])[1];
    const dir = (/\bpath\s+REG_SZ\s+(.+)/i.exec(block) || [])[1];
    const id = (/\\Games\\(\d+)/i.exec(block) || [])[1];
    if (!name || !dir) continue;
    const exes = await findExes(dir.trim());
    games.push({ id: 'gog-' + (id || name), name: name.trim(), source: 'GOG', dir: dir.trim(), exes: [...new Set([exe && exeName(exe.trim()), ...exes.map(e => exeName(e.p))].filter(Boolean))], mainExe: exe ? exe.trim() : exes[0] && exes[0].p });
  }
  return games;
}
async function ubisoft() {
  const out = await reg(['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs', '/s']);
  const games = [];
  for (const m of out.matchAll(/Installs\\(\d+)[\s\S]*?InstallDir\s+REG_SZ\s+(.+)/gi)) {
    const dir = m[2].trim().replace(/\//g, '\\');
    if (!(await exists(dir))) continue;
    const exes = await findExes(dir);
    games.push({ id: 'ubi-' + m[1], name: path.basename(dir.replace(/\\$/, '')), source: 'Ubisoft', dir, exes: exes.map(e => exeName(e.p)), mainExe: exes[0] && exes[0].p });
  }
  return games;
}

/* ---------- Xbox / Game Pass ---------- */
async function xbox() {
  const games = [];
  for (const drive of ['C', 'D', 'E', 'F']) {
    const root = `${drive}:\\XboxGames`;
    let dirs = []; try { dirs = await fsp.readdir(root, { withFileTypes: true }); } catch (e) { continue; }
    for (const d of dirs) {
      if (!d.isDirectory() || /^(gamesave|\.)/i.test(d.name)) continue;
      const content = path.join(root, d.name, 'Content');
      const exes = await findExes((await exists(content)) ? content : path.join(root, d.name));
      if (!exes.length) continue;
      games.push({ id: 'xbox-' + d.name, name: d.name, source: 'Xbox', dir: path.join(root, d.name), exes: exes.map(e => exeName(e.p)), mainExe: exes[0].p });
    }
  }
  return games;
}

/* ---------- Riot a Minecraft ---------- */
async function riot() {
  const games = [];
  const meta = 'C:\\ProgramData\\Riot Games\\Metadata';
  const known = {
    valorant: { name: 'VALORANT', exes: ['valorant-win64-shipping', 'valorant'], main: ['ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe', 'VALORANT.exe'] },
    league_of_legends: { name: 'League of Legends', exes: ['league of legends', 'leagueclient', 'leagueclientux'], main: ['Game\\League of Legends.exe', 'LeagueClient.exe'] },
    lion: { name: '2XKO', exes: ['2xko'], main: [] }
  };
  let dirs = []; try { dirs = await fsp.readdir(meta); } catch (e) { }
  const found = new Map();
  for (const d of dirs) {
    const key = d.replace(/\.live$/, '');
    if (!known[key]) continue;
    const yaml = await readText(path.join(meta, d, `${d}.product_settings.yaml`));
    const p = (/product_install_full_path:\s*"?([^"\r\n]+)"?/.exec(yaml) || [])[1];
    if (p) found.set(key, p.replace(/\//g, '\\'));
  }
  for (const key of Object.keys(known)) if (!found.has(key)) { const guess = key === 'valorant' ? 'C:\\Riot Games\\VALORANT\\live' : key === 'league_of_legends' ? 'C:\\Riot Games\\League of Legends' : null; if (guess && await exists(guess)) found.set(key, guess); }
  for (const [key, dir] of found) {
    const k = known[key];
    let main = null;
    for (const rel of k.main) { const p = path.join(dir, rel); if (await exists(p)) { main = p; break; } }
    games.push({ id: 'riot-' + key, name: k.name, source: 'Riot', dir, exes: k.exes, mainExe: main });
  }
  return games;
}
async function minecraft() {
  const appdata = process.env.APPDATA || '', local = process.env.LOCALAPPDATA || '', home = process.env.USERPROFILE || '';
  const has = await exists(path.join(appdata, '.minecraft')) || await exists(path.join(home, '.lunarclient'));
  if (!has) return [];
  const cands = [path.join(local, 'Programs', 'lunarclient', 'Lunar Client.exe'), 'C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe', 'C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe', path.join(local, 'Programs', 'Badlion Client', 'Badlion Client.exe')];
  let main = null; for (const c of cands) if (await exists(c)) { main = c; break; }
  return [{ id: 'minecraft', name: 'Minecraft', source: 'Minecraft', dir: path.join(appdata, '.minecraft'), exes: ['javaw', 'java', 'minecraft.windows', 'minecraftlauncher', 'lunar client'], mainExe: main }];
}

/* ---------- všetko spolu + ikonky ---------- */
async function scanAll(iconDir, getFileIcon) {
  const parts = await Promise.all([steam(), epic(), gog(), ubisoft(), xbox(), riot(), minecraft()].map(p => p.catch(() => [])));
  const all = [];
  const seen = new Set();
  for (const g of parts.flat()) {
    const key = g.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(g);
  }
  await fsp.mkdir(iconDir, { recursive: true }).catch(() => { });
  for (const g of all) {
    const safe = g.id.replace(/[^a-z0-9_-]/gi, '_');
    try {
      if (g.iconFile) {
        const dst = path.join(iconDir, safe + path.extname(g.iconFile));
        await fsp.copyFile(g.iconFile, dst); g.icon = dst;
      } else if (g.mainExe && getFileIcon) {
        const img = await getFileIcon(g.mainExe);
        if (img && !img.isEmpty()) { const dst = path.join(iconDir, safe + '.png'); await fsp.writeFile(dst, img.toPNG()); g.icon = dst; }
      }
    } catch (e) { }
    delete g.iconFile;
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { scanAll };
