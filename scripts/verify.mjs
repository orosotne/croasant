#!/usr/bin/env node
// End-to-end check of the running site with headless Chromium.
//
//   URL=http://127.0.0.1:5173/ OUT=verification node scripts/verify.mjs
//
// Set CDN_CACHE=<dir> (from scripts/cache-cdn.mjs) to answer the Lenis CDN
// script and Google Fonts from local copies when the test browser can't reach
// those hosts itself.
//
// Scrolls every pinned chapter to several points mid-scroll and screenshots
// them, reads the live overlay values, drives the lens, the drag-to-spin
// viewer, the order card and the sound toggle, then repeats the chapters on a
// phone viewport. Fails on console errors, failed requests, or blank canvases.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:5173/';
const OUT = process.env.OUT || 'verification';
const CDN_CACHE = process.env.CDN_CACHE;
const cdnIndex = CDN_CACHE ? JSON.parse(fs.readFileSync(`${CDN_CACHE}/index.json`, 'utf8')) : null;
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const frameRetries = [];
const report = [];
const log = (...a) => {
  const line = a.join(' ');
  report.push(line);
  console.log(line);
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function open(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...opts });
  if (cdnIndex) {
    await context.route(/^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => {
      const hit = cdnIndex[route.request().url()];
      if (!hit) {
        problems.push(`cdn: no cached copy of ${route.request().url()}`);
        return route.abort();
      }
      return route.fulfill({ path: `${CDN_CACHE}/${hit.file}`, contentType: hit.type, headers: { 'access-control-allow-origin': '*' } });
    });
  }
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // A frame the loader retries is only a problem if it never decodes (checked below).
    const bucket = /\/frames\/.+\.webp/.test(r.url()) ? frameRetries : problems;
    bucket.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()}: ${r.url()}`));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 60000 });
  await page.waitForFunction(() => Object.values(window.__lamina.seqs).every((s) => s.done), null, { timeout: 240000 });
  const frames = await page.evaluate(() =>
    Object.fromEntries(Object.entries(window.__lamina.seqs).map(([k, s]) => [k, `${s.images.filter(Boolean).length}/${s.count} @${s.width}px`])),
  );
  log('frames decoded:', JSON.stringify(frames));
  for (const [k, v] of Object.entries(frames)) {
    const [got, total] = v.split(' ')[0].split('/').map(Number);
    if (got !== total) problems.push(`frames: ${k} decoded ${got}/${total}`);
  }
  return page;
}

async function scrollTo(page, y) {
  await page.evaluate((y) => window.__lamina.lenis.scrollTo(y, { immediate: true, force: true }), y);
  await page.waitForTimeout(350);
}

async function toChapter(page, id, p) {
  const y = await page.evaluate(
    ({ id, p }) => {
      const c = window.__lamina.chapters.find((c) => c.section.id === id);
      return c.top + c.len * p;
    },
    { id, p },
  );
  await scrollTo(page, y);
}

/** Fraction of sampled canvas pixels that are not black: proves a frame was drawn. */
const inked = (page, id) =>
  page.evaluate((id) => {
    const c = document.querySelector(`#${id} canvas`);
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let lit = 0, n = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      n++;
      if (data[i] + data[i + 1] + data[i + 2] > 45) lit++;
    }
    return +(lit / n).toFixed(3);
  }, id);

const state = (page, id) =>
  page.evaluate((id) => {
    const s = document.getElementById(id);
    const vis = (sel) => {
      const el = s.querySelector(sel);
      return el ? +getComputedStyle(el).opacity : null;
    };
    const txt = (sel) => s.querySelector(sel)?.textContent.trim();
    const c = window.__lamina.chapters.find((c) => c.section.id === id);
    const out = { progress: +c.progress(window.scrollY).toFixed(3), frame: c.frameIndex ?? null };
    if (id === 'spin') Object.assign(out, { title: vis('[data-el=title]'), layers: vis('[data-el=layers]'), sheets: vis('[data-el=sheets]') });
    if (id === 'crunch') Object.assign(out, { dB: txt('[data-el=db]'), flakes: txt('[data-el=flakes]'), lit: s.querySelectorAll('.meter__bars i.on').length, uncrunch: vis('[data-el=uncrunch]') });
    if (id === 'lamination') Object.assign(out, { layers: txt('[data-el=count]'), specsOn: s.querySelectorAll('.spec-strip li.on').length, tags: vis('[data-el=tags]') });
    if (id === 'crumb') Object.assign(out, { liveCard: [...s.querySelectorAll('.glass-card')].findIndex((c) => c.classList.contains('is-live')) });
    if (id === 'bake') Object.assign(out, { timer: txt('[data-el=timer]'), core: txt('[data-el=core]'), oven: txt('[data-el=oven]'), rise: txt('[data-el=rise]'), colour: txt('[data-el=colour]'), status: txt('[data-el=status]') });
    return out;
  }, id);

