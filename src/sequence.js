// Canvas frame sequencer for scroll scrubbing.
//
// Frames load coarse-to-fine (every 16th, then 8th, 4th, 2nd, 1st) so any scroll
// position has a nearby frame to show within the first few requests; the draw
// call always picks the closest frame that is ready. When a film has no frames
// (not generated yet, or download blocked) the chapter supplies a `fallback`
// painter that renders from the still plates instead.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
    img.onerror = reject;
    img.src = src;
  });
}

// Cover-fit with a focal point (fx, fy in 0..1) and optional extra zoom.
export function drawCover(ctx, img, w, h, { fx = 0.5, fy = 0.5, zoom = 1, dx = 0, dy = 0 } = {}) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * s;
  const dh = ih * s;
  const x = (w - dw) * fx + dx * w;
  const y = (h - dh) * fy + dy * h;
  ctx.drawImage(img, x, y, dw, dh);
}

export class Sequence {
  constructor(canvas, { film, focal = {}, fallback } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.film = film; // { count, path } or undefined
    this.focal = focal;
    this.fallback = fallback;
    this.frames = film ? new Array(film.count).fill(null) : [];
    this.progress = 0;
    this.drawn = -1;
    this.dirty = true;
    this.w = 0;
    this.h = 0;
    this.tier = 'lg';
    this.resize();
  }

  get hasFilm() { return !!this.film && this.film.count > 0; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (w !== this.w || h !== this.h) {
      this.w = this.canvas.width = w;
      this.h = this.canvas.height = h;
      this.ctx.imageSmoothingQuality = 'high';
      this.invalidate();
    }
    // Small tier is plenty unless the canvas is genuinely wide.
    this.tier = w > 1100 ? 'lg' : 'sm';
  }

  src(i) {
    return `${this.film.path}/${this.tier}/${String(i + 1).padStart(4, '0')}.jpg`;
  }

  // Load order: coarse strides first so scrubbing works before everything arrives.
  order() {
    const n = this.film.count;
    const seen = new Uint8Array(n);
    const out = [];
    for (const stride of [16, 8, 4, 2, 1]) {
      for (let i = 0; i < n; i += stride) if (!seen[i]) { seen[i] = 1; out.push(i); }
    }
    if (!seen[n - 1]) out.splice(1, 0, n - 1);
    return out;
  }

  // Resolves after the first coarse pass (enough to scrub), keeps loading the rest.
  load({ concurrency = 6, onProgress } = {}) {
    if (!this.hasFilm) return Promise.resolve();
    const queue = this.order();
    const coarse = Math.ceil(this.film.count / 16) + 1;
    let done = 0;
    let resolveCoarse;
    const coarseReady = new Promise((r) => (resolveCoarse = r));
    const next = () => {
      const i = queue.shift();
      if (i === undefined) return Promise.resolve();
      return loadImage(this.src(i))
        .then((img) => { this.frames[i] = img; this.dirty = true; })
        .catch(() => {})
        .finally(() => {
          done++;
          onProgress?.(done / this.film.count, done);
          if (done >= coarse) resolveCoarse();
        })
        .then(next);
    };
    const workers = Array.from({ length: concurrency }, next);
    Promise.all(workers).then(resolveCoarse);
    return coarseReady;
  }

  nearest(i) {
    const f = this.frames;
    if (f[i]) return i;
    for (let d = 1; d < f.length; d++) {
      if (f[i - d]) return i - d;
      if (f[i + d]) return i + d;
    }
    return -1;
  }

  set(p) {
    p = clamp(p);
    if (p !== this.progress) { this.progress = p; this.dirty = true; }
  }

  render() {
    if (!this.dirty) return;
    const { ctx, w, h } = this;
    if (this.hasFilm) {
      const target = Math.round(this.progress * (this.film.count - 1));
      const i = this.nearest(target);
      if (i === -1) return;
      // Stay dirty until the exact frame is in, so it swaps in as soon as it lands.
      this.dirty = i !== target;
      if (i === this.drawn) return;
      drawCover(ctx, this.frames[i], w, h, this.focal);
      this.drawn = i;
    } else if (this.fallback) {
      this.dirty = false;
      ctx.fillStyle = '#050607';
      ctx.fillRect(0, 0, w, h);
      this.fallback(ctx, w, h, this.progress);
    }
  }

  invalidate() { this.dirty = true; this.drawn = -1; }
}
