# LAMINA — Croissant Pro

A cinematic, scroll-scrubbed launch site for a fictional artisan bakery that
launches its croissant the way a tech giant launches a flagship phone:
**"Croissant Pro. Our most layered croissant ever."**

LAMINA is not a real bakery and nothing on the site talks to a server.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

`npm run build && npm run preview` serves the production build on port 4173.

## What's on the page

| Section | What it does |
|---|---|
| 01 Spin | Pinned canvas scrubbing a seamless 360° turn. The croissant starts small under a huge gold "Croissant Pro", rises to fill the stage, then glides left for "81 layers." and right for "27 sheets." |
| 02 Crunch | Ultra-slow-motion snap. A dB meter counts up to 94, a flakes-airborne counter runs, and "Scroll back up to un-crunch it." plays it in reverse. |
| 03 Lamination | Seven CT-scan slices glide apart under a sweeping scan line; a 0→81 layer counter, a spec strip, and per-slice labels positioned from the real frames. |
| 04 Crumb | Fly-through of the honeycomb crumb with frosted glass cards. |
| 05 Bake | Deck-oven time-lapse with a live readout: timer, oven and core temperature, rise, and a colour name plus swatch measured from the frames. |
| 06 Inside | X-ray / thermal cursor lens over pixel-aligned plates. The readout samples the pixel under the crosshair (density and HU, or °C via an ironbow lookup). |
| 07 Every angle | Drag-to-spin viewer reusing the Spin frames, with inertia and arrow-key control. |
| 08 Lineup | Four pastries and a spec table. |
| 09 Order ahead | Quantity steppers, pickup slots, a live next-batch countdown, and a Reserve button that confirms nothing was sent. |

Sound is off by default. The toggle synthesises the crunch and an oven hum
with Web Audio; there are no audio files.

## Media pipeline

All stills and films were generated on Higgsfield; `scripts/media.json`
records every job id, prompt and reference.

- **Stills**: `gpt_image_2_5`, 4k, quality high, 16:9. One hero plate; every
  other hero-based plate (snapped, seven slices, X-ray, thermal, lineup
  pastries) is an edit that passes the hero's job id as an image reference.
  The baked oven frame is an edit of the raw oven frame, and the crumb end
  frame is an edit of the crumb macro.
- **Films**: `kling3_0`, mode 4k, 10 s, sound off, 16:9, always with a start
  and an end image.

```bash
npm run media:fetch    # download sources into media/src (git-ignored)
npm run media:plates   # hero / X-ray / thermal / lineup plates → public/img
npm run media:frames   # trim Kling's holds, slice 200 frames at 1920 and 960 px
node scripts/analyze-frames.mjs   # measure snap timing, slice positions, crust colour
```

`scripts/detect-hold.mjs` finds the frames Kling holds on the start image (and
on the end image) by measuring each frame's distance from the first/last frame,
so slow films like the bake time-lapse are not mistaken for static ones. On
these films it trimmed 6 (spin), 9 (crunch) and 15 (lamination) held frames at
the start; crumb and bake move from their first frame.

`scripts/analyze-frames.mjs` measures what the overlays sync to: the frame
where the crunch's crack splits open (dark gap pixels appearing inside the
croissant's silhouette), the position of each of the seven slices, and the
crust colour per bake frame with its browning index (CIELAB), which drives the
oven readout's colour name.

Restart `npm run dev` after regenerating frames: Vite indexes `public/` when it
starts and can miss folders that are deleted and recreated underneath it.

## Verify

```bash
URL=http://127.0.0.1:5173/ OUT=verification node scripts/verify.mjs
```

Headless Chromium scrolls every chapter to several points mid-scroll and
screenshots them, reads the live overlay values, drives the lens, the viewer,
the order card and the sound toggle, repeats on a phone viewport, and fails on
console errors, failed requests, or blank canvases.
