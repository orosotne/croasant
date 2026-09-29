// X-ray / thermal cursor lens.
//
// The hero, X-ray and thermal plates share one framing (the X-ray and thermal
// stills are edits of the hero, pixel-aligned), so revealing a circle of the
// active layer over the hero reads as "seeing through" the croissant.
// The readout samples the actual pixel under the crosshair from the active
// plate's ImageData and derives density or temperature from it.

import { clamp, prefersReducedMotion, setText, setStyle } from '../lib/util.js';

// Ironbow thermal palette, cold → hot. Used to turn a sampled colour back into
// a position on the scale (nearest colour), then into °C.
const IRONBOW = [
  [0.0, [8, 6, 26]],
  [0.14, [38, 10, 96]],
  [0.3, [112, 18, 138]],
  [0.46, [190, 38, 96]],
  [0.6, [232, 78, 34]],
  [0.74, [248, 142, 22]],
  [0.88, [253, 214, 70]],
  [1.0, [255, 250, 226]],
];
const LUT = (() => {
  const out = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 1;
    while (j < IRONBOW.length - 1 && IRONBOW[j][0] < t) j++;
    const [t0, c0] = IRONBOW[j - 1];
    const [t1, c1] = IRONBOW[j];
    const u = (t - t0) / (t1 - t0);
    out.push(c0.map((v, k) => v + (c1[k] - v) * u));
  }
  return out;
})();

const T_AMBIENT = 21;
const T_MAX = 98;

