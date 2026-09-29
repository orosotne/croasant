export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** 0→1 as p travels from a to b (clamped). */
export const range = (p, a, b) => clamp((p - a) / (b - a));

export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t) => t * t * t;

/** Opacity envelope: fades in across [a, b], holds, fades out across [c, d]. */
export const fade = (p, a, b, c = 2, d = 3) => Math.min(smooth(range(p, a, b)), 1 - smooth(range(p, c, d)));

/**
 * Interpolate numeric props across keyframes: [[p, {x, y, s}], ...] sorted by p.
 * Each segment eases independently, so holds are just repeated values.
 */
export function keyframes(keys, p, ease = easeInOut) {
  if (p <= keys[0][0]) return { ...keys[0][1] };
  for (let i = 1; i < keys.length; i++) {
    const [p1, v1] = keys[i];
    if (p <= p1) {
      const [p0, v0] = keys[i - 1];
      const t = ease(range(p, p0, p1));
      const out = {};
      for (const k in v1) out[k] = lerp(v0[k], v1[k], t);
      return out;
    }
  }
  return { ...keys[keys.length - 1][1] };
}

export const pad = (n, w = 2) => String(Math.max(0, Math.floor(n))).padStart(w, '0');
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const fmtEuro = (n) => `€${n.toFixed(2)}`;

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Set a style property only when the value changed (avoids style recalc churn every frame). */
export function setStyle(el, prop, value) {
  const key = `_s_${prop}`;
  if (el[key] === value) return;
  el[key] = value;
  if (prop.startsWith('--')) el.style.setProperty(prop, value);
  else el.style[prop] = value;
}

export function setText(el, value) {
  if (el._t === value) return;
  el._t = value;
  el.textContent = value;
}
