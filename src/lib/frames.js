// Frame sequences for the scroll-scrubbed films.
//
// Each film is ~200 WebP frames. They load progressively (every 32nd frame,
// then 16th, 8th, … down to every frame) so a chapter is scrubbable almost
// immediately and sharpens in as the gaps fill. Frames stay as <img> elements
// rather than ImageBitmaps: the browser can then evict decoded pixels under
// memory pressure instead of us pinning ~1.6 GB of RGBA per film.
//
// Frames arrive one of two ways:
//   - one file per frame (frames/<film>/<width>/NNN.webp), the default;
//   - sprite atlases: 3840×2160 WebPs tiling consecutive frames (built by
//     scripts/atlas-frames.mjs for hosts that cap the file count). A loaded
//     atlas fills all of its frames at once; each frame then draws from its tile.
//
// A frame is either an <img> (drawn whole) or { img, sx, sy, sw, sh, key }
// (drawn from a tile). drawFrame() and frameKey() accept both.

const pad3 = (i) => String(i).padStart(3, '0');

/** Stable identity for a frame, used to skip redundant repaints. */
export const frameKey = (f) => (f ? f.key || f.src : 'none');

function progressiveOrder(count) {
  const seen = new Uint8Array(count);
  const out = [];
  for (const stride of [32, 16, 8, 4, 2, 1]) {
    for (let i = 0; i < count; i += stride) {
      if (!seen[i]) {
        seen[i] = 1;
        out.push(i);
      }
    }
  }
  if (count && !seen[count - 1]) out.push(count - 1);
  return out;
}

export class FrameSequence {
  constructor(name, count, width) {
    this.name = name;
    this.count = count;
    this.width = width;
    this.images = new Array(count).fill(null);
    this.loaded = 0;
    this.priority = 1e9; // lower loads first; updated from scroll distance
    this.queue = progressiveOrder(count);
    this.atlas = null;
    this.listeners = new Set();
  }

  url(i) {
    return `frames/${this.name}/${this.width}/${pad3(i)}.webp`;
  }

  /** Load from sprite atlases: { cols, rows, w, h, files: [...] }. Atlases still load progressively. */
  useAtlases(atlas) {
    this.atlas = atlas;
    this.queue = progressiveOrder(atlas.files.length);
  }

  /** Frames held by atlas a, with their source rectangles. */
  atlasFrames(a) {
    const { cols, rows, w, h } = this.atlas;
    const per = cols * rows;
    const out = [];
    for (let t = 0; t < per; t++) {
      const i = a * per + t;
      if (i >= this.count) break;
      out.push([i, (t % cols) * w, Math.floor(t / cols) * h]);
    }
    return out;
  }

  /** Called once per frame, whether it decoded or not. */
  settle(i, frame) {
    if (frame) {
      this.images[i] = frame;
      this.listeners.forEach((fn) => fn(this, i));
    }
    this.loaded++;
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

// Chrome rejects decode() when too many large images decode at once, so keep
// a few in flight. A refused pre-decode of an image that did load is still
// usable: the browser decodes it at first draw instead.
const decoding = { active: 0, max: 4, waiting: [] };
function decodeImage(img) {
  return new Promise((resolve, reject) => {
    const run = () => {
      decoding.active++;
      img
        .decode()
        .then(
          () => resolve(img),
          (err) => (img.complete && img.naturalWidth ? resolve(img) : reject(err)),
        )
        .finally(() => {
          decoding.active--;
          decoding.waiting.shift()?.();
        });
    };
    if (decoding.active < decoding.max) run();
    else decoding.waiting.push(run);
  });
}

/** Load and decode one image, retrying transient failures (aborted requests, busy servers). */
function load(url, attempt = 0) {
  const img = new Image();
  img.decoding = 'async';
  img.src = attempt ? `${url}?retry=${attempt}` : url;
  return decodeImage(img).catch((err) => {
    if (attempt >= 2) throw err;
    return new Promise((r) => setTimeout(r, 250 * (attempt + 1))).then(() => load(url, attempt + 1));
  });
}

/** One shared queue so films never compete for the browser's connections. */
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
      const job = seq.queue.shift();
      this.active++;
      let work;
      if (seq.atlas) {
        const tiles = seq.atlasFrames(job);
        const { w, h } = seq.atlas;
        work = load(seq.atlas.files[job]).then(
          (img) => tiles.forEach(([i, sx, sy]) => seq.settle(i, { img, sx, sy, sw: w, sh: h, key: `${img.src}#${i}` })),
          () => tiles.forEach(([i]) => seq.settle(i, null)),
        );
      } else {
        work = load(seq.url(job)).then(
          (img) => seq.settle(job, img),
          // Still failing after retries: leave a gap; frame() falls back to its neighbours.
          () => seq.settle(job, null),
        );
      }
      work.finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
}

/**
 * Draw a frame into a canvas-sized box.
 * fit: 'contain' | 'cover' | number (frame width as a multiple of canvas width).
 * s scales around the box centre; x/y shift by fractions of the canvas size.
 */
export function drawFrame(ctx, frame, W, H, { fit = 'contain', s = 1, x = 0, y = 0 } = {}) {
  const tiled = !(frame instanceof HTMLImageElement);
  const img = tiled ? frame.img : frame;
  const iw = tiled ? frame.sw : img.naturalWidth || img.width;
  const ih = tiled ? frame.sh : img.naturalHeight || img.height;
  let dw;
  if (fit === 'cover') dw = Math.max(W, (H * iw) / ih);
  else if (fit === 'contain') dw = Math.min(W, (H * iw) / ih);
  else dw = W * fit;
  dw *= s;
  const dh = (dw * ih) / iw;
  const dx = (W - dw) / 2 + x * W;
  const dy = (H - dh) / 2 + y * H;
  if (tiled) ctx.drawImage(img, frame.sx, frame.sy, iw, ih, dx, dy, dw, dh);
  else ctx.drawImage(img, dx, dy, dw, dh);
  return { dx, dy, dw, dh };
}
