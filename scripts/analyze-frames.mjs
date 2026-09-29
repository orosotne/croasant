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

/* crunch: onset of the largest motion spike */
{
  const W = 192, H = 108, S = W * H;
  const raw = decode('crunch', W, H, 'gray');
  const n = raw.length / S;
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    let s = 0;
    for (let p = 0; p < S; p++) s += Math.abs(raw[i * S + p] - raw[(i + 1) * S + p]);
    d.push(s / S);
  }
  const sm = d.map((_, i) => (d[Math.max(0, i - 1)] + d[i] + d[Math.min(d.length - 1, i + 1)]) / 3);
  const peak = sm.indexOf(Math.max(...sm));
  let onset = peak;
  while (onset > 0 && sm[onset - 1] > sm[peak] * 0.45) onset--;
  events.crunch = { snap: +(onset / (n - 1)).toFixed(4), peak: +(peak / (n - 1)).toFixed(4) };
  console.log('crunch', events.crunch, 'diffs', sm.map((v) => v.toFixed(1)).join(' '));
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
  const L = colors.map(([r, g, b]) => luma(r, g, b));
  const L0 = L.slice(0, 4).reduce((a, b) => a + b) / 4;
  const L1 = L.slice(-4).reduce((a, b) => a + b) / 4;
  let tPrev = 0;
  events.bake = {
    spot: { x: +(cx / W).toFixed(4), y: +(cy / H).toFixed(4) },
    colors: colors.map(([r, g, b], i) => {
      // Monotonic so the colour name never steps backwards mid-bake.
      const t = Math.max(tPrev, Math.min(1, Math.max(0, (L0 - L[i]) / (L0 - L1 || 1))));
      tPrev = t;
      const hex = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
      return { hex, t: +t.toFixed(3) };
    }),
  };
  console.log('bake spot', events.bake.spot, 'L0', L0.toFixed(1), 'L1', L1.toFixed(1), 'first', events.bake.colors[0], 'last', events.bake.colors.at(-1));
}

manifest.events = events;
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', MANIFEST);
