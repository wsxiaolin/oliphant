#!/usr/bin/env bash
# examples/demo.sh — the 60-second oliphant tour. Run anywhere safe (uses a temp dir).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OLI="${OLIPHANT_BIN:-node $SCRIPT_DIR/../bin/oliphant.js}"
DEMO="$(mktemp -d)"
trap 'rm -rf "$DEMO"' EXIT

cd "$DEMO"
git init -q 2>/dev/null || true
mkdir -p src
cat > src/auth.js <<'EOF'
import { createHmac } from 'node:crypto';
export const proof = (body, key) => createHmac('sha256', key).update(body).digest('hex');
EOF
cat > package.json <<'EOF'
{ "name": "demo", "scripts": { "test": "node --test" } }
EOF

echo '══════════ 1 · init ══════════'
$OLI init

echo
echo '══════════ 2 · remember (with receipts) ══════════'
$OLI remember "auth proofs are HMAC-SHA256, plaintext answers are never stored" \
  --kind decision --tag auth --tag security \
  --evidence path:src/auth.js --evidence "grep:createHmac@src"

$OLI remember "CI runs node --test before any merge" \
  --kind fact --tag workflow --evidence "command:npm test"

echo
echo '══════════ 3 · compile → every agent file ══════════'
$OLI compile
echo
echo "--- AGENTS.md (excerpt) ---"
sed -n '/OLIPHANT:BEGIN/,/OLIPHANT:END/p' AGENTS.md

echo
echo '══════════ 4 · recall ══════════'
$OLI recall "how does auth work?"

echo
echo '══════════ 5 · doctor (memory that lies, dies) ══════════'
cat > src/login.js <<'EOF'
export const login = () => true; // "temporary" — famous last words
EOF
$OLI remember "legacy login lives in src/login.js" --kind fact --tag auth --evidence path:src/login.js
echo "…time passes. reality changes. src/login.js gets deleted…"
rm src/login.js
echo
$OLI doctor --skip-commands
echo
echo "the lie is dead. retire it:"
LIE=$($OLI ls | grep 'login.js' | awk '{print $2}')
$OLI forget "$LIE" "file was deleted"
echo
$OLI doctor --skip-commands --ci && echo "✓ CI green — memory is honest again"

echo
echo '══════════ 6 · stats ══════════'
$OLI stats
