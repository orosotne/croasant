// The five pinned, scroll-scrubbed chapters.
//
// Each chapter is a tall <section> whose .stage is position:sticky, so the
// canvas stays pinned while the section scrolls past. progress p runs 0→1
// across the pinned stretch; every overlay is a pure function of p, so
// scrolling back up plays everything in reverse (including the un-crunch).

import { drawFrame } from './lib/frames.js';
import {
  clamp, range, fade, keyframes, easeInOut, easeOut, easeIn, smooth,
  pad, fmtInt, setStyle, setText,
} from './lib/util.js';

class Chapter {
  constructor(section, seq, events = {}) {
    this.section = section;
    this.seq = seq;
    this.events = events;
    this.stage = section.querySelector('.stage');
    this.canvas = section.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.el = {};
    section.querySelectorAll('[data-el]').forEach((n) => (this.el[n.dataset.el] = n));
    this.key = '';
    this.rect = null;
    seq.onLoad(() => (this.key = '')); // repaint when a better frame arrives
  }

  measure() {
    const r = this.section.getBoundingClientRect();
    this.top = r.top + window.scrollY;
    this.height = this.section.offsetHeight;
    this.len = Math.max(1, this.height - window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.cssW = w;
    this.cssH = h;
    this.W = Math.round(w * dpr);
    this.H = Math.round(h * dpr);
    if (this.canvas.width !== this.W || this.canvas.height !== this.H) {
      this.canvas.width = this.W;
      this.canvas.height = this.H;
    }
    this.portrait = h > w * 1.02;
    this.key = '';
  }

  progress(y) {
    return clamp((y - this.top) / this.len);
  }

  isNear(y, vh) {
    return y + vh * 1.5 > this.top && y - vh * 0.5 < this.top + this.height;
  }

  isOnScreen(y, vh) {
    return y + vh > this.top && y < this.top + this.height;
  }

  paint(index, opts, loop = false) {
    const img = loop ? this.seq.frameLoop(index) : this.seq.frame(index);
    const key = `${img ? img.src : 'none'}|${opts.s?.toFixed?.(4)}|${opts.x?.toFixed?.(4)}|${opts.y?.toFixed?.(4)}|${this.W}x${this.H}`;
    if (key === this.key) return;
    this.key = key;
    const { ctx, W, H } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!img) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.rect = drawFrame(ctx, img, W, H, opts);
  }

  /** Map a point in frame space (0..1) to CSS pixels inside the stage. */
  toStage(fx, fy) {
    if (!this.rect) return [this.cssW * fx, this.cssH * fy];
    const k = this.cssW / this.W;
    return [(this.rect.dx + fx * this.rect.dw) * k, (this.rect.dy + fy * this.rect.dh) * k];
  }
}

/* ---------------------------------------------------------------- 01 SPIN */

const SPIN_LAND = [
  [0.0, { s: 0.4, x: 0, y: 0.215 }],
  [0.07, { s: 0.4, x: 0, y: 0.215 }],
  [0.3, { s: 1.12, x: 0, y: 0.02 }],
  [0.4, { s: 1.12, x: 0, y: 0.02 }],
  [0.5, { s: 0.86, x: -0.2, y: 0.01 }],
  [0.62, { s: 0.86, x: -0.2, y: 0.01 }],
  [0.73, { s: 0.86, x: 0.2, y: 0.01 }],
  [0.86, { s: 0.86, x: 0.2, y: 0.01 }],
  [0.97, { s: 1, x: 0, y: 0 }],
  [1.0, { s: 1, x: 0, y: 0 }],
];
const SPIN_PORT = [
  [0.0, { s: 0.52, x: 0, y: 0.16 }],
  [0.07, { s: 0.52, x: 0, y: 0.16 }],
  [0.3, { s: 1, x: 0, y: 0 }],
  [0.4, { s: 1, x: 0, y: 0 }],
  [0.5, { s: 0.82, x: 0, y: -0.15 }],
  [0.86, { s: 0.82, x: 0, y: -0.15 }],
  [0.97, { s: 1, x: 0, y: 0 }],
  [1.0, { s: 1, x: 0, y: 0 }],
];

