#!/bin/bash
# Сборка установщика: dist/Polka-Setup-<версия>.exe (нужен собранный dist/win/Polka — см. build/pack-win.js)
# Нужен NSIS 3: makensis из PATH (например, пакет nsis) или из кэша electron-builder (~/.cache/electron-builder/nsis-3…)
set -e
cd "$(dirname "$0")"
N=$(ls -d ~/.cache/electron-builder/nsis-3*/nsis-3*/ 2>/dev/null | head -1 || true)
if [ -n "$N" ]; then MK="$N/linux/makensis"; export NSISDIR="$N"; else MK=makensis; fi
SRC=$(mktemp -d)
cp -r ../dist/win/Polka/. "$SRC"/
V=$(node -p "require('../electron/package.json').version")
"$MK" -INPUTCHARSET UTF8 -V2 -DVERSION="$V" -DSRC="$SRC" installer.nsi
rm -rf "$SRC"
echo "готово: dist/Polka-Setup-$V.exe"