async function chapters(page, tag, points) {
  for (const [id, ps] of Object.entries(points)) {
    for (const p of ps) {
      await toChapter(page, id, p);
      const ink = await inked(page, id);
      const st = await state(page, id);
      const file = `${OUT}/${tag}-${id}-${String(Math.round(p * 100)).padStart(3, '0')}.png`;
      await page.screenshot({ path: file });
      log(`${tag} ${id} @${p}: ink=${ink} ${JSON.stringify(st)} -> ${file}`);
      if (ink < 0.003) problems.push(`${tag} ${id} @${p}: canvas looks blank (ink ${ink})`);
    }
  }
}

/* ------------------------------------------------------------ desktop */
const page = await open({ width: 1440, height: 900 });
await page.screenshot({ path: `${OUT}/desktop-000-top.png` });

// Sound on first, so the crunch crossing and the oven hum are exercised while scrolling.
await page.click('#sound');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const s = window.__lamina.sound;
  window.__crunches = [];
  const orig = s.crunch.bind(s);
  s.crunch = (o) => {
    window.__crunches.push(o?.reverse ? 'reverse' : 'forward');
    orig(o);
  };
});
log('sound:', JSON.stringify(await page.evaluate(() => ({ pressed: document.getElementById('sound').getAttribute('aria-pressed'), ctx: window.__lamina.sound.ctx?.state }))));

await chapters(page, 'desktop', {
  spin: [0.02, 0.25, 0.56, 0.8, 0.98],
  crunch: [0.1, 0.35, 0.5, 0.7, 0.95],
  lamination: [0.1, 0.5, 0.95],
  crumb: [0.05, 0.28, 0.5, 0.7, 0.9],
  bake: [0.1, 0.5, 0.97],
});

// Scroll the crunch back up past the break: the meter should count down and the un-crunch fire.
await toChapter(page, 'crunch', 0.95);
await toChapter(page, 'crunch', 0.15);
log('crunch after scrolling back up:', JSON.stringify(await state(page, 'crunch')), 'crunch sounds:', JSON.stringify(await page.evaluate(() => window.__crunches)));
await toChapter(page, 'bake', 0.5);
await page.waitForTimeout(600);
log('oven hum level at bake 50%:', await page.evaluate(() => window.__lamina.sound.humLevel.toFixed(3)));

// Lens: hover, read, switch to thermal, read.
await page.evaluate(() => window.__lamina.lenis.scrollTo('#lens', { immediate: true, force: true }));
await page.waitForTimeout(300);
const lensBox = await page.locator('.lens__stage').boundingBox();
await scrollTo(page, await page.evaluate(() => document.querySelector('.lens__stage').getBoundingClientRect().top + window.scrollY - 60));
const lb = await page.locator('.lens__stage').boundingBox();
const readLens = () =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#lens [data-r]')].filter((e) => e.textContent).map((e) => [e.dataset.r, e.textContent])));
for (const [fx, fy] of [[0.5, 0.5], [0.36, 0.42], [0.62, 0.58], [0.05, 0.08]]) {
  await page.mouse.move(lb.x + lb.width * fx, lb.y + lb.height * fy, { steps: 6 });
  await page.waitForTimeout(400);
  log(`lens xray @${fx},${fy}:`, JSON.stringify(await readLens()));
}
await page.mouse.move(lb.x + lb.width * 0.5, lb.y + lb.height * 0.5, { steps: 6 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/desktop-lens-xray.png` });
await page.click('[data-lens-mode=thermal]');
for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.45], [0.05, 0.08]]) {
  await page.mouse.move(lb.x + lb.width * fx, lb.y + lb.height * fy, { steps: 6 });
  await page.waitForTimeout(400);
  log(`lens thermal @${fx},${fy}:`, JSON.stringify(await readLens()));
}
await page.mouse.move(lb.x + lb.width * 0.47, lb.y + lb.height * 0.5, { steps: 6 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/desktop-lens-thermal.png` });
void lensBox;

