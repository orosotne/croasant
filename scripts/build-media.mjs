// Downloads the Higgsfield plates + films listed in media.json and bakes them into
// web-ready assets under public/media: resized JPG plates and per-film JPG frame
// sequences for canvas scrubbing, plus a manifest the site reads at runtime.
//
//   node scripts/build-media.mjs            # download + bake
//   FFMPEG=/path/to/ffmpeg node scripts/... # override ffmpeg binary
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(join(root, 'media.json'), 'utf8'));
const src = join(root, 'src-media');
const out = join(root, 'public/media');
mkdirSync(src, { recursive: true });
mkdirSync(out, { recursive: true });

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  try {
    return execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  } catch {}
  throw new Error('ffmpeg not found: install it or `pip install imageio-ffmpeg`, or set FFMPEG');
}
const ffmpeg = findFfmpeg();
const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

function fetchTo(url, file) {
  if (existsSync(file)) return true;
  if (!url) return false;
  try {
    execFileSync('curl', ['-sSfL', '--retry', '3', '-o', file, url], { stdio: 'inherit' });
    return true;
  } catch {
    console.warn(`  ! could not download ${url}`);
    rmSync(file, { force: true });
    return false;
  }
}

const manifest = { plates: {}, films: {} };

for (const [name, p] of Object.entries(cfg.plates)) {
  const raw = join(src, `${name}.png`);
  if (!fetchTo(p.url, raw)) continue;
  const width = name === 'macro' ? 1920 : 2400;
  run(['-i', raw, '-vf', `scale=${width}:-2:flags=lanczos`, '-q:v', '3', join(out, `${name}.jpg`)]);
  run(['-i', raw, '-vf', 'scale=960:-2:flags=lanczos', '-q:v', '5', join(out, `${name}-sm.jpg`)]);
  manifest.plates[name] = { src: `/media/${name}.jpg`, small: `/media/${name}-sm.jpg` };
  console.log(`plate ${name} ✓`);
}

// Cumulative visual change per frame, normalised 0..1. Lets the site drive its
// readouts from what is actually happening on screen instead of raw scroll.
function changeCurve(raw, filters, count) {
  const W = 64, H = 36;
  const buf = execFileSync(ffmpeg, ['-v', 'error', '-i', raw, '-vf', `${filters},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const n = Math.min(count, Math.floor(buf.length / (W * H)));
  const acc = [0];
  for (let i = 1; i < n; i++) {
    let d = 0;
    for (let k = 0; k < W * H; k++) d += Math.abs(buf[i * W * H + k] - buf[(i - 1) * W * H + k]);
    acc.push(acc[i - 1] + d / (W * H));
  }
  const max = acc[acc.length - 1] || 1;
  return acc.map((v) => Math.round((v / max) * 1000) / 1000);
}

for (const [name, f] of Object.entries(cfg.films)) {
  const raw = join(src, `${name}.mp4`);
  if (!fetchTo(f.url, raw)) continue;
  const trim = f.trim ? ['-ss', String(f.trim[0]), '-to', String(f.trim[1])] : [];
  for (const [tier, width, q] of [['lg', 1600, 4], ['sm', 900, 5]]) {
    const dir = join(out, name, tier);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    run([...trim, '-i', raw, '-vf', `fps=${f.fps},scale=${width}:-2:flags=lanczos`, '-q:v', String(q), join(dir, '%04d.jpg')]);
  }
  const count = readdirSync(join(out, name, 'lg')).filter((n) => n.endsWith('.jpg')).length;
  const curveArgs = f.trim ? `trim=${f.trim[0]}:${f.trim[1]},setpts=PTS-STARTPTS,fps=${f.fps}` : `fps=${f.fps}`;
  manifest.films[name] = { count, path: `/media/${name}`, curve: changeCurve(raw, curveArgs, count) };
  console.log(`film ${name} ✓ ${count} frames`);
}

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('manifest written', JSON.stringify(manifest));
