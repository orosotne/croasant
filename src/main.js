import 'lenis/dist/lenis.css';
import './styles.css';

import Lenis from 'lenis';
import { FrameLoader, FrameSequence } from './lib/frames.js';
import { Sound } from './lib/sound.js';
import { BakeChapter, CrumbChapter, CrunchChapter, LaminationChapter, SpinChapter } from './chapters.js';
import { initLens } from './features/lens.js';
import { initViewer } from './features/viewer.js';
import { initOrder } from './features/order.js';
import { clamp, prefersReducedMotion, setStyle } from './lib/util.js';

const FILMS = ['spin', 'crunch', 'lamination', 'crumb', 'bake'];
const reduced = prefersReducedMotion();

/** Phones get the 960px frame set; everything else the 1920px set. ?frames=960|1920 overrides. */
function frameWidth() {
  const forced = new URLSearchParams(location.search).get('frames');
  if (forced === '960' || forced === '1920') return Number(forced);
  const conn = navigator.connection;
  if (conn?.saveData || /2g|3g/.test(conn?.effectiveType || '')) return 960;
  return Math.min(window.innerWidth, window.innerHeight) < 600 ? 960 : 1920;
}

async function boot() {
  const manifest = await fetch('frames/manifest.json').then((r) => r.json());
  const events = manifest.events || {};
  let width = frameWidth();
  // Atlas builds (for hosts with a file-count cap) may ship only some sizes.
  const atlases = manifest.atlases;
  if (atlases && !atlases[width]) width = Number(Object.keys(atlases)[0]);
  const loader = new FrameLoader(6);
  const seqs = Object.fromEntries(FILMS.map((f) => [f, new FrameSequence(f, manifest[f].count, width)]));
  if (atlases) FILMS.forEach((f) => seqs[f].useAtlases({ ...atlases[width], files: atlases[width].films[f] }));
  seqs.spin.priority = 0;
  FILMS.forEach((f) => loader.add(seqs[f]));

  const sound = new Sound();
  const byId = (id) => document.getElementById(id);
  const chapters = [
    new SpinChapter(byId('spin'), seqs.spin),
    new CrunchChapter(byId('crunch'), seqs.crunch, events.crunch),
    new LaminationChapter(byId('lamination'), seqs.lamination, events.lamination),
    new CrumbChapter(byId('crumb'), seqs.crumb),
    new BakeChapter(byId('bake'), seqs.bake, events.bake),
  ];
  const bake = chapters[4];

  const lens = initLens(byId('lens'));
  const viewer = initViewer(byId('viewer'), seqs.spin);
  const order = initOrder(byId('order'));

  const lenis = new Lenis({
    autoRaf: false,
    lerp: reduced ? 1 : 0.085,
    smoothWheel: !reduced,
    wheelMultiplier: 0.95,
    touchMultiplier: 1.2,
  });

  /* ---------------------------------------------------------- navigation */
  const nav = byId('nav');
  const navLinks = [...nav.querySelectorAll('.nav__links a')];
  const rail = byId('rail');
  const railItems = [...rail.querySelectorAll('[data-rail]')];
  const sections = navLinks.map((a) => byId(a.hash.slice(1)));

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const target = a.hash.length > 1 ? byId(a.hash.slice(1)) : null;
    if (!target && a.hash !== '#top') return;
    e.preventDefault();
    lenis.scrollTo(a.hash === '#top' ? 0 : target, { duration: reduced ? 0 : 1.6 });
    try {
      history.replaceState(null, '', a.hash);
    } catch {
      // Sandboxed frames may refuse history edits; the scroll already happened.
    }
  });
  railItems.forEach((li) =>
    li.addEventListener('click', () => lenis.scrollTo(byId(li.dataset.rail), { duration: reduced ? 0 : 1.6 })),
  );

  document.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      order.add(b.dataset.add);
      lenis.scrollTo(byId('order'), { duration: reduced ? 0 : 1.4, offset: -40 });
    }),
  );

  /* --------------------------------------------------------------- sound */
  const soundBtn = byId('sound');
  soundBtn.addEventListener('click', async () => {
    const on = await sound.toggle();
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.querySelector('.sound__label').textContent = on ? 'Sound on' : 'Sound off';
    document.documentElement.classList.toggle('sound-on', on);
  });

  /* -------------------------------------------------------------- layout */
  const measure = () => {
    chapters.forEach((c) => c.measure());
    viewer.measure();
  };
  measure();
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      measure();
      lenis.resize();
    });
  });
  // Fonts can shift section heights slightly once they swap in.
  document.fonts?.ready.then(measure);

  /* ---------------------------------------------------------------- loop */
  let humNear = false;
  const frame = (time) => {
    lenis.raf(time);
    const y = window.scrollY;
    const vh = window.innerHeight;

    for (const c of chapters) {
      c.seq.priority = c.isNear(y, vh) ? 0 : Math.abs(c.top - y);
      if (c.isNear(y, vh)) c.update(c.progress(y), sound.on ? sound : null, c.isOnScreen(y, vh));
    }
    const nearBake = bake.isNear(y, vh);
    if (humNear && !nearBake) sound.setHum(0);
    humNear = nearBake;

    lens.tick(time);
    viewer.tick(time);

    const docH = document.documentElement.scrollHeight - vh;
    setStyle(nav, '--progress', clamp(y / docH).toFixed(4));
    nav.classList.toggle('is-scrolled', y > 8);

    // Active section in the nav and the chapter rail.
    const mid = y + vh * 0.5;
    const active = sections.findIndex((s) => s && s.offsetTop <= mid && mid < s.offsetTop + s.offsetHeight);
    navLinks.forEach((a, i) => a.classList.toggle('is-active', i === active));
    const inChapters = y + vh * 0.5 >= chapters[0].top && y + vh * 0.5 < bake.top + bake.height;
    rail.classList.toggle('is-visible', inChapters);
    chapters.forEach((c, i) => {
      const on = y + vh * 0.5 >= c.top && y + vh * 0.5 < c.top + c.height;
      railItems[i].classList.toggle('is-active', on);
      if (on) setStyle(railItems[i], '--p', c.progress(y).toFixed(4));
    });

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /* -------------------------------------------------------------- loader */
  const overlay = byId('loader');
  const pct = overlay.querySelector('.loader__pct');
  const need = Math.min(24, seqs.spin.count);
  const started = performance.now();
  await new Promise((resolve) => {
    const check = () => {
      const r = clamp(seqs.spin.loaded / need);
      setStyle(overlay, '--p', r.toFixed(3));
      pct.textContent = String(Math.round(r * 100)).padStart(3, '0');
      if (r >= 1 || performance.now() - started > 4000) resolve();
      else setTimeout(check, 60);
    };
    check();
  });
  overlay.classList.add('is-done');
  document.documentElement.classList.add('is-ready');
  setTimeout(() => overlay.remove(), 1200);

  // Handy for debugging and for the verification script.
  window.__lamina = { lenis, chapters, seqs, sound, manifest };
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('loader')?.classList.add('is-error');
});
