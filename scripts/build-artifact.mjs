// Packs the site for publishing as a claude.ai Artifact: one HTML page with its
// CSS and JS inlined (the viewer's CSP only allows scripts from a few CDNs),
// fonts from Google Fonts instead of self-hosted files, and the large frame tier
// only (the Artifact file limit can't fit both tiers).
//   npm run build:artifact   ->  dist-artifact/index.html + dist-artifact/media/**
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist-artifact');
execSync('npx vite build --base ./ --outDir dist --emptyOutDir', { cwd: root, stdio: 'inherit' });

const dist = join(root, 'dist');
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n')
  .replace(/@font-face\{[^}]*\}/g, '');

html = html
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, '')
  .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, '')
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/g, '')
  .replace(/<\/?head>\s*/g, '')
  .replace(/<\/?body>\s*/g, '')
  .replace(/<meta charset="utf-8" \/>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=JetBrains+Mono:wght@400;500&display=swap">';
html = html.replace('</title>', `</title>\n${fonts}\n<style>${css}</style>`) + `\n<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>\n`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);

// Media: plates + large frames only.
const media = join(root, 'public/media');
const manifest = JSON.parse(readFileSync(join(media, 'manifest.json'), 'utf8'));
for (const [name, film] of Object.entries(manifest.films)) {
  cpSync(join(media, name, 'lg'), join(out, 'media', name, 'lg'), { recursive: true });
  film.tiers = ['lg'];
}
for (const f of readdirSync(media).filter((f) => f.endsWith('.jpg'))) cpSync(join(media, f), join(out, 'media', f));
writeFileSync(join(out, 'media/manifest.json'), JSON.stringify(manifest));
console.log('artifact page', (html.length / 1024).toFixed(0), 'KB');
