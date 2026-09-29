#!/usr/bin/env node
// Mirror the page's CDN assets (the pinned Lenis build, the Google Fonts CSS
// and its font files) into a local folder, for verification runs where the
// test browser can't reach the CDNs directly, e.g. behind a TLS-intercepting
// proxy it doesn't trust. curl fetches with the system CA store; verify.mjs
// then answers those requests from the cache (CDN_CACHE=<dir>).
//
// usage: node scripts/cache-cdn.mjs [dir]    (default media/tmp/cdn-cache)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'media/tmp/cdn-cache';
const LENIS = 'https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

fs.mkdirSync(dir, { recursive: true });
const index = {};
let n = 0;
const get = (url, type) => {
  const file = `${String(n++).padStart(3, '0')}${path.extname(new URL(url).pathname) || '.css'}`;
  execFileSync('curl', ['-sSf', '-A', UA, '-o', path.join(dir, file), url]);
  index[url] = { file, type };
  return path.join(dir, file);
};

get(LENIS, 'application/javascript');
const html = fs.readFileSync('index.html', 'utf8');
for (const [, href] of html.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/g)) {
  const cssUrl = href.replaceAll('&amp;', '&');
  const css = fs.readFileSync(get(cssUrl, 'text/css'), 'utf8');
  for (const [, font] of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) get(font, 'font/woff2');
}
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`cached ${Object.keys(index).length} CDN files in ${dir}`);
