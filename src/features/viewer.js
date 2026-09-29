// Drag-to-spin viewer. Reuses the Spin chapter's frames: the film is one
// seamless 360° turn, so frame index maps straight to an angle.

import { drawFrame, frameKey } from '../lib/frames.js';
import { prefersReducedMotion, setText, setStyle } from '../lib/util.js';

const PX_PER_TURN = 1400; // drag distance for one full rotation at 1x

export function initViewer(root, seq) {
  const stage = root.querySelector('.viewer__stage');
  const canvas = stage.querySelector('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const deg = root.querySelector('[data-deg]');
  const dial = root.querySelector('.viewer__dial');
  const hint = root.querySelector('.viewer__hint');
  const reduced = prefersReducedMotion();

  let angle = 0; // turns, unbounded
  let velocity = 0; // turns per frame
  let dragging = false;
  let lastX = 0;
  let lastT = 0;
  let interacted = false;
  let visible = false;
  let key = '';
  let W = 0;
  let H = 0;

  const measure = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(stage.clientWidth * dpr);
    H = Math.round(stage.clientHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    key = '';
  };
  measure();
  window.addEventListener('resize', measure);
  seq.onLoad(() => (key = ''));

  const paint = () => {
    const n = seq.count;
    const idx = ((Math.round(angle * n) % n) + n) % n;
    const img = seq.frameLoop(idx);
    const k = `${frameKey(img)}|${W}x${H}`;
    const d = ((idx / n) * 360) | 0;
    setText(deg, `${String(d).padStart(3, '0')}°`);
    setStyle(dial, '--a', `${d}deg`);
    stage.setAttribute('aria-valuenow', String(d));
    if (k === key) return;
    key = k;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!img) return;
    ctx.imageSmoothingQuality = 'high';
    const portrait = H > W;
    drawFrame(ctx, img, W, H, { fit: portrait ? 1.7 : 'cover', s: portrait ? 1 : 1.18, y: 0.02 });
  };

  const start = (x) => {
    dragging = true;
    interacted = true;
    lastX = x;
    lastT = performance.now();
    velocity = 0;
    stage.classList.add('is-dragging');
    hint.classList.add('is-hidden');
  };
  const move = (x) => {
    if (!dragging) return;
    const now = performance.now();
    const dx = x - lastX;
    const dt = Math.max(1, now - lastT);
    const turns = -dx / PX_PER_TURN;
    angle += turns;
    velocity = (turns / dt) * 16.7;
    lastX = x;
    lastT = now;
  };
  const end = () => {
    dragging = false;
    stage.classList.remove('is-dragging');
  };

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    start(e.clientX);
  });
  stage.addEventListener('pointermove', (e) => move(e.clientX));
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 / 12 : 1 / 72;
    if (e.key === 'ArrowLeft') angle -= step;
    else if (e.key === 'ArrowRight') angle += step;
    else if (e.key === 'Home') angle = 0;
    else return;
    e.preventDefault();
    interacted = true;
    velocity = 0;
    hint.classList.add('is-hidden');
  });

  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { rootMargin: '120px' }).observe(stage);

  return {
    measure,
    tick() {
      if (!visible) return;
      if (!dragging) {
        if (Math.abs(velocity) > 0.00002) {
          angle += velocity;
          velocity *= 0.94; // inertia
        } else if (!interacted && !reduced) {
          angle += 0.0009; // slow idle turntable until someone grabs it
        }
      }
      paint();
    },
  };
}
