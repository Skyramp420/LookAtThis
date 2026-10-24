/* Ľahké čítanie časov (PTS) priamo z MPEG-TS segmentov bufferu, bez spúšťania ffmpeg.
   Appka tak pri ukladaní clipu vie, čo v segmentoch SKUTOČNE je: či na seba nadväzujú, či v nich nie je diera v čase
   (spánok PC, zaseknutý obraz) a koľko clip naozaj trvá. Číta len začiatok a koniec každého súboru, takže je to okamžité. */
const fs = require('fs');

const PKT = 188, HZ = 90000, WRAP = 2 ** 33 / HZ;
const HEAD_PKTS = 512;   // ~96 kB zo začiatku
const TAIL_PKTS = 3072;  // ~576 kB z konca (posledný obrazový paket býva do pár desiatok kB od konca)

function pts(b, o) {
  return ((b[o] & 0x0e) * 536870912 + b[o + 1] * 4194304 + (b[o + 2] & 0xfe) * 16384 + b[o + 3] * 128 + (b[o + 4] >> 1)) / HZ;
}

/* prejde pakety a zavolá cb(kind, pts) pri každom začiatku PES s časom; kind = 'v' (obraz) | 'a' (zvuk) */
function walk(buf, cb) {
  const n = buf.length - (buf.length % PKT);
  for (let o = 0; o < n; o += PKT) {
    if (buf[o] !== 0x47) return false;                 // stratená synchronizácia
    if (!(buf[o + 1] & 0x40)) continue;                // len pakety, kde začína PES
    const afc = (buf[o + 3] >> 4) & 3;
    if (!(afc & 1)) continue;                           // bez dát
    let p = o + 4;
    if (afc & 2) p += 1 + buf[o + 4];
    if (p + 14 > o + PKT) continue;
    if (buf[p] !== 0 || buf[p + 1] !== 0 || buf[p + 2] !== 1) continue;
    const sid = buf[p + 3];
    if (!(buf[p + 7] & 0x80)) continue;                 // PES bez PTS
    const kind = sid >= 0xe0 && sid <= 0xef ? 'v' : sid >= 0xc0 && sid <= 0xdf ? 'a' : null;
    if (kind) cb(kind, pts(buf, p + 9));
  }
  return true;
}

/* { vFirst, vLast, aFirst, aLast, size } v sekundách; chýbajúce hodnoty sú null. Pri nečitateľnom súbore null. */
function range(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < PKT * 2) return null;
    const hl = Math.min(size, HEAD_PKTS * PKT), head = Buffer.alloc(hl);
    fs.readSync(fd, head, 0, hl, 0);
    let tail = head, from = 0;
    if (size > hl) {
      const tl = Math.min(size, TAIL_PKTS * PKT);
      from = Math.max(0, size - tl); from -= from % PKT;            // začiatok zarovnaný na paket
      tail = Buffer.alloc(size - from);
      fs.readSync(fd, tail, 0, tail.length, from);
    }
    const r = { vFirst: null, vLast: null, aFirst: null, aLast: null, size };
    const mn = (a, b) => (a == null || b < a ? b : a), mx = (a, b) => (a == null || b > a ? b : a);
    if (!walk(head, (k, t) => { if (k === 'v') r.vFirst = mn(r.vFirst, t); else r.aFirst = mn(r.aFirst, t); })) return null;
    if (!walk(tail, (k, t) => { if (k === 'v') r.vLast = mx(r.vLast, t); else r.aLast = mx(r.aLast, t); })) return null;
    return r;
  } catch (e) { return null; }
  finally { if (fd != null) try { fs.closeSync(fd); } catch (e) { } }
}

/* rozdiel časov b − a s ohľadom na prekrútenie 33-bitového PTS (po ~26 hodinách) */
function diff(a, b) { let d = b - a; if (d < -WRAP / 2) d += WRAP; else if (d > WRAP / 2) d -= WRAP; return d; }

module.exports = { range, diff };
