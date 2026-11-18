#!/usr/bin/env bash
# Build an LGPL FFmpeg (ffmpeg + ffprobe) for macOS from the official source tarball into OUT.
# Decoders and the AAC / MJPEG encoders the app needs are FFmpeg's own; hardware decode via VideoToolbox.
# No GPL or nonfree parts (no x264/x265/fdk-aac).          usage: scripts/build-ffmpeg-macos.sh OUT
set -euo pipefail
OUT="$(cd "$(dirname "${1:?usage: $0 OUT}")" && pwd)/$(basename "$1")"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VER="${FFMPEG_VERSION:-$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['ffmpeg']['sourceVersion'])" "$HERE/../runtime.config.json")}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
curl -fsSL -o src.tar.xz "https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz"
SHA="$(shasum -a 256 src.tar.xz | cut -d' ' -f1)"
tar -xf src.tar.xz
cd "ffmpeg-$VER"
CONF=(--prefix="$WORK/prefix" --disable-gpl --disable-nonfree --disable-doc --disable-ffplay --disable-network
  --disable-autodetect --enable-pthreads --enable-zlib --enable-audiotoolbox --enable-videotoolbox
  --disable-debug --enable-static --disable-shared --cc=clang)
./configure "${CONF[@]}"
make -j"$(sysctl -n hw.ncpu)"
make install
rm -rf "$OUT"
mkdir -p "$OUT/bin"
cp "$WORK/prefix/bin/ffmpeg" "$WORK/prefix/bin/ffprobe" "$OUT/bin/"
cp COPYING.LGPLv2.1 "$OUT/LICENSE.txt"
cat > "$OUT/SOURCE.txt" <<TXT
FFmpeg $VER, LGPL-2.1-or-later build (no GPL or nonfree components), built from source.
Source: https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz
SHA-256 of the source: $SHA
configure ${CONF[*]}
TXT
"$OUT/bin/ffmpeg" -hide_banner -version | head -1
