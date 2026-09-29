#!/usr/bin/env bash
# Slice each Kling film into ~200 scroll-scrub frames.
#
#   1. detect-hold.mjs finds the frames Kling holds on the start image (and the
#      end image) and we trim them, so every scroll step shows motion.
#   2. The trimmed range is decoded once, scaled to 1920px wide (and 960px for
#      small screens), and 200 evenly spaced frames are written as WebP.
#   3. public/frames/manifest.json records the frame count per film.
#
# The spin film is a seamless loop (start = end = hero), so its closing frame
# is dropped: the viewer wraps from the last frame straight back to frame 0.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=${TARGET:-200}
FILMS=${FILMS:-"spin crunch lamination crumb bake"}
TMP=media/tmp
OUT=public/frames
mkdir -p "$TMP" "$OUT"

manifest="{"
for film in $FILMS; do
  src="media/src/$film.mp4"
  [[ -s "$src" ]] || { echo "missing $src (run npm run media:fetch)"; exit 1; }

  hold=$(node scripts/detect-hold.mjs "$src")
  first=$(node -e "console.log(JSON.parse(process.argv[1]).first)" "$hold")
  last=$(node -e "console.log(JSON.parse(process.argv[1]).last)" "$hold")
  total=$(node -e "console.log(JSON.parse(process.argv[1]).frames)" "$hold")
  if [[ "$film" == "spin" ]]; then
    last=$((last - 1))
  fi
  echo "$film: $total source frames, keeping $first..$last  $hold"

  for width in 1920 960; do
    rm -rf "$TMP/$film-$width" "$OUT/$film/$width"
    mkdir -p "$TMP/$film-$width" "$OUT/$film/$width"
    quality=$([[ $width == 1920 ]] && echo 82 || echo 78)
    ffmpeg -v error -i "$src" \
      -vf "select='between(n\,$first\,$last)',scale=$width:-2:flags=lanczos" \
      -fps_mode passthrough -c:v libwebp -quality "$quality" -compression_level 5 \
      "$TMP/$film-$width/%04d.webp"

    kept=$(ls "$TMP/$film-$width" | wc -l)
    count=$(( kept < TARGET ? kept : TARGET ))
    # Evenly spaced pick of $count frames out of $kept, renamed 000..N-1.
    node -e '
      const [kept, count, dir, out] = process.argv.slice(1);
      const fs = require("fs");
      for (let k = 0; k < +count; k++) {
        const i = Math.round(k * (kept - 1) / (count - 1)) + 1;
        fs.copyFileSync(`${dir}/${String(i).padStart(4, "0")}.webp`, `${out}/${String(k).padStart(3, "0")}.webp`);
      }' "$kept" "$count" "$TMP/$film-$width" "$OUT/$film/$width"
    echo "  $width px: $count frames, $(du -sh "$OUT/$film/$width" | cut -f1)"
  done
  manifest+="\"$film\":{\"count\":$count,\"trimmedFrom\":$first,\"trimmedTo\":$last,\"sourceFrames\":$total},"
done
manifest="${manifest%,}}"
# Merge with any films already in the manifest so FILMS=... can rebuild one film.
node -e '
  const fs = require("fs"); const path = "public/frames/manifest.json";
  const prev = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
  fs.writeFileSync(path, JSON.stringify({ ...prev, ...JSON.parse(process.argv[1]) }, null, 2) + "\n");
' "$manifest"
cat "$OUT/manifest.json"
