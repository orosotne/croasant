// Frame sequences for the scroll-scrubbed films.
//
// Each film is ~200 WebP frames. They load progressively (every 32nd frame,
// then 16th, 8th, … down to every frame) so a chapter is scrubbable almost
// immediately and sharpens in as the gaps fill. Frames stay as <img> elements
// rather than ImageBitmaps: the browser can then evict decoded pixels under
// memory pressure instead of us pinning ~1.6 GB of RGBA per film.

const pad3 = (i) => String(i).padStart(3, '0');

export class FrameSequence {
  constructor(name, count, width) {
    this.name = name;
    this.count = count;
    this.width = width;
    this.images = new Array(count).fill(null);
    this.loaded = 0;
    this.priority = 1e9; // lower loads first; updated from scroll distance
    this.queue = this.progressiveOrder();
    this.listeners = new Set();
  }

  url(i) {
    return `/frames/${this.name}/${this.width}/${pad3(i)}.webp`;
  }

  progressiveOrder() {
    const seen = new Uint8Array(this.count);
    const out = [];
    for (const stride of [32, 16, 8, 4, 2, 1]) {
      for (let i = 0; i < this.count; i += stride) {
        if (!seen[i]) {
          seen[i] = 1;
          out.push(i);
        }
      }
    }
    if (!seen[this.count - 1]) out.push(this.count - 1);
    return out;
  }

  get done() {
    return this.loaded >= this.count;
  }

  onLoad(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Nearest loaded frame to index i (searching outward), or null. */
  frame(i) {
    const n = this.count;
    i = Math.max(0, Math.min(n - 1, Math.round(i)));
    if (this.images[i]) return this.images[i];
    for (let d = 1; d < n; d++) {
      const a = i - d >= 0 ? this.images[i - d] : null;
      if (a) return a;
      const b = i + d < n ? this.images[i + d] : null;
      if (b) return b;
    }
    return null;
  }

  /** Nearest loaded frame when the index wraps around (looping films). */
  frameLoop(i) {
    const n = this.count;
    i = ((Math.round(i) % n) + n) % n;
    if (this.images[i]) return this.images[i];
    for (let d = 1; d < n / 2; d++) {
      const a = this.images[(i - d + n) % n];
      if (a) return a;
      const b = this.images[(i + d) % n];
      if (b) return b;
    }
    return null;
  }
}

/** One shared queue so films never compete for the browser's six connections. */
export class FrameLoader {
  constructor(concurrency = 6) {
    this.concurrency = concurrency;
    this.sequences = [];
    this.active = 0;
  }

  add(seq) {
    this.sequences.push(seq);
    this.pump();
  }

  next() {
    let best = null;
    for (const s of this.sequences) {
      if (s.queue.length && (!best || s.priority < best.priority)) best = s;
    }
    return best;
  }

  pump() {
    while (this.active < this.concurrency) {
      const seq = this.next();
      if (!seq) return;
      const i = seq.queue.shift();
      this.active++;
      const img = new Image();
      img.decoding = 'async';
      img.src = seq.url(i);
      img
        .decode()
        .then(() => {
          seq.images[i] = img;
          seq.loaded++;
          seq.listeners.forEach((fn) => fn(seq, i));
        })
        .catch(() => {
          // A missing frame just leaves a gap; frame() falls back to its neighbours.
          seq.loaded++;
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

/**
 * Draw an image into a canvas-sized box.
 * fit: 'contain' | 'cover' | number (frame width as a multiple of canvas width).
 * s scales around the box centre; x/y shift by fractions of the canvas size.
 */
export function drawFrame(ctx, img, W, H, { fit = 'contain', s = 1, x = 0, y = 0 } = {}) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  let dw;
  if (fit === 'cover') dw = Math.max(W, (H * iw) / ih);
  else if (fit === 'contain') dw = Math.min(W, (H * iw) / ih);
  else dw = W * fit;
  dw *= s;
  const dh = (dw * ih) / iw;
  const dx = (W - dw) / 2 + x * W;
  const dy = (H - dh) / 2 + y * H;
  ctx.drawImage(img, dx, dy, dw, dh);
  return { dx, dy, dw, dh };
}
