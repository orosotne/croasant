# UNDO — paint correction & ceramic coating (fictional studio)

A scroll-scrubbed site: scrolling restores a neglected coupe; scrolling back (or ⌘Z / Ctrl+Z) brings twenty years of grime back in two seconds.

```bash
npm install
npm run dev          # http://127.0.0.1:5173
node scripts/verify.mjs   # scrub test (down + up), ⌘Z timing, quote/booking, mobile — screenshots in verify-out/
```

## Media

Stills (gpt_image_2_5, 4k) and films (kling3_0, 4k, 10 s, silent) were generated on Higgsfield; their job IDs and URLs are in `media.json`. `npm run media` downloads them and bakes `public/media/` (plates + JPG frame sequences + `manifest.json`, which includes a per-frame "visual change" curve that drives the gloss readout). Needs ffmpeg (`pip install imageio-ffmpeg` works). Restart the dev server after rebuilding media.

Edit notes, from reviewing the films:
- **Restoration** is trimmed to 0.6–6.8 s, where the restoration line actually moves (the rest is static).
- **Show**: the arc deforms the car past the rear three-quarter view, so only the clean first 4.2 s (~110° of travel) is used and played out and back (ping-pong) — seamless by construction.
- **Proof** is trimmed to start 2.5 s in, closer to the pour.