// Viewer: drag and check the angle moves.
await scrollTo(page, await page.evaluate(() => document.querySelector('.viewer__stage').getBoundingClientRect().top + window.scrollY - 80));
const vb = await page.locator('.viewer__stage').boundingBox();
const deg0 = await page.textContent('[data-deg]');
await page.mouse.move(vb.x + vb.width * 0.7, vb.y + vb.height * 0.5);
await page.mouse.down();
await page.mouse.move(vb.x + vb.width * 0.3, vb.y + vb.height * 0.5, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(700);
const deg1 = await page.textContent('[data-deg]');
log(`viewer: ${deg0} -> ${deg1} after a drag`);
if (deg0 === deg1) problems.push('viewer: angle did not change after dragging');
await page.screenshot({ path: `${OUT}/desktop-viewer.png` });

// Lineup + order.
await scrollTo(page, await page.evaluate(() => document.getElementById('lineup').offsetTop + 40));
await page.screenshot({ path: `${OUT}/desktop-lineup.png` });
await scrollTo(page, await page.evaluate(() => document.querySelector('.specs').getBoundingClientRect().top + window.scrollY - 100));
await page.screenshot({ path: `${OUT}/desktop-specs.png` });
await page.click('[data-add=ultra]');
await page.waitForTimeout(1600);
await scrollTo(page, await page.evaluate(() => document.querySelector('.order__card').getBoundingClientRect().top + window.scrollY - 90));
await page.click('[data-item=promax] [data-inc]');
const slots = page.locator('.slot:not([disabled])');
if ((await slots.count()) > 1) await slots.nth(1).click();
const before = await page.evaluate(() => ({
  total: document.querySelector('[data-total]').textContent,
  count: document.querySelector('[data-count]').textContent,
  countdown: document.querySelector('[data-countdown]').textContent,
  batch: document.querySelector('[data-batch]').textContent,
  button: document.querySelector('[data-reserve]').textContent.trim(),
  qty: [...document.querySelectorAll('[data-qty]')].map((q) => q.textContent).join(','),
}));
log('order before reserve:', JSON.stringify(before));
await page.waitForTimeout(1100);
const tick = await page.textContent('[data-countdown]');
if (tick === before.countdown) problems.push('order: countdown is not ticking');
const requestsBefore = await page.evaluate(() => performance.getEntriesByType('resource').length);
await page.click('[data-reserve]');
await page.waitForTimeout(500);
const after = await page.evaluate(() => ({
  button: document.querySelector('[data-reserve]').textContent.trim(),
  receipt: document.querySelector('[data-receipt]').hidden ? null : document.querySelector('[data-receipt]').innerText,
}));
const requestsAfter = await page.evaluate(() => performance.getEntriesByType('resource').length);
log('order after reserve:', JSON.stringify(after), `network requests fired by reserve: ${requestsAfter - requestsBefore}`);
if (!after.receipt || !/Nothing was sent/.test(after.receipt)) problems.push('order: receipt missing "Nothing was sent"');
if (requestsAfter !== requestsBefore) problems.push('order: reserve made a network request');
await page.screenshot({ path: `${OUT}/desktop-order.png` });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/desktop-footer.png` });
await page.context().close();

/* -------------------------------------------------------------- phone */
const phone = await open({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
log('phone frame width:', await phone.evaluate(() => window.__lamina.seqs.spin.width));
await chapters(phone, 'phone', {
  spin: [0.02, 0.56, 0.8],
  crunch: [0.5, 0.95],
  lamination: [0.5, 0.95],
  crumb: [0.28],
  bake: [0.5],
});
await scrollTo(phone, await phone.evaluate(() => document.querySelector('.lens__stage').getBoundingClientRect().top + window.scrollY - 70));
await phone.screenshot({ path: `${OUT}/phone-lens.png` });
await scrollTo(phone, await phone.evaluate(() => document.querySelector('.order__card').getBoundingClientRect().top + window.scrollY - 70));
await phone.screenshot({ path: `${OUT}/phone-order.png`, fullPage: false });
await phone.context().close();

await browser.close();

if (frameRetries.length) log(`note: ${frameRetries.length} frame request(s) aborted and were retried by the loader`);
log(`\n${problems.length ? 'PROBLEMS' : 'OK'}: ${problems.length} problem(s)`);
problems.forEach((p) => log('  -', p));
fs.writeFileSync(`${OUT}/report.txt`, report.join('\n') + '\n');
process.exit(problems.length ? 1 : 0);
