#!/usr/bin/env bash
# Fetches DirectML.dll for the installer into src-tauri/redist, straight from Microsoft's
# Microsoft.AI.DirectML NuGet package, and checks it is the exact file the app was tested with.
# Its licence (in src-tauri/licenses) allows shipping it inside Windows applications.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=1.15.4
SHA256=9c9e6d822561c6c41b90e6994b3e8857cf1d66dbfb1e0c4c799c7c89b4e92da1
out=src-tauri/redist
mkdir -p "$out"
if [ -f "$out/DirectML.dll" ] && echo "$SHA256  $out/DirectML.dll" | sha256sum -c --status; then
  echo "DirectML.dll $VERSION already present"
  exit 0
fi
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/dml.nupkg" "https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/$VERSION/microsoft.ai.directml.$VERSION.nupkg"
unzip -q -o "$tmp/dml.nupkg" bin/x64-win/DirectML.dll -d "$tmp"
echo "$SHA256  $tmp/bin/x64-win/DirectML.dll" | sha256sum -c --status || { echo "DirectML.dll checksum mismatch" >&2; exit 1; }
cp "$tmp/bin/x64-win/DirectML.dll" "$out/DirectML.dll"
echo "DirectML.dll $VERSION -> $out"
