import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import './style.css';
import { Sequence, drawCover, loadImage } from './sequence.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const pad = (n, l = 2) => String(n).padStart(l, '0');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tiny DOM writer that skips unchanged values (runs every animation frame).
const cache = new WeakMap();
function put(el, key, val) {
  if (!el) return;
  const m = cache.get(el) || {};
  if (m[key] === val) return;
  m[key] = val;
  cache.set(el, m);
  if (key === 'text') el.textContent = val;
  else if (key.startsWith('--')) el.style.setProperty(key, val);
  else if (key === 'class') el.classList.toggle(val[0], val[1]);
  else el.style[key] = val;
}

async function boot() {
  const manifest = await fetch('/media/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const films = manifest.films || {};
  const plateSrc = manifest.plates || {};

  // ---------- Plates (slider + fallbacks) ----------
  const plates = {};
  const small = innerWidth < 900;
  const platePromises = Object.entries(plateSrc).map(([name, p]) =>
    loadImage(small ? p.small : p.src).then((img) => { plates[name] = img; }).catch(() => {}),
  );
  for (const img of $$('[data-plate]')) {
    const p = plateSrc[img.dataset.plate];
    if (p) { img.src = p.src; img.srcset = `${p.small} 960w, ${p.src} 2400w`; img.sizes = '(max-width: 1320px) 100vw, 1320px'; }
  }

  // ---------- Chapters ----------
  const chapters = {
    restore: {
      el: $('#restore'),
      seq: new Sequence($('[data-canvas="restore"]'), {
        film: films.restore,
        focal: { fx: 0.62, fy: 0.5 },
        // Plate wipe: the restoration line sweeps front to rear across the car.
        fallback(ctx, w, h, p) {
          if (!plates.before) return placeholder(ctx, w, h, 'RESTORATION FILM PENDING');
          const t = smooth(0.04, 0.92, p);
          const zoom = 1 + t * 0.06;
          const opts = { fx: 0.62, fy: 0.5, zoom };
          drawCover(ctx, plates.before, w, h, opts);
          if (!plates.after) return;
          const x = w * (-0.05 + t * 1.1);
          ctx.save();
          ctx.beginPath(); ctx.rect(0, 0, Math.max(0, x), h); ctx.clip();
          drawCover(ctx, plates.after, w, h, opts);
          ctx.restore();
          if (t > 0 && t < 1) {
            const g = ctx.createLinearGradient(x - 60, 0, x + 6, 0);
            g.addColorStop(0, 'rgba(25,245,214,0)'); g.addColorStop(1, 'rgba(25,245,214,.35)');
            ctx.fillStyle = g; ctx.fillRect(x - 60, 0, 66, h);
            ctx.fillStyle = '#19f5d6'; ctx.fillRect(x, 0, Math.max(1, w / 1200), h);
          }
        },
      }),
    },
    show: {
      el: $('#show'),
      seq: new Sequence($('[data-canvas="show"]'), {
        film: films.show,
        fallback(ctx, w, h, p) {
          if (!plates.after) return placeholder(ctx, w, h, 'SHOW FILM PENDING');
          const s = Math.sin(p * Math.PI);
          drawCover(ctx, plates.after, w, h, { fx: 0.5 + (p - 0.5) * 0.3, fy: 0.5, zoom: 1.12 + s * 0.06 });
        },
      }),
    },
    proof: {
      el: $('#proof'),
      seq: new Sequence($('[data-canvas="proof"]'), {
        film: films.proof,
        focal: { fx: 0.6, fy: 0.5 },
        fallback(ctx, w, h, p) {
          if (!plates.macro) return placeholder(ctx, w, h, 'PROOF FILM PENDING');
          drawCover(ctx, plates.macro, w, h, { fx: 0.6, fy: 0.5, zoom: 1.02 + p * 0.12 });
        },
      }),
    },
  };

  // ---------- Loader: first coarse pass of the opening film, or the plates ----------
  const bar = $('[data-loader-bar]');
  const pct = $('[data-loader-pct]');
  const restoreSeq = chapters.restore.seq;
  const coarse = Math.ceil((films.restore?.count || 0) / 16) + 1;
  const ready = restoreSeq.hasFilm
    ? restoreSeq.load({
        onProgress: (_, n) => {
          const v = Math.min(1, n / coarse);
          bar.style.width = `${v * 100}%`;
          pct.textContent = `${pad(Math.round(v * 100), 3)}%`;
        },
      })
    : Promise.all(platePromises);
  await Promise.race([ready, new Promise((r) => setTimeout(r, 8000))]);
  bar.style.width = '100%'; pct.textContent = '100%';
  $('[data-loader]').classList.add('is-done');
  Promise.all(platePromises).then(() => Object.values(chapters).forEach((c) => c.seq.invalidate()));
  // Later films stream in behind the first.
  ready.then(() => chapters.show.seq.load({ concurrency: 4 })).then(() => chapters.proof.seq.load({ concurrency: 4 }));

  // ---------- Smooth scroll ----------
  const lenis = reduceMotion ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, anchors: true });
  window.__undo = { lenis, chapters }; // handle for automated scrub checks
  const scrollTo = (target, duration = 1.4) => {
    if (lenis) lenis.scrollTo(target, { duration, easing: (t) => 1 - Math.pow(1 - t, 3) });
    else (typeof target === 'number' ? window.scrollTo(0, target) : $(target)?.scrollIntoView());
  };

  // "Undo the undo": twenty years back in two seconds.
  const undo = () => scrollTo(chapters.restore.el.offsetTop, 2);
  $('[data-undo]').addEventListener('click', undo);
  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.target.closest('input, textarea')) {
      e.preventDefault(); undo();
    }
  });

  // ---------- HUD refs ----------
  const ui = {
    intro: $('[data-restore-intro]'),
    gloss: $('[data-gloss]'), glossBar: $('[data-gloss-bar]'), years: $('[data-years]'),
    defects: $('[data-defects]'), chrome: $('[data-chrome]'), stage: $('[data-stage-label]'),
    hint: $('[data-undo-hint]'),
    orbit: $('[data-orbit]'), orbitDir: $('[data-orbit-dir]'), showLine: $('[data-show-line]'),
    angle: $('[data-angle]'), angleBar: $('[data-angle-bar]'), proofState: $('[data-proof-state]'), slide: $('[data-slide]'),
    dropPath: $('[data-drop-path]'), dropTan: $('[data-drop-tangent]'), dropArc: $('[data-drop-arc]'),
    rails: Object.fromEntries($$('[data-rail]').map((r) => [r.dataset.rail, r])),
    links: $$('.nav__links a'),
  };

  const progressOf = (el) => {
    const r = el.getBoundingClientRect();
    return clamp(-r.top / (r.height - innerHeight));
  };

  // Readouts follow the film's measured on-screen change when we have it.
  const curveAt = (film, p) => {
    const c = film?.curve;
    if (!c || c.length < 2) return null;
    const x = clamp(p) * (c.length - 1), i = Math.floor(x), f = x - i;
    return c[i] + ((c[Math.min(i + 1, c.length - 1)] ?? c[i]) - c[i]) * f;
  };

  function updateRestore(p) {
    const measured = curveAt(films.restore, p);
    const t = measured === null ? smooth(0.04, 0.92, p) : smooth(0, 0.97, measured);
    put(ui.gloss, 'text', (12 + 82 * t).toFixed(1));
    put(ui.glossBar, 'width', `${12 + 82 * t}%`);
    put(ui.years, 'text', pad(Math.round(20 * t)));
    put(ui.defects, 'text', String(Math.round(96 * t)));
    put(ui.chrome, 'text', t < 0.3 ? 'PITTED' : t < 0.75 ? 'POLISHING' : 'BRIGHT');
    put(ui.stage, 'text',
      p < 0.04 ? 'PASS 00 · INSPECT' : p < 0.34 ? 'PASS 01 · DECON' : p < 0.66 ? 'PASS 02 · CORRECT' : p < 0.93 ? 'PASS 03 · COAT' : 'CURED · 94 GU');
    const fade = 1 - smooth(0.0, 0.1, p);
    put(ui.intro, 'opacity', String(fade));
    put(ui.intro, 'transform', `translateY(${(1 - fade) * -40}px)`);
    put(ui.intro, 'visibility', fade <= 0.01 ? 'hidden' : 'visible');
    put(ui.hint, 'class', ['is-on', p > 0.93]);
  }

  function updateShow(p) {
    // Out to 180°, then home again.
    const deg = p < 0.5 ? p * 2 * 180 : (1 - p) * 2 * 180;
    put(ui.orbit, 'text', pad(Math.round(deg), 3));
    put(ui.orbitDir, 'text', p < 0.5 ? '→ OUT' : '← HOME');
    const a = smooth(0.02, 0.14, p) * (1 - smooth(0.86, 0.98, p));
    put(ui.showLine, 'opacity', String(a));
  }

  function updateProof(p) {
    const deg = 110 * smooth(0.06, 0.72, p);
    put(ui.angle, 'text', pad(Math.round(deg), 3));
    put(ui.angleBar, 'width', `${(deg / 120) * 100}%`);
    put(ui.proofState, 'text', deg < 90 ? 'WETTING' : deg < 109.5 ? 'HYDROPHOBIC' : 'BEADING · PASS');
    put(ui.slide, 'text', deg < 100 ? '—' : `${Math.round(8 + (110 - deg) * 1.2)}°`);
    const key = Math.round(deg * 4);
    if (put.lastDrop !== key) { put.lastDrop = key; drawDrop(Math.max(6, deg)); }
  }

  // Spherical-cap droplet with its contact-angle tangent, drawn to scale.
  function drawDrop(deg) {
    const th = (deg * Math.PI) / 180;
    const cx = 100, base = 100;
    const a = 70 - 38 * (deg / 110); // spreads flat when wetting, stands tall when beading
    const R = a / Math.sin(th);
    const large = deg > 90 ? 1 : 0;
    ui.dropPath.setAttribute('d', `M ${cx - a} ${base} A ${R} ${R} 0 ${large} 1 ${cx + a} ${base} Z`);
    const px = cx + a, L = 46, r = 16;
    ui.dropTan.setAttribute('x1', px); ui.dropTan.setAttribute('y1', base);
    ui.dropTan.setAttribute('x2', px - L * Math.cos(th)); ui.dropTan.setAttribute('y2', base - L * Math.sin(th));
    ui.dropArc.setAttribute('d', `M ${px - r} ${base} A ${r} ${r} 0 0 1 ${px - r * Math.cos(th)} ${base - r * Math.sin(th)}`);
  }

  const sections = ['restore', 'show', 'proof', 'packages', 'quote'].map((id) => document.getElementById(id));
  function updateNav() {
    const mid = innerHeight * 0.45;
    let active = -1;
    sections.forEach((s, i) => { const r = s.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) active = i; });
    ui.links.forEach((l, i) => put(l, 'class', ['is-active', i === active]));
  }

  // ---------- Frame loop ----------
  function frame(time) {
    lenis?.raf(time);
    for (const [name, c] of Object.entries(chapters)) {
      const r = c.el.getBoundingClientRect();
      const visible = r.bottom > -innerHeight * 0.25 && r.top < innerHeight * 1.25;
      const p = progressOf(c.el);
      c.seq.set(p);
      put(ui.rails[name], 'transform', `scaleY(${p})`);
      if (!visible) continue;
      c.seq.render();
      if (name === 'restore') updateRestore(p);
      else if (name === 'show') updateShow(p);
      else updateProof(p);
    }
    updateNav();
    requestAnimationFrame(frame);
  }
  addEventListener('resize', () => Object.values(chapters).forEach((c) => c.seq.resize()));
  requestAnimationFrame(frame);

  setupSlider();
  setupQuoteAndBooking();
}

