#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
build_dir="$PWD/.frameinsight/debian-build"
mkdir -p "$build_dir/context/requirements/debian" "$build_dir/context/requirements/windows"
cp packaging/debian/Dockerfile "$build_dir/context/Dockerfile"
cp packaging/debian/requirements-build.txt "$build_dir/context/requirements/debian/"
cp packaging/windows/requirements.txt "$build_dir/context/requirements/windows/"
docker build --platform linux/amd64 -t frameinsight-debian-builder:3 "$build_dir/context"
if [[ "${1:-}" != "--skip-frontend" ]]; then npm --prefix frontend run build; fi
docker run --rm --platform linux/amd64 -u "$(id -u):$(id -g)" \
  -e FRAMEINSIGHT_BUILD_COMMIT="$(git rev-parse HEAD)" \
  -e FRAMEINSIGHT_BUILD_DIRTY="$(if [[ -n "$(git status --porcelain --untracked-files=all -- backend frontend packaging)" ]]; then echo true; else echo false; fi)" \
  -v "$PWD:/src:ro" -v "$build_dir:/build" \
  frameinsight-debian-builder:3 python /src/packaging/debian/prepare.py --output /build
if [[ "${FRAMEINSIGHT_STAGE_ONLY:-}" == 1 ]]; then exit 0; fi
mkdir -p deliverables/linux
app_version=$(node -p "require('./frontend/package.json').version")
find deliverables/linux -maxdepth 1 -type f -name 'frameinsight_*_amd64.deb' -delete
cp "$build_dir/frameinsight_${app_version}_amd64.deb" deliverables/linux/
cp packaging/debian/START-HERE.txt docs/LINUX.md deliverables/linux/
sha256sum deliverables/linux/*.deb > deliverables/linux/SHA256SUMS.txt
