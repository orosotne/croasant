#!/usr/bin/env node
// Find the frames Kling holds before the motion starts (and after it ends).
//
// Kling image-to-video renders usually sit on the start image for a few
// frames before anything moves (11–16 frames on these films). Scrubbing those
// feels like dead scroll, so they are trimmed before slicing.
//
// A frame counts as "held" while it is still indistinguishable from the first
// frame (start hold) or from the final frame (end hold). Measuring distance to
// the anchor frame, rather than frame-to-frame change, keeps slow films intact:
// the bake time-lapse changes by ~0.1 grey levels per frame, which would read as
// "static" frame-to-frame even though the crust is still browning.
//
// usage: node scripts/detect-hold.mjs <film.mp4> [--verbose]
// prints JSON: { frames, fps, first, last, epsilon }
//   first = first frame to keep (the last frame of the start hold)
//   last  = last frame to keep  (the first frame of the end hold)
import { spawnSync } from 'node:child_process';

const file = process.argv[2];
const verbose = process.argv.includes('--verbose');
if (!file) {
  console.error('usage: detect-hold.mjs <film.mp4> [--verbose]');
  process.exit(1);
}

const probe = JSON.parse(
  spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'json', file]).stdout,
);
const [num, den] = probe.streams[0].r_frame_rate.split('/').map(Number);

const W = 192, H = 108, S = W * H;
const raw = spawnSync(
  'ffmpeg',
  ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'],
  { maxBuffer: 1 << 30 },
).stdout;
const frames = Math.floor(raw.length / S);

// Mean absolute difference between two frames, in 0..255 grey levels.
const mad = (a, b) => {
  let s = 0;
  for (let p = 0; p < S; p++) s += Math.abs(raw[a * S + p] - raw[b * S + p]);
  return s / S;
};

const fromFirst = Array.from({ length: frames }, (_, i) => mad(0, i));
const toLast = Array.from({ length: frames }, (_, i) => mad(i, frames - 1));
// "Indistinguishable" scales with how much the film changes overall, with a
// floor above encoder noise (hold frames jitter by ~0.05 grey levels).
const epsilon = Math.max(0.25, 0.02 * Math.max(...fromFirst));

let first = 0;
while (first + 1 < frames && fromFirst[first + 1] < epsilon) first++;
let last = frames - 1;
while (last - 1 > first && toLast[last - 1] < epsilon) last--;

const out = { file, frames, fps: num / den, epsilon: +epsilon.toFixed(3), first, last };
if (verbose) {
  out.fromFirst = fromFirst.map((d) => +d.toFixed(2));
  out.toLast = toLast.map((d) => +d.toFixed(2));
}
console.log(JSON.stringify(out));
