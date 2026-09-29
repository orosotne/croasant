#!/usr/bin/env node
// Measure the finished frames so the overlays line up with what is on screen,
// instead of guessing timings. Writes manifest.events:
//
//   crunch.snap        film fraction where the break happens (onset of the big
//                      motion spike); the dB meter peaks and the crunch sound
//                      fires there.
//   lamination.slices  [{x, y}] frame-space position just above each of the
//                      seven slices in the final frame, for the CT labels.
//   bake.colors        [{hex, t}] crust colour per frame, sampled around the
//                      croissant, and t = how far it has darkened (0 raw, 1 done).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const MANIFEST = 'public/frames/manifest.json';
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

function decode(film, w, h, pixFmt, only) {
  const input = only === undefined ? `public/frames/${film}/960/%03d.webp` : `public/frames/${film}/960/${String(only).padStart(3, '0')}.webp`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', input, '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', pixFmt, '-'], {
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout;
}

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const events = manifest.events || {};

/* crunch: the moment the crack splits open.
   Kling moves the croissant steadily the whole time, so raw motion can't see
   the break. Instead, count dark "gap" pixels inside the unbroken croissant's
   silhouette: they stay near zero until the crack opens, then climb as the
   halves part. The snap is where that count first clears a small threshold. */
{
  const W = 192, H = 108, S = W * H;
  const raw = decode('crunch', W, H, 'gray');
  const n = raw.length / S;
  const inside = new Uint8Array(S);
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      let solid = true;
      for (let dy = -3; dy <= 3 && solid; dy++) for (let dx = -3; dx <= 3 && solid; dx++) solid = raw[(y + dy) * W + x + dx] > 45;
      inside[y * W + x] = solid ? 1 : 0;
    }
  }
  const area = inside.reduce((a, b) => a + b, 0);
  const gap = [];
  for (let f = 0; f < n; f++) {
    let g = 0;
    for (let p = 0; p < S; p++) if (inside[p] && raw[f * S + p] < 32) g++;
    gap.push(g / area);
  }
  const snapAt = gap.findIndex((g) => g > 0.012);
  const snap = snapAt < 0 ? 0.15 : snapAt / (n - 1);
  events.crunch = { snap: +snap.toFixed(4) };
  console.log('crunch', events.crunch, 'gap%', gap.filter((_, i) => i % 5 === 0).map((g) => (g * 100).toFixed(1)).join(' '));
}

/* lamination: seven slice columns in the last frame */
{
  const W = 480, H = 270;
  const last = manifest.lamination.count - 1;
  const px = decode('lamination', W, H, 'gray', last);
  const col = new Array(W).fill(0);
  const topOf = new Array(W).fill(H);
  const bottomOf = new Array(W).fill(0);
  for (let x = 0; x < W; x++) {
    for (let y = Math.floor(H * 0.08); y < Math.floor(H * 0.92); y++) {
      if (px[y * W + x] > 38) {
        col[x]++;
        if (y < topOf[x]) topOf[x] = y;
        if (y > bottomOf[x]) bottomOf[x] = y;
      }
    }
  }
  const on = col.map((c) => c > H * 0.06);
  let runs = [];
  for (let x = 0; x < W; x++) {
    if (!on[x]) continue;
    let e = x;
    while (e + 1 < W && on[e + 1]) e++;
    runs.push({ s: x, e, mass: col.slice(x, e + 1).reduce((a, b) => a + b, 0) });
    x = e;
  }
  // Merge runs split by a hairline gap, then keep the seven heaviest.
  runs = runs.reduce((acc, r) => {
    const prev = acc[acc.length - 1];
    if (prev && r.s - prev.e <= 3) {
      prev.e = r.e;
      prev.mass += r.mass;
    } else acc.push({ ...r });
    return acc;
  }, []);
  const seven = runs.sort((a, b) => b.mass - a.mass).slice(0, 7).sort((a, b) => a.s - b.s);
  if (seven.length === 7) {
    events.lamination = {
      slices: seven.map((r) => {
        const top = Math.min(...topOf.slice(r.s, r.e + 1));
        const bottom = Math.max(...bottomOf.slice(r.s, r.e + 1));
        return { x: +((r.s + r.e) / 2 / W).toFixed(4), y: +(top / H).toFixed(4), b: +(bottom / H).toFixed(4) };
      }),
    };
  } else {
    console.warn(`lamination: found ${seven.length} slices, falling back to even spacing`);
    delete events.lamination;
  }
  console.log('lamination', JSON.stringify(events.lamination), 'runs', runs.length);
}

/* bake: crust colour per frame around the croissant */
{
  const W = 240, H = 135, S = W * H * 3;
  const raw = decode('bake', W, H, 'rgb24');
  const n = raw.length / S;
  // The croissant is where the first and last frames differ most.
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const a = luma(raw[i], raw[i + 1], raw[i + 2]);
      const j = (n - 1) * S + i;
      const b = luma(raw[j], raw[j + 1], raw[j + 2]);
      const diff = Math.abs(a - b);
      if (diff > 28) {
        sx += x * diff;
        sy += y * diff;
        sw += diff;
      }
    }
  }
  const cx = Math.round(sx / sw);
  const cy = Math.round(sy / sw);
  const bw = Math.round(W * 0.05);
  const bh = Math.round(H * 0.035);
  const colors = [];
  for (let f = 0; f < n; f++) {
    let r = 0, g = 0, b = 0, k = 0;
    for (let y = cy - bh; y <= cy + bh; y++) {
      for (let x = cx - bw; x <= cx + bw; x++) {
        const i = f * S + (y * W + x) * 3;
        r += raw[i];
        g += raw[i + 1];
        b += raw[i + 2];
        k++;
      }
    }
    colors.push([r / k, g / k, b / k]);
  }
  // Browning index (Buera et al.), the standard food-science measure of crust
  // colour, from CIELAB. Luminance alone misses the yellowing phase: under the
  // oven's orange light the dough stays bright until late in the bake.
  const lab = ([r, g, b]) => {
    const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
    const Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
    const Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  };
  const browning = (rgb) => {
    const [L, a, b] = lab(rgb);
    const x = (a + 1.75 * L) / (5.645 * L + a - 3.012 * b);
    return (100 * (x - 0.31)) / 0.17;
  };
  // Light smoothing over five frames, then normalise raw → done.
  const smoothed = colors.map((_, i) => {
    const win = colors.slice(Math.max(0, i - 2), i + 3);
    return [0, 1, 2].map((k) => win.reduce((s, c) => s + c[k], 0) / win.length);
  });
  const BI = smoothed.map(browning);
  const B0 = BI.slice(0, 4).reduce((a, b) => a + b) / 4;
  const B1 = BI.slice(-4).reduce((a, b) => a + b) / 4;
  let tPrev = 0;
  events.bake = {
    spot: { x: +(cx / W).toFixed(4), y: +(cy / H).toFixed(4) },
    colors: smoothed.map(([r, g, b], i) => {
      // Monotonic so the colour name never steps backwards mid-bake.
      const t = Math.max(tPrev, Math.min(1, Math.max(0, (BI[i] - B0) / (B1 - B0 || 1))));
      tPrev = t;
      const hex = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
      return { hex, t: +t.toFixed(3) };
    }),
  };
  const at = (q) => events.bake.colors[Math.round(q * (n - 1))];
  console.log('bake spot', events.bake.spot, 'BI', B0.toFixed(1), '→', B1.toFixed(1), 't@25/50/75%', at(0.25).t, at(0.5).t, at(0.75).t, 'first', at(0), 'last', at(1));
}

manifest.events = events;
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', MANIFEST);
