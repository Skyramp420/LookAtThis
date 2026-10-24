/* Meranie, koľko výkonu berie LookAtThis: procesor, grafika, pamäť a zápis na disk.
   Beží LEN kým je v Nastaveniach otvorená karta Výkon (okno ju každé 4 s „pingne“, bez pingu sa meranie samo vypne),
   takže samo meranie nezaťažuje hru.
   - procesy Electronu (okno, overlay): app.getAppMetrics()
   - ffmpeg a pomocníci so zvukom: jeden dlhodobo bežiaci PowerShell, ktorý číta čas procesora a pamäť (Get-Process)
     a každé 2. meranie aj využitie grafiky (počítadlá Windowsu „GPU Engine“, vrátane video enkodéra NVENC). */
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const os = require('os');

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$ci = [Globalization.CultureInfo]::InvariantCulture
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split('|')
  $ids = @()
  if ($parts.Length -gt 1) { foreach ($x in $parts[1].Split(',')) { if ($x -match '^[0-9]+$') { $ids += [int]$x } } }
  if ($parts[0] -eq 'p') {
    $o = @()
    if ($ids.Count -gt 0) {
      foreach ($p in (Get-Process -Id $ids)) {
        $o += ('{0},{1},{2}' -f $p.Id, ([math]::Round($p.TotalProcessorTime.TotalSeconds, 3)).ToString($ci), $p.PrivateMemorySize64)
      }
    }
    [Console]::Out.WriteLine('p|' + ($o -join ';'))
  } elseif ($parts[0] -eq 'g') {
    $enc = 0.0; $oth = 0.0; $ok = $false
    $c = Get-Counter '\\GPU Engine(*)\\Utilization Percentage'
    if ($c -ne $null) {
      $ok = $true
      foreach ($s in $c.CounterSamples) {
        if ($s.InstanceName -match '^pid_([0-9]+)_') {
          if ($ids -contains [int]$Matches[1]) {
            if ($s.InstanceName -match 'engtype_VideoEncode') { $enc += $s.CookedValue } else { $oth += $s.CookedValue }
          }
        }
      }
    }
    if ($ok) { [Console]::Out.WriteLine('g|' + $enc.ToString('0.0', $ci) + '|' + $oth.ToString('0.0', $ci)) } else { [Console]::Out.WriteLine('g|na') }
  } else { [Console]::Out.WriteLine('x|') }
  [Console]::Out.Flush()
}
`;

class Perf extends EventEmitter {
  /* metrics() → app.getAppMetrics(); children() → [{ pid, role }]; disk() → bajty za sekundu alebo null */
  constructor({ metrics, children, disk, log }) {
    super();
    this.metrics = metrics; this.children = children; this.disk = disk; this.log = log || console;
    this.cores = Math.max(1, os.cpus().length);
    this.timer = null; this.idle = null; this.ps = null; this.buf = ''; this.waiters = [];
    this.prev = new Map(); this.n = 0; this.busy = false; this.gpu = null; this.psOk = true;
  }

  /* okno žije a pozerá na kartu Výkon: spusti (alebo predĺž) meranie */
  ping() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), 12000);
    if (this.timer) return;
    this.n = 0; this.prev = new Map();
    this.timer = setInterval(() => this.tick().catch(e => this.log.warn('meranie výkonu: ' + e.message)), 2000);
    this.tick().catch(() => { });
  }
  stop() {
    clearInterval(this.timer); this.timer = null;
    clearTimeout(this.idle); this.idle = null;
    this.prev = new Map(); this.gpu = null;
    if (this.ps) { try { this.ps.stdin.end(); this.ps.kill(); } catch (e) { } this.ps = null; }
    this.flush(null);
  }

  /* ---------- PowerShell ---------- */
  ensurePs() {
    if (this.ps) return true;
    if (process.platform !== 'win32') return false;
    try {
      const b64 = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
      const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      p.on('error', e => { this.log.warn('meranie výkonu: PowerShell sa nespustil (' + e.message + ')'); if (this.ps === p) this.ps = null; this.psOk = false; this.flush(null); });
      p.on('exit', () => { if (this.ps === p) this.ps = null; this.flush(null); });
      p.stdin.on('error', () => { });
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', d => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.line(l); }
      });
      try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { }
      this.ps = p; this.buf = '';
      return true;
    } catch (e) { this.log.warn('meranie výkonu: ' + e.message); this.psOk = false; return false; }
  }
  line(l) {
    const i = this.waiters.findIndex(w => l.startsWith(w.prefix));
    if (i < 0) return;
    const [w] = this.waiters.splice(i, 1);
    clearTimeout(w.timer); w.resolve(l);
  }
  flush(val) { const ws = this.waiters; this.waiters = []; for (const w of ws) { clearTimeout(w.timer); w.resolve(val); } }
  ask(cmd, prefix, timeout) {
    return new Promise(resolve => {
      if (!this.ensurePs()) return resolve(null);
      const w = { prefix, resolve, timer: setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); resolve(null); }, timeout) };
      this.waiters.push(w);
      try { this.ps.stdin.write(cmd + '\n'); } catch (e) { this.waiters = this.waiters.filter(x => x !== w); clearTimeout(w.timer); resolve(null); }
    });
  }

  /* ---------- jedno meranie ---------- */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const t = Date.now(), n = this.n++;
      let em = []; try { em = this.metrics() || []; } catch (e) { }
      const kids = this.children() || [];
      const ePids = em.map(m => m.pid).filter(Boolean);
      const kPids = kids.map(k => k.pid).filter(Boolean);

      // okno appky (Electron): percentCPUUsage je v „jadrách × 100“
      const app = { cpu: em.reduce((a, m) => a + ((m.cpu && m.cpu.percentCPUUsage) || 0), 0) / 100, ram: em.reduce((a, m) => a + ((m.memory && (m.memory.privateBytes || m.memory.workingSetSize)) || 0), 0) * 1024 };

      // ffmpeg + pomocníci: CPU čas a pamäť z PowerShellu
      const roles = {}, got = new Set();
      let complete = true;
      if (kPids.length) {
        const r = await this.ask('p|' + kPids.join(','), 'p|', 5000);
        if (r) {
          for (const item of r.slice(2).split(';')) {
            const [pid, cpu, ram] = item.split(',');
            if (!pid) continue;
            const P = +pid, sec = parseFloat(cpu), mem = +ram, role = (kids.find(k => k.pid === P) || {}).role || 'other';
            const o = roles[role] || (roles[role] = { cpu: 0, ram: 0 });
            o.ram += mem || 0; got.add(P);
            const pv = this.prev.get(P);
            if (pv && t > pv.t && isFinite(sec)) o.cpu += Math.max(0, (sec - pv.sec) / ((t - pv.t) / 1000));
            else complete = false;
            if (isFinite(sec)) this.prev.set(P, { sec, t });
          }
          for (const k of [...this.prev.keys()]) if (!kPids.includes(k)) this.prev.delete(k);
        } else { this.psOk = false; complete = false; }
      }

      // grafika (každé 2. meranie, počítadlá sú pomalšie)
      if (n % 2 === 0 && (ePids.length || kPids.length)) {
        const g = await this.ask('g|' + [...ePids, ...kPids].join(','), 'g|', 8000);
        if (g && g !== 'g|na') { const [, enc, oth] = g.split('|'); this.gpu = { enc: parseFloat(enc) || 0, other: parseFloat(oth) || 0 }; }
        else if (g === 'g|na') this.gpu = 'na';
      }

      const pct = c => c / this.cores * 100;
      const parts = [{ id: 'app', cpu: pct(app.cpu), ram: app.ram }];
      for (const id of ['enc', 'audio', 'keys', 'other']) if (roles[id]) parts.push({ id, cpu: pct(roles[id].cpu), ram: roles[id].ram });
      const cpu = n === 0 && !complete ? null : parts.reduce((a, p) => a + p.cpu, 0);
      this.emit('sample', {
        cpu, parts, ram: parts.reduce((a, p) => a + p.ram, 0), cores: this.cores,
        gpu: this.gpu && this.gpu !== 'na' ? this.gpu : null, gpuNa: this.gpu === 'na',
        disk: (() => { try { return this.disk(); } catch (e) { return null; } })(), psOk: this.psOk || !kPids.length, warm: !complete
      });
    } finally { this.busy = false; }
  }
}

module.exports = { Perf };
