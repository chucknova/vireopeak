#!/usr/bin/env bash
#
# Encode every .mp4 in ./raw into web-ready assets in ./web:
#   - <name>.mp4   compressed, muted, H.264 (crf 24) + faststart
#   - <name>.webm  muted VP9 fallback (crf 34)
#   - <name>.jpg   single-frame poster
#
set -euo pipefail

SRC_DIR="./raw"
OUT_DIR="./web"

command -v ffmpeg >/dev/null 2>&1 || { echo "error: ffmpeg not found on PATH" >&2; exit 1; }

if [[ ! -d "$SRC_DIR" ]]; then
  echo "error: source directory '$SRC_DIR' does not exist" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

shopt -s nullglob nocaseglob
files=("$SRC_DIR"/*.mp4)
shopt -u nocaseglob

if (( ${#files[@]} == 0 )); then
  echo "No .mp4 files found in $SRC_DIR"
  exit 0
fi

for src in "${files[@]}"; do
  base="$(basename "$src")"   # e.g. clip.mp4
  name="${base%.*}"           # e.g. clip

  mp4_out="$OUT_DIR/$name.mp4"
  webm_out="$OUT_DIR/$name.webm"
  jpg_out="$OUT_DIR/$name.jpg"

  echo "==> $base"

  # Compressed, muted H.264 + faststart
  ffmpeg -y -loglevel error -i "$src" \
    -an \
    -c:v libx264 -crf 24 -preset medium -pix_fmt yuv420p \
    -movflags +faststart \
    "$mp4_out"

  # Muted VP9 WebM fallback
  ffmpeg -y -loglevel error -i "$src" \
    -an \
    -c:v libvpx-vp9 -crf 34 -b:v 0 \
    "$webm_out"

  # Single-frame poster (first frame)
  ffmpeg -y -loglevel error -i "$src" \
    -frames:v 1 -q:v 2 \
    "$jpg_out"

  echo "    sizes:"
  du -h "$mp4_out" "$webm_out" "$jpg_out" | sed 's/^/      /'
done

echo
echo "Done. Output in $OUT_DIR"