export class SpinChapter extends Chapter {
  update(p) {
    const n = this.seq.count;
    const k = keyframes(this.portrait ? SPIN_PORT : SPIN_LAND, p);
    // Exactly one turn across the chapter, so it hands over to Crunch on the hero pose.
    this.frameIndex = Math.round(p * n) % n;
    this.paint(this.frameIndex, { fit: this.portrait ? 1.75 : 'contain', ...k }, true);

    const { title, cue, layers, sheets, outro } = this.el;
    const t = range(p, 0.07, 0.22);
    setStyle(title, 'opacity', String(1 - smooth(range(p, 0.1, 0.2))));
    setStyle(title, 'transform', `translate3d(0, ${(-t * 9).toFixed(2)}vh, 0) scale(${(1 + t * 0.05).toFixed(4)})`);
    setStyle(cue, 'opacity', String(1 - range(p, 0.005, 0.04)));

    const a = fade(p, 0.47, 0.52, 0.62, 0.665);
    setStyle(layers, 'opacity', a.toFixed(3));
    setStyle(layers, 'transform', `translate3d(${((1 - smooth(range(p, 0.47, 0.53))) * 48).toFixed(1)}px, 0, 0)`);
    const b = fade(p, 0.71, 0.76, 0.86, 0.905);
    setStyle(sheets, 'opacity', b.toFixed(3));
    setStyle(sheets, 'transform', `translate3d(${((1 - smooth(range(p, 0.71, 0.77))) * -48).toFixed(1)}px, 0, 0)`);
    setStyle(outro, 'opacity', fade(p, 0.93, 0.975).toFixed(3));
  }
}

/* -------------------------------------------------------------- 02 CRUNCH */

// Shared by Crunch and Lamination: clear the top-left heading, then centre.
const HEADED_LAND = [
  [0.0, { s: 0.84, x: 0.13, y: -0.03 }],
  [0.08, { s: 0.84, x: 0.13, y: -0.03 }],
  [0.24, { s: 1, x: 0, y: 0 }],
  [1.0, { s: 1, x: 0, y: 0 }],
];

const METER_SEGMENTS = 28;
const DB_FLOOR = 30;
const DB_PEAK = 94;
const FLAKES = 1284;

export class CrunchChapter extends Chapter {
  constructor(...args) {
    super(...args);
    const bars = this.el.bars;
    for (let i = 0; i < METER_SEGMENTS; i++) bars.appendChild(document.createElement('i'));
    this.segments = [...bars.querySelectorAll('i')];
    this.prevFp = 0;
    this.snap = this.events.snap ?? 0.4; // film fraction where the croissant breaks
  }

  update(p, sound) {
    const n = this.seq.count;
    const fp = range(p, 0.05, 0.86);
    const k = this.portrait ? { s: 1, x: 0, y: 0 } : keyframes(HEADED_LAND, p);
    this.paint(fp * (n - 1), { fit: this.portrait ? 1.16 : 'contain', ...k });

    // The meter's big number is a peak hold: it counts up as the crack builds
    // and lands on 94 at the break. The bars show the live level, which then decays.
    const snap = this.snap;
    const build = easeIn(range(fp, snap - 0.16, snap + 0.015));
    const peak = fp <= 0 ? DB_FLOOR : DB_FLOOR + (DB_PEAK - DB_FLOOR) * build;
    const after = range(fp, snap + 0.015, 1);
    const live = fp < snap + 0.015 ? peak : DB_PEAK - (DB_PEAK - 58) * easeOut(after);
    const jitter = fp > 0 && fp < 1 ? Math.sin(fp * 420) * 1.2 : 0;
    const level = clamp((live + jitter - DB_FLOOR) / (100 - DB_FLOOR));
    const lit = Math.round(level * METER_SEGMENTS);
    this.segments.forEach((s, i) => s.classList.toggle('on', i < lit));
    setText(this.el.db, String(Math.round(peak)));
    setStyle(this.el.meter, '--peak', ((peak - DB_FLOOR) / (100 - DB_FLOOR)).toFixed(4));
    this.el.meter.classList.toggle('is-peak', peak >= DB_PEAK - 0.5);

    const flakes = fp < snap ? 0 : FLAKES * easeOut(range(fp, snap, 0.94));
    setText(this.el.flakes, fmtInt(flakes));

    setStyle(this.el.head, 'opacity', fade(p, -1, 0, 0.13, 0.21).toFixed(3));
    const hud = fade(p, 0.07, 0.13, 2, 3).toFixed(3);
    setStyle(this.el.meter, 'opacity', hud);
    setStyle(this.el.flakebox, 'opacity', hud);
    setStyle(this.el.uncrunch, 'opacity', fade(p, 0.86, 0.92).toFixed(3));

    if (sound) {
      if (this.prevFp < snap && fp >= snap) sound.crunch({ intensity: 1 });
      else if (this.prevFp >= snap && fp < snap) sound.crunch({ intensity: 0.85, reverse: true });
    }
    this.prevFp = fp;
  }
}

