#!/usr/bin/env bash
# Fetch chomp at pre-quests commit and transpile Solidity engine to TypeScript.
# Output goes to replay/engine/ (gitignored). Re-run after any engine update.
set -euo pipefail

PINNED_COMMIT="a3a701de8a059d6284c3dc71bb0a521bf1a41b93"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${ROOT}/.chomp-tmp"
OUT="${ROOT}/engine"

rm -rf "$TMP" "$OUT"
git clone --quiet https://github.com/stompgg/chomp.git "$TMP"
( cd "$TMP" && git checkout --quiet "$PINNED_COMMIT" )

# Use latest transpiler on pinned src (transpiler in main has more complete output).
git clone --quiet --depth 1 https://github.com/stompgg/chomp.git "${TMP}-tx"
cp -r "${TMP}-tx/transpiler" "${TMP}/transpiler-main"
( cd "$TMP" && python3 -m transpiler-main src/ -o "$OUT" -d src --emit-metadata )

# Restore one file the main transpiler doesn't emit but factories.ts references.
if [ -f "${TMP}-tx/transpiler/.." ] && [ ! -f "$OUT/rng/IGachaRNG.ts" ]; then
  # Re-emit using pre-quests transpiler just to grab this stub.
  python3 -m transpiler "${TMP}/src/rng/" -o "${OUT}.tmp" -d "${TMP}/src" 2>/dev/null || true
  if [ -f "${OUT}.tmp/IGachaRNG.ts" ]; then
    cp "${OUT}.tmp/IGachaRNG.ts" "$OUT/rng/"
  fi
  rm -rf "${OUT}.tmp"
fi

# Replay-license file marker (engine is AGPL-3.0 from upstream chomp transpiler runtime).
cat > "${OUT}/AGPL-NOTICE.md" <<'NOTE'
This directory contains TypeScript transpiled from stompgg/chomp at commit
a3a701de8a059d6284c3dc71bb0a521bf1a41b93. The transpiler (extruder) is licensed
AGPL-3.0. If you distribute this engine output as part of a hosted service, the
combined work falls under AGPL-3.0 obligations. Do not commit this directory —
it is gitignored on purpose. Re-run scripts/fetch-and-transpile-engine.sh.
NOTE

rm -rf "$TMP" "${TMP}-tx"
echo "engine ready at: $OUT"
