#!/usr/bin/env bash
# Convert the 4k stills in media/src/ into the web plates the site uses.
set -euo pipefail
cd "$(dirname "$0")/.."
S=media/src
O=public/img
mkdir -p "$O/lineup"

webp() { # src out width quality [extra filters]
  ffmpeg -v error -y -i "$1" -vf "${5:+$5,}scale=$3:-2:flags=lanczos" -c:v libwebp -quality "$4" -compression_level 6 "$2"
}

# Lens plates: hero, X-ray and thermal share one framing, so they stay pixel-aligned.
webp $S/hero.png      $O/hero.webp     2560 86
webp $S/c_xray.png    $O/xray.webp     2560 86
webp $S/d_thermal.png $O/thermal.webp  2560 86

# Lineup cards: a 4:3 crop around the centred pastry.
crop="crop=2880:2160:480:0"
webp $S/hero.png       $O/lineup/pro.webp    1200 84 "$crop"
webp $S/p_almond.png   $O/lineup/promax.webp 1200 84 "$crop"
webp $S/p_painchoc.png $O/lineup/air.webp    1200 84 "$crop"
webp $S/p_kouign.png   $O/lineup/ultra.webp  1200 84 "$crop"

# Order card thumbnails.
for n in pro promax air ultra; do
  ffmpeg -v error -y -i "$O/lineup/$n.webp" -vf "crop=900:900:150:0,scale=240:240:flags=lanczos" -c:v libwebp -quality 82 "$O/lineup/$n-thumb.webp"
done

# Social card.
ffmpeg -v error -y -i $S/hero.png -vf "crop=3840:2021:0:70,scale=1200:630:flags=lanczos" -q:v 3 public/og.jpg

du -sh $O/* public/og.jpg