/* ---------------------------------------------------------- 03 LAMINATION */

const SLICE_LAYERS = [9, 11, 13, 15, 13, 11, 9]; // sums to 81

export class LaminationChapter extends Chapter {
  constructor(...args) {
    super(...args);
    this.specs = [...this.el.strip.children];
    const slices = this.events.slices?.length === 7
      ? this.events.slices
      : Array.from({ length: 7 }, (_, i) => ({ x: 0.1 + (i + 0.5) * (0.8 / 7), y: 0.3, b: 0.72 }));
    this.slices = slices;
    this.labels = slices.map((_, i) => {
      const tag = document.createElement('div');
      tag.className = 'slice-tag';
      tag.innerHTML = `<span class="mono">S${i + 1}</span><b class="mono">${SLICE_LAYERS[i]}</b><i></i>`;
      this.el.tags.appendChild(tag);
      return tag;
    });
  }

  update(p) {
    const n = this.seq.count;
    const fp = range(p, 0.07, 0.86);
    const k = this.portrait ? { s: 1, x: 0, y: 0 } : keyframes(HEADED_LAND, p);
    this.paint(fp * (n - 1), { fit: this.portrait ? 1.06 : 'contain', ...k });

    const layers = Math.round(81 * easeInOut(range(fp, 0.04, 0.96)));
    setText(this.el.count, pad(layers, 2));
    setStyle(this.el.counter, '--fill', (layers / 81).toFixed(4));
    this.specs.forEach((s, i) => s.classList.toggle('on', fp >= (i + 0.5) / this.specs.length * 0.95));

    // CT scan line sweeps across the drawn frame while the slices separate.
    const [x0] = this.toStage(0.04, 0);
    const [x1] = this.toStage(0.96, 0);
    setStyle(this.el.scan, 'transform', `translate3d(${(x0 + (x1 - x0) * fp).toFixed(1)}px,0,0)`);
    setStyle(this.el.scan, 'opacity', (fade(fp, 0.05, 0.11, 0.93, 0.99) * 0.9).toFixed(3));

    // CT labels: under each slice on wide screens (the layer counter owns the
    // top-right corner), above them on portrait screens (the HUDs own the bottom).
    const tagsOn = fade(p, 0.84, 0.9);
    setStyle(this.el.tags, 'opacity', tagsOn.toFixed(3));
    if (tagsOn > 0) {
      const below = !this.portrait;
      this.el.tags.classList.toggle('is-below', below);
      this.labels.forEach((tag, i) => {
        const s = this.slices[i];
        const [x, y] = below ? this.toStage(s.x, (s.b ?? 0.8) + 0.02) : this.toStage(s.x, s.y - 0.015);
        setStyle(tag, 'transform', `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
      });
    }

    setStyle(this.el.head, 'opacity', fade(p, -1, 0, 0.13, 0.21).toFixed(3));
    const hud = fade(p, 0.06, 0.12).toFixed(3);
    setStyle(this.el.counter, 'opacity', hud);
    setStyle(this.el.strip, 'opacity', hud);
  }
}

/* --------------------------------------------------------------- 04 CRUMB */

const CARD_WINDOWS = [
  [0.14, 0.19, 0.33, 0.38],
  [0.35, 0.4, 0.54, 0.59],
  [0.56, 0.61, 0.75, 0.8],
  [0.77, 0.82, 2, 3],
];

export class CrumbChapter extends Chapter {
  constructor(...args) {
    super(...args);
    this.cards = [...this.section.querySelectorAll('.glass-card')];
  }

  update(p) {
    const n = this.seq.count;
    this.paint(range(p, 0, 0.97) * (n - 1), { fit: 'cover' });
    setStyle(this.el.head, 'opacity', fade(p, -1, 0, 0.1, 0.17).toFixed(3));
    this.cards.forEach((card, i) => {
      const [a, b, c, d] = CARD_WINDOWS[i];
      const o = fade(p, a, b, c, d);
      const enter = 1 - smooth(range(p, a, b));
      const leave = smooth(range(p, c, d));
      setStyle(card, 'opacity', o.toFixed(3));
      setStyle(card, 'transform', `translate3d(0, ${(enter * 36 - leave * 28).toFixed(1)}px, 0) scale(${(0.97 + 0.03 * (1 - enter)).toFixed(4)})`);
      card.classList.toggle('is-live', o > 0.5);
    });
  }
}

/* ---------------------------------------------------------------- 05 BAKE */

// Crust colour names, pale to deep. Picked by how far the crust has darkened
// from its raw value toward its final value (measured from the frames).
const COLOUR_NAMES = ['Raw ivory', 'Pale straw', 'Wheat', 'Honey', 'Amber', 'Golden', 'Burnished gold'];
const BAKE_MINUTES = 18;

export class BakeChapter extends Chapter {
  update(p, sound, onScreen) {
    const n = this.seq.count;
    const fp = range(p, 0.06, 0.93);
    const idx = Math.round(fp * (n - 1));
    // Portrait: show the whole oven mouth at a fixed width, lifted above the
    // readout, instead of a cover crop that is all croissant.
    this.paint(idx, this.portrait ? { fit: 2.3, y: -0.12 } : { fit: 'cover', x: -0.045 });

    const secs = fp * BAKE_MINUTES * 60;
    setText(this.el.timer, `${pad(secs / 60)}:${pad(secs % 60)}`);
    const core = 4 + 90 * smooth(range(fp, 0.02, 0.97));
    setText(this.el.core, `${core.toFixed(1)}`);
    const oven = fp > 0 && fp < 1 ? 190 + Math.round(Math.sin(fp * 57) * 1.4) : 190;
    setText(this.el.oven, String(oven));
    const rise = 62 * easeOut(range(fp, 0.04, 0.72));
    setText(this.el.rise, `+${Math.round(rise)}`);
    setStyle(this.el.risebar, 'transform', `scaleY(${(1 + rise / 100).toFixed(3)})`);

    const colors = this.events.colors;
    let t = fp;
    if (colors?.length) {
      const c = colors[Math.min(colors.length - 1, Math.round(fp * (colors.length - 1)))];
      setStyle(this.el.swatch, 'background', c.hex);
      t = clamp(c.t);
    }
    setText(this.el.colour, COLOUR_NAMES[Math.min(COLOUR_NAMES.length - 1, Math.floor(t * COLOUR_NAMES.length))]);
    setStyle(this.el.progress, 'transform', `scaleX(${fp.toFixed(4)})`);
    setText(this.el.status, fp <= 0 ? 'Proofed · loading deck 2' : fp >= 1 ? 'Done · rest 10 min' : 'Baking · steam 12 s');
    this.el.readout.classList.toggle('is-done', fp >= 1);

    setStyle(this.el.head, 'opacity', fade(p, -1, 0, 0.13, 0.21).toFixed(3));
    setStyle(this.el.readout, 'opacity', fade(p, 0.04, 0.1).toFixed(3));

    if (sound) sound.setHum(onScreen ? fade(p, 0.0, 0.06, 0.94, 1) : 0);
  }
}
