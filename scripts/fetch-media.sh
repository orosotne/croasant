#!/usr/bin/env bash
# Download every still and film listed in scripts/media.json into media/src/.
# Sources are 4k and large, so media/src/ is git-ignored; the processed web
# assets in public/ are what the site ships.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p media/src

node -e '
const m = require("./scripts/media.json");
for (const [key, s] of Object.entries({...m.stills, ...m.films})) {
  if (key.startsWith("_") || !s.file) continue;
  const ext = s.file.split(".").pop();
  console.log(`${key}.${ext} ${m.cdn}/${s.file}`);
}' | while read -r name url; do
  if [[ -s "media/src/$name" ]]; then
    echo "skip  $name"
    continue
  fi
  echo "fetch $name"
  curl -sS -f --retry 3 -o "media/src/$name.part" "$url"
  mv "media/src/$name.part" "media/src/$name"
done
ls -la media/src
