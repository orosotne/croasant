#!/usr/bin/env node
// Tile each film's frames into sprite atlases for hosts that cap the file
// count (a claude.ai artifact version holds at most 511 files and serves only
// standard web types, so 2,000 loose frames or a binary pack won't do).
//
// Every atlas is a real 3840×2160 WebP: 2×2 frames at 1920 px, 4×4 at 960 px,
// holding consecutive frames so scrubbing stays inside one atlas for a while.
//
// usage: node scripts/atlas-frames.mjs <outDir> [--widths 1920,960]
// writes <outDir>/atlas/<film>-<width>-NNN.webp and <outDir>/frames/manifest.json
// (public/frames/manifest.json plus an `atlases` index).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('usage: atlas-frames.mjs <outDir> [--widths 1920,960]');
  process.exit(1);
}
const wi = process.argv.indexOf('--widths');
const widths = wi > 0 ? process.argv[wi + 1].split(',').map(Number) : [1920, 960];
const GRID = { 1920: [2, 2], 960: [4, 4] };

const manifest = JSON.parse(fs.readFileSync('public/frames/manifest.json', 'utf8'));
const films = ['spin', 'crunch', 'lamination', 'crumb', 'bake'];

fs.mkdirSync(path.join(out, 'atlas'), { recursive: true });
fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
const atlases = {};
for (const width of widths) {
  const [cols, rows] = GRID[width];
  const height = Math.round((width * 9) / 16);
  atlases[width] = { cols, rows, w: width, h: height, films: {} };
  for (const film of films) {
    const pattern = path.join(out, 'atlas', `${film}-${width}-%03d.webp`);
    execFileSync('ffmpeg', [
      '-v', 'error', '-framerate', '1', '-i', `public/frames/${film}/${width}/%03d.webp`,
      '-vf', `tile=${cols}x${rows}`, '-c:v', 'libwebp', '-quality', '86', '-compression_level', '5',
      '-start_number', '0', pattern,
    ]);
    const files = fs
      .readdirSync(path.join(out, 'atlas'))
      .filter((f) => f.startsWith(`${film}-${width}-`))
      .sort()
      .map((f) => `atlas/${f}`);
    const perAtlas = cols * rows;
    if (files.length !== Math.ceil(manifest[film].count / perAtlas)) throw new Error(`${film}@${width}: ${files.length} atlases`);
    atlases[width].films[film] = files;
    const mb = files.reduce((s, f) => s + fs.statSync(path.join(out, f)).size, 0) / 1e6;
    console.log(`${film} @${width}: ${files.length} atlases of ${perAtlas} frames, ${mb.toFixed(1)} MB`);
  }
}
fs.writeFileSync(path.join(out, 'frames/manifest.json'), JSON.stringify({ ...manifest, atlases }) + '\n');
