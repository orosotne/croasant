#!/usr/bin/env node
// Assemble the site as a claude.ai artifact.
//
// The artifact host wraps the page in its own doctype/head/body, only admits
// scripts from a few CDNs, serves only standard web file types, and caps a
// version at 511 files. So:
//   - the page is a fragment with the CSS and the site's JS inlined,
//   - Lenis loads from a pinned jsDelivr build (src/lib/lenis-global.js),
//   - fonts come from Google Fonts (index.html already links them),
//   - the 2,000 frames ship as 315 WebP sprite atlases (scripts/atlas-frames.mjs).
//
// usage: node scripts/build-artifact.mjs [outDir]      (default media/tmp/artifact)
// writes lamina.html (the page), img/, atlas/, frames/manifest.json,
// manifest-960.json (a manifest listing only the 960 px atlases, for publishing
// in stages) and _preview.html (a local stand-in for the host's skeleton).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'media/tmp/artifact';
const dist = 'media/tmp/artifact-dist';
const LENIS = 'https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync('npx', ['vite', 'build', '--config', 'vite.artifact.config.js', '--logLevel', 'warn'], { stdio: 'inherit' });

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const cssFile = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"/)[1];
const jsFile = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"/)[1];
const css = fs.readFileSync(path.join(dist, cssFile), 'utf8').replaceAll('</style', '<\\/style');
const js = fs.readFileSync(path.join(dist, jsFile), 'utf8').replaceAll('</script', '<\\/script');
if (/url\((?!["']?data:)/.test(css)) throw new Error('built CSS still references files; inline them first');

const title = html.match(/<title>[^<]*<\/title>/)[0];
const fonts = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts\.[^>]*>/g)].map((m) => m[0]);
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script[\s\S]*?<\/script>\s*/g, '\n')
  .trim();

const page = [title, ...fonts, `<style>\n${css}\n</style>`, body, `<script src="${LENIS}"></script>`, `<script type="module">\n${js}\n</script>`, ''].join('\n');
fs.writeFileSync(path.join(out, 'lamina.html'), page);

fs.cpSync('public/img', path.join(out, 'img'), { recursive: true });
execFileSync('node', ['scripts/atlas-frames.mjs', out], { stdio: 'inherit' });

// A manifest that lists only the phone-size atlases, so the page works while
// the larger atlases are still being uploaded.
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'frames/manifest.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'manifest-960.json'), JSON.stringify({ ...manifest, atlases: { 960: manifest.atlases[960] } }) + '\n');

// Local stand-in for the host skeleton (doctype, charset, viewport, small reset).
fs.writeFileSync(
  path.join(out, '_preview.html'),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif;background:#f7f7f5}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
${page}</body></html>
`,
);

const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
walk(out);
const bytes = files.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`page ${(page.length / 1024).toFixed(0)} KB; ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB in ${out}`);
