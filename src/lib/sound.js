// Everything audible on the page is synthesised with Web Audio: no sound files.
//
//   crunch()  — a cluster of band-passed noise grains (the flakes) over a short
//               pitched thump (the snap). reverse:true plays the "un-crunch":
//               grains swell and converge into the snap instead of bursting out.
//   setHum()  — oven drone: 50 Hz mains hum and harmonics, a low-passed brown
//               noise fan, and a faint band-passed sizzle that breathes slowly.
//
// The AudioContext is created on the first click of the sound toggle, which
// satisfies autoplay policies; until then nothing audio-related exists.

function noiseBuffer(ctx, seconds, kind) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else {
      d[i] = white;
    }
  }
  return buf;
}

export class Sound {
  constructor() {
    this.on = false;
    this.ctx = null;
    this.humLevel = 0;
    this.lastCrunch = 0;
  }

  async toggle() {
    if (this.on) this.disable();
    else await this.enable();
    return this.on;
  }

  async enable() {
    if (!this.ctx) this.build();
    await this.ctx.resume();
    this.on = true;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.9, t, 0.06);
    this.hum.gain.setTargetAtTime(this.humLevel * 0.55, t, 0.3);
  }

  disable() {
    this.on = false;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.05);
    this.hum.gain.setTargetAtTime(0, t, 0.05);
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => !this.on && this.ctx.suspend(), 400);
  }

  build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new Ctx());
    this.white = noiseBuffer(ctx, 2, 'white');
    this.brown = noiseBuffer(ctx, 4, 'brown');

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);

    // Oven drone.
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    this.hum.connect(this.master);
    for (const [freq, gain, type] of [
      [50, 0.16, 'sine'],
      [100, 0.09, 'sine'],
      [150, 0.03, 'triangle'],
      [200.4, 0.012, 'sine'],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.hum);
      o.start();
    }
    const fan = ctx.createBufferSource();
    fan.buffer = this.brown;
    fan.loop = true;
    const fanLp = ctx.createBiquadFilter();
    fanLp.type = 'lowpass';
    fanLp.frequency.value = 340;
    const fanGain = ctx.createGain();
    fanGain.gain.value = 0.55;
    fan.connect(fanLp).connect(fanGain).connect(this.hum);
    fan.start();

    const sizzle = ctx.createBufferSource();
    sizzle.buffer = this.white;
    sizzle.loop = true;
    const sizzleBp = ctx.createBiquadFilter();
    sizzleBp.type = 'bandpass';
    sizzleBp.frequency.value = 3600;
    sizzleBp.Q.value = 0.8;
    const sizzleGain = ctx.createGain();
    sizzleGain.gain.value = 0.014;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.21;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.009;
    lfo.connect(lfoDepth).connect(sizzleGain.gain);
    lfo.start();
    sizzle.connect(sizzleBp).connect(sizzleGain).connect(this.hum);
    sizzle.start();
  }

  /** 0..1 — how present the oven is. Smoothed so scrolling never clicks. */
  setHum(level) {
    const changed = Math.abs(level - this.humLevel) > 0.004 || (level === 0) !== (this.humLevel === 0);
    this.humLevel = level;
    if (!this.ctx || !changed) return;
    this.hum.gain.setTargetAtTime(this.on ? level * 0.55 : 0, this.ctx.currentTime, 0.3);
  }

  crunch({ intensity = 1, reverse = false } = {}) {
    if (!this.on || !this.ctx) return;
    const now = performance.now();
    if (now - this.lastCrunch < 220) return;
    this.lastCrunch = now;

    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.012;
    const span = 0.46;
    const grains = 30;
    for (let i = 0; i < grains; i++) {
      const u = Math.pow(Math.random(), 2.3); // front-loaded: most flakes go at the break
      const t = reverse ? t0 + (1 - u) * span : t0 + u * span;
      const len = 0.01 + Math.random() * 0.07;
      const peak = (0.2 + Math.random() * 0.8) * intensity * (1 - u * 0.55);

      const src = ctx.createBufferSource();
      src.buffer = this.white;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300 + Math.random() * 5600;
      bp.Q.value = 0.6 + Math.random() * 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      if (reverse) {
        g.gain.exponentialRampToValueAtTime(peak, t + len);
        g.gain.linearRampToValueAtTime(0.0001, t + len + 0.004);
      } else {
        g.gain.linearRampToValueAtTime(peak, t + 0.0025);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      }
      src.connect(bp).connect(g).connect(this.master);
      src.start(t, Math.random() * 1.6, len + 0.02);
    }

    // The snap itself: a pitched-down thump plus a hard click.
    const ts = reverse ? t0 + span : t0;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, ts);
    osc.frequency.exponentialRampToValueAtTime(42, ts + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, ts);
    og.gain.linearRampToValueAtTime(0.55 * intensity, ts + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, ts + 0.14);
    osc.connect(og).connect(this.master);
    osc.start(ts);
    osc.stop(ts + 0.16);

    const click = ctx.createBufferSource();
    click.buffer = this.white;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.7 * intensity, ts);
    cg.gain.exponentialRampToValueAtTime(0.0001, ts + 0.018);
    click.connect(hp).connect(cg).connect(this.master);
    click.start(ts, Math.random(), 0.03);
  }
}
