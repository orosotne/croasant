// Scrub verification: drives the page down and back up through the Restoration
// chapter with real wheel input (so Lenis is in the loop), sampling the frame
// the canvas actually drew against scroll progress, and screenshots key beats.
//   node scripts/verify.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const out = process.argv[3] || 'verify-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('.loader.is-done', { state: 'attached', timeout: 20000 });
await page.waitForTimeout(1500);

const sample = () => page.evaluate(() => {
  const c = window.__undo.chapters.restore;
  const r = c.el.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
  return { y: Math.round(scrollY), p: +p.toFixed(3), drawn: c.seq.drawn, count: c.seq.film?.count ?? 0,
    gloss: document.querySelector('[data-gloss]').textContent, years: document.querySelector('[data-years]').textContent,
    hint: document.querySelector('[data-undo-hint]').classList.contains('is-on') };
});

const snap = async (name) => page.screenshot({ path: `${out}/${name}.png` });
await page.mouse.move(700, 450);
const end = await page.evaluate(() => { const el = window.__undo.chapters.restore.el; return el.offsetTop + el.offsetHeight - innerHeight; });

const down = [], up = [];
await snap('00-top');
while ((await sample()).y < end - 5) {
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(60);
  down.push(await sample());
}
await page.waitForTimeout(1200);
down.push(await sample());
await snap('01-restored');
while ((await sample()).y > 5) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(60);
  up.push(await sample());
}
await page.waitForTimeout(1200);
up.push(await sample());
await snap('02-back-to-top');

// Scrub quality: drawn frame must track progress (within coarse-load tolerance) and
// be monotonic with scroll direction.
function check(samples, dir) {
  let back = 0, maxLag = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].drawn - samples[i - 1].drawn;
    if (dir * d < 0) back++;
    const want = Math.round(samples[i].p * (samples[i].count - 1));
    maxLag = Math.max(maxLag, Math.abs(want - samples[i].drawn));
  }
  return { samples: samples.length, reversals: back, maxFrameLag: maxLag,
    first: samples[0], last: samples[samples.length - 1] };
}
console.log('DOWN', JSON.stringify(check(down, 1)));
console.log('UP  ', JSON.stringify(check(up, -1)));

// ⌘Z: from the end of the chapter back to the top in ~2s.
await page.evaluate((y) => window.__undo.lenis ? window.__undo.lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y), end);
await page.waitForTimeout(600);
const t0 = Date.now();
await page.keyboard.press('Control+z');
let s;
do { await page.waitForTimeout(100); s = await sample(); } while (s.y > 2 && Date.now() - t0 < 5000);
console.log('UNDO ⌘Z back to top in', Date.now() - t0, 'ms', JSON.stringify(s));

// Beats further down the page.
for (const [id, frac, name] of [['restore', 0.45, '01a-restore-mid'], ['restore', 0.96, '01b-restore-end'], ['show', 0.25, '03-show'], ['show', 0.5, '03b-show-apex'], ['proof', 0.8, '04-proof']]) {
  await page.evaluate(([id, frac]) => { const el = document.getElementById(id); const y = el.offsetTop + (el.offsetHeight - innerHeight) * frac; window.__undo.lenis ? window.__undo.lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y); }, [id, frac]);
  await page.waitForTimeout(900); await snap(name);
}
for (const id of ['compare', 'packages', 'quote', 'book']) {
  await page.evaluate((id) => { const el = id === 'compare' ? document.querySelector('.compare') : document.getElementById(id); window.__undo.lenis ? window.__undo.lenis.scrollTo(el, { immediate: true, offset: -40 }) : el.scrollIntoView(); }, id);
  await page.waitForTimeout(700); await snap(`05-${id}`);
}
// Quote + booking interaction.
await page.click('input[name="size"][value="large"] + span');
await page.click('input[name="cond"][value="neglected"] + span');
await page.waitForTimeout(900);
console.log('QUOTE', await page.textContent('[data-q-total]'), await page.textContent('[data-q-days]'));
await page.evaluate(() => { const el = document.getElementById('book'); window.__undo.lenis ? window.__undo.lenis.scrollTo(el, { immediate: true }) : el.scrollIntoView(); });
await page.waitForTimeout(500);
await page.click('.bay:not(:disabled)');
await page.fill('input[name="name"]', 'Alex Morgan');
await page.fill('input[name="email"]', 'alex@example.com');
const reqs = [];
page.on('request', (r) => reqs.push(r.url()));
await page.click('[data-b-submit]');
await page.waitForTimeout(400);
console.log('BOOK', await page.textContent('[data-b-status]'), '| requests after submit:', reqs.length);
await snap('06-booked');

const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await m.goto(url, { waitUntil: 'networkidle' });
await m.waitForSelector('.loader.is-done', { state: 'attached', timeout: 20000 });
await m.waitForTimeout(800);
await m.screenshot({ path: `${out}/07-mobile-top.png` });
await m.evaluate(() => { const el = document.getElementById('restore'); const y = el.offsetTop + (el.offsetHeight - innerHeight) * 0.6; window.__undo.lenis ? window.__undo.lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y); });
await m.waitForTimeout(900);
await m.screenshot({ path: `${out}/08-mobile-restore.png` });
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log('MOBILE horizontal overflow px:', overflow);
console.log('ERRORS', errors.length ? errors : 'none');
await browser.close();