function thermalT(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 256; i++) {
    const c = LUT[i];
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best / 255;
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const MODES = {
  xray: {
    tag: 'X-RAY · 62 kV',
    scale: ['−1000 HU', '+380 HU'],
    keys: ['Density', 'Radiodensity', 'Material'],
    read(r, g, b) {
      const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const density = 0.012 + Math.pow(L, 1.15) * 0.94;
      const hu = Math.round(-1000 + L * 1380);
      const material =
        L < 0.06 ? 'Air · outside' : L < 0.22 ? 'Air pocket' : L < 0.45 ? 'Crumb membrane' : L < 0.72 ? 'Laminated wall' : 'Crust shell';
      return [`${density.toFixed(3)} g/cm³`, `${hu > 0 ? '+' : ''}${hu} HU`, material];
    },
  },
  thermal: {
    tag: 'THERMAL · LWIR',
    scale: [`${T_AMBIENT} °C`, `${T_MAX} °C`],
    keys: ['Temperature', 'Delta vs room', 'Zone'],
    read(r, g, b) {
      const t = thermalT(r, g, b);
      const temp = T_AMBIENT + t * (T_MAX - T_AMBIENT);
      const zone = t < 0.12 ? 'Ambient' : t < 0.42 ? 'Tip · cooling' : t < 0.72 ? 'Body' : 'Core';
      return [`${temp.toFixed(1)} °C`, `+${(temp - T_AMBIENT).toFixed(1)} °C`, zone];
    },
  },
};

export function initLens(root) {
  const stage = root.querySelector('.lens__stage');
  const layers = Object.fromEntries([...root.querySelectorAll('.lens__layer')].map((el) => [el.dataset.mode, el]));
  const tag = root.querySelector('.lens__tag');
  const scaleLo = root.querySelector('.lens__scale .lo');
  const scaleHi = root.querySelector('.lens__scale .hi');
  const tabs = [...root.querySelectorAll('[data-lens-mode]')];
  const out = Object.fromEntries([...root.querySelectorAll('[data-r]')].map((el) => [el.dataset.r, el]));
  const reduced = prefersReducedMotion();

  const data = {}; // mode -> { w, h, px: Uint8ClampedArray }
  let mode = 'xray';
  let pos = { x: 0.5, y: 0.5 }; // lens centre in stage fractions
  let target = { ...pos };
  let userActive = false;
  let lastUser = 0;
  let visible = false;

  const sample = (m) => {
    const img = layers[m];
    const load = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      data[m] = { w: c.width, h: c.height, px: ctx.getImageData(0, 0, c.width, c.height).data };
    };
    if (img.complete && img.naturalWidth) load();
    else img.addEventListener('load', load, { once: true });
  };
  sample('xray');
  sample('thermal');

  const setMode = (m) => {
    mode = m;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.lensMode === m)));
    Object.entries(layers).forEach(([k, el]) => el.classList.toggle('is-active', k === m));
    root.dataset.mode = m;
    setText(tag, MODES[m].tag);
    setText(scaleLo, MODES[m].scale[0]);
    setText(scaleHi, MODES[m].scale[1]);
    MODES[m].keys.forEach((k, i) => setText(out[`k${i + 1}`], k));
    render();
  };
  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.lensMode)));

  // The plates fill the stage with object-fit: cover; map stage fractions to plate pixels.
  const toPlate = (fx, fy, d) => {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const scale = Math.max(sw / d.w, sh / d.h);
    const ox = (sw - d.w * scale) / 2;
    const oy = (sh - d.h * scale) / 2;
    return [clamp(Math.floor((fx * sw - ox) / scale), 0, d.w - 1), clamp(Math.floor((fy * sh - oy) / scale), 0, d.h - 1)];
  };

  function render() {
    const x = `${(pos.x * 100).toFixed(3)}%`;
    const y = `${(pos.y * 100).toFixed(3)}%`;
    setStyle(stage, '--lx', x);
    setStyle(stage, '--ly', y);
    const d = data[mode];
    if (!d) return;
    const [px, py] = toPlate(pos.x, pos.y, d);
    const i = (py * d.w + px) * 4;
    const r = d.px[i];
    const g = d.px[i + 1];
    const b = d.px[i + 2];
    // Report coordinates in the 3840×2160 master plate's pixel space.
    setText(out.x, String(Math.round((px / d.w) * 3840)).padStart(4, '0'));
    setText(out.y, String(Math.round((py / d.h) * 2160)).padStart(4, '0'));
    setText(out.hex, hex(r, g, b));
    setStyle(out.swatch, 'background', `rgb(${r},${g},${b})`);
    MODES[mode].read(r, g, b).forEach((v, k) => setText(out[`v${k + 1}`], v));
  }

  const fromEvent = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  stage.addEventListener('pointermove', (e) => {
    if (e.target.closest('.lens__modes')) return;
    target = fromEvent(e);
    userActive = true;
    lastUser = performance.now();
    if (e.pointerType !== 'mouse') pos = { ...target };
  });
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.lens__modes')) return;
    target = fromEvent(e);
    pos = { ...target };
    userActive = true;
    lastUser = performance.now();
  });
  stage.addEventListener('pointerleave', () => (userActive = false));
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!moves[e.key]) return;
    e.preventDefault();
    target = { x: clamp(target.x + moves[e.key][0]), y: clamp(target.y + moves[e.key][1]) };
    pos = { ...target };
    userActive = true;
    lastUser = performance.now();
  });

  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { rootMargin: '100px' }).observe(stage);

  setMode('xray');

  return {
    tick(time) {
      if (!visible) return;
      if (!userActive && performance.now() - lastUser > 1800) {
        if (reduced) {
          target = { x: 0.5, y: 0.47 };
        } else {
          // Idle: the lens wanders a slow Lissajous path across the croissant.
          const t = time / 1000;
          target = { x: 0.5 + Math.sin(t * 0.41) * 0.2, y: 0.49 + Math.sin(t * 0.67 + 0.8) * 0.14 };
        }
      }
      const k = userActive ? 0.35 : 0.06;
      const nx = pos.x + (target.x - pos.x) * k;
      const ny = pos.y + (target.y - pos.y) * k;
      if (Math.abs(nx - pos.x) + Math.abs(ny - pos.y) > 0.00005 || !out.hex._t) {
        pos = { x: nx, y: ny };
        render();
      }
    },
  };
}