function placeholder(ctx, w, h, label) {
  const g = ctx.createRadialGradient(w * 0.6, h * 0.5, 0, w * 0.6, h * 0.5, w * 0.6);
  g.addColorStop(0, '#11181b'); g.addColorStop(1, '#050607');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(138,151,155,.6)';
  ctx.font = `${Math.round(h / 60)}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(label, w * 0.6, h * 0.5);
}

// ---------- Before / after slider ----------
function setupSlider() {
  const root = $('[data-slider]');
  const input = $('[data-slider-input]');
  const set = (v) => root.style.setProperty('--pos', `${v}%`);
  input.addEventListener('input', () => set(input.value));
  // Direct drag anywhere on the frame (the range input covers it for a11y + keyboard).
  let dragging = false;
  const fromEvent = (e) => {
    const r = root.getBoundingClientRect();
    const v = clamp((e.clientX - r.left) / r.width) * 100;
    input.value = v; set(v);
  };
  root.addEventListener('pointerdown', (e) => { dragging = true; root.setPointerCapture(e.pointerId); fromEvent(e); });
  root.addEventListener('pointermove', (e) => dragging && fromEvent(e));
  root.addEventListener('pointerup', () => (dragging = false));
  root.addEventListener('pointercancel', () => (dragging = false));
}

// ---------- Quote + booking ----------
const PKG = {
  enhancement: { name: 'Enhancement', base: 480, days: 1, gu: 70 },
  correction: { name: 'Correction', base: 1150, days: 2, gu: 88 },
  ceramic: { name: 'Ceramic', base: 2400, days: 3, gu: 94 },
};
const SIZE = { compact: { name: 'Compact', k: 0.9 }, mid: { name: 'Mid', k: 1 }, large: { name: 'Large', k: 1.22 }, xl: { name: 'XL', k: 1.4 } };
const COND = { fresh: { name: 'Fresh', k: 0, d: 0 }, tired: { name: 'Tired', k: 0.15, d: 0 }, neglected: { name: 'Neglected', k: 0.38, d: 1 } };
const money = (n) => n.toLocaleString('en-US');

function setupQuoteAndBooking() {
  const form = $('[data-quote]');
  const out = {
    total: $('[data-q-total]'), lines: $('[data-q-lines]'), days: $('[data-q-days]'), gu: $('[data-q-gu]'), ref: $('[data-q-ref]'),
    summary: $('[data-b-summary]'),
  };
  let shown = 0, target = 0, raf = 0, quote = null;

  const tick = () => {
    shown += (target - shown) * 0.18;
    if (Math.abs(target - shown) < 1) shown = target;
    out.total.textContent = money(Math.round(shown));
    raf = shown === target ? 0 : requestAnimationFrame(tick);
  };

  function compute() {
    const fd = new FormData(form);
    const pkg = PKG[fd.get('pkg')], size = SIZE[fd.get('size')], cond = COND[fd.get('cond')];
    const sized = pkg.base * size.k;
    // Condition scales the correction labour; enhancement only takes half the hit.
    const condAdd = sized * cond.k * (fd.get('pkg') === 'enhancement' ? 0.5 : 1);
    const total = Math.round((sized + condAdd) / 10) * 10;
    const days = pkg.days + cond.d + (size.k > 1.2 && pkg.days > 1 ? 1 : 0);
    const gu = pkg.gu - (fd.get('cond') === 'neglected' && pkg.gu < 90 ? 4 : 0);
    quote = { pkg, size, cond, total, days, gu, keys: [fd.get('pkg'), fd.get('size'), fd.get('cond')] };

    out.lines.innerHTML = [
      [`${pkg.name} base`, `$${money(pkg.base)}`],
      [`${size.name} vehicle ×${size.k.toFixed(2)}`, `${size.k >= 1 ? '+' : '−'}$${money(Math.abs(Math.round(sized - pkg.base)))}`],
      [`${cond.name} paint`, cond.k ? `+$${money(Math.round(condAdd))}` : '$0'],
      ['Paint-depth inspection', 'incl.'],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    out.days.textContent = `${days} day${days > 1 ? 's' : ''}`;
    out.gu.textContent = `${gu} GU${fd.get('pkg') === 'ceramic' ? ' · 110°' : ''}`;
    const hash = quote.keys.join('').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9000, 7);
    out.ref.textContent = `UND-${1000 + hash}`;
    out.summary.textContent = `${pkg.name} · ${size.name} · ${cond.name} · $${money(total)} · ${days} day${days > 1 ? 's' : ''} in bay`.toUpperCase();
    target = total;
    if (!raf) raf = requestAnimationFrame(tick);
    renderBays();
  }
  form.addEventListener('change', compute);
  $$('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    form.querySelector(`input[name="pkg"][value="${b.dataset.pick}"]`).checked = true;
    compute();
  }));

  // Open bays: next three weeks, Tue–Sat, pseudo-random but stable availability.
  const bays = $('[data-bays]');
  const submit = $('[data-b-submit]');
  const status = $('[data-b-status]');
  const bform = $('[data-bform]');
  let picked = null;
  const slots = [];
  const start = new Date(); start.setHours(8, 0, 0, 0);
  for (let d = 1; slots.length < 12 && d < 40; d++) {
    const day = new Date(start); day.setDate(start.getDate() + d);
    const dow = day.getDay();
    if (dow === 0 || dow === 1) continue;
    const seed = (day.getDate() * 7 + day.getMonth() * 13) % 5;
    const bay = (seed % 3) + 1;
    slots.push({ day, bay, open: seed !== 0 });
  }
  const fmt = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).replace(',', '');
  const fmtShort = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit' }).replace(',', '');

  function renderBays() {
    const days = quote?.days || 1;
    bays.innerHTML = '';
    slots.forEach((s, i) => {
      const back = new Date(s.day); back.setDate(back.getDate() + days - 1);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'bay'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(picked === i));
      b.disabled = !s.open;
      b.innerHTML = `<span class="bay__d">${fmt(s.day)}</span><span class="bay__m">${s.open ? `<b>Bay ${s.bay}</b> · 08:00` : 'Full'}</span><span class="bay__m">${s.open ? `Ready ${days > 1 ? fmtShort(back) : 'same day'}` : '—'}</span>`;
      b.addEventListener('click', () => { picked = i; renderBays(); });
      bays.appendChild(b);
    });
    if (picked !== null) {
      const s = slots[picked];
      submit.disabled = false;
      submit.textContent = `Hold Bay ${s.bay} · ${fmt(s.day)}`;
    }
  }

  bform.addEventListener('submit', (e) => {
    e.preventDefault();
    if (picked === null || !bform.reportValidity()) return;
    const s = slots[picked];
    const name = new FormData(bform).get('name').toString().trim().split(' ')[0];
    status.classList.add('is-held');
    status.textContent = `Bay ${s.bay} on ${fmt(s.day)} is pencilled in for you, ${name} — ${quote.pkg.name}, est. $${money(quote.total)}. Nothing was sent: this demo made no network request and stored nothing.`;
    submit.textContent = 'Held on this page ✓';
    submit.disabled = true;
  });

  compute();
}

boot();
