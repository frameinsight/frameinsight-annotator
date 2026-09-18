#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .frameinsight/windows-build/wheels
docker image inspect frameinsight-windows-builder:1 >/dev/null 2>&1 || docker build -t frameinsight-windows-builder:1 packaging/windows
.venv/bin/python -m pip download --only-binary=:all: --platform win_amd64 --python-version 3.13 --implementation cp --abi cp313 -d .frameinsight/windows-build/wheels -r packaging/windows/requirements.txt
npm --prefix frontend run build
.venv/bin/python packaging/windows/prepare.py
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/.frameinsight/windows-build:/build" frameinsight-windows-builder:1 sh -c 'x86_64-w64-mingw32-windres launcher.rc launcher-res.o && x86_64-w64-mingw32-gcc -municode -mwindows -O2 -s -static-libgcc launcher.c launcher-res.o -o payload/Frameinsight.exe -lshell32 -lole32 && makensis -V2 installer.nsi'
mkdir -p deliverables/windows
cp .frameinsight/windows-build/output/Frameinsight-Setup-1.2.1-win64.exe deliverables/windows/
cp .frameinsight/windows-build/payload/START-HERE.txt deliverables/windows/
sha256sum deliverables/windows/*.exe > deliverables/windows/SHA256SUMS.txt
