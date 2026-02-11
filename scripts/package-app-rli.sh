#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

mkdir -p artifacts

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

cp -R "${ROOT_DIR}/dist" "${TMP_DIR}/dist"
cp "${ROOT_DIR}/index.js" "${TMP_DIR}/index.js"
cp "${ROOT_DIR}/package.json" "${TMP_DIR}/package.json"

pushd "${TMP_DIR}" >/dev/null

# Builds a Rocketlane-verified zip as app.zip
npx -y @rocketlane/rli build >/dev/null

popd >/dev/null

OUT_ZIP="artifacts/rocketlane-bulletin-board-app.rli.zip"
rm -f "${OUT_ZIP}"
mv "${TMP_DIR}/app.zip" "${OUT_ZIP}"

echo "Created ${OUT_ZIP}"
