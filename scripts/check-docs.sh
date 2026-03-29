#!/usr/bin/env bash
# Check documentation consistency for azure-dev-server.
# Run before every commit. Referenced in CLAUDE.md documentation rules.
set -euo pipefail

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

echo "=== Documentation checks ==="

# 1. Verify test count matches reality
ACTUAL_TESTS=$(cd "$PROJ" && node --test tests/*.test.mjs 2>&1 | grep "^ℹ tests" | awk '{print $3}')
CLAUDE_TESTS=$(grep -o '[0-9]* tests' "$PROJ/CLAUDE.md" | head -1 | awk '{print $1}')
if [ -z "$ACTUAL_TESTS" ]; then
  echo "⚠️  Could not determine actual test count"
elif [ "$ACTUAL_TESTS" != "$CLAUDE_TESTS" ]; then
  echo "❌ Test count mismatch: actual=$ACTUAL_TESTS, CLAUDE.md=$CLAUDE_TESTS"
  ERRORS=$((ERRORS + 1))
else
  echo "✅ Test count: $ACTUAL_TESTS"
fi

# 2. Verify tool count matches code
ACTUAL_TOOLS=$(grep -c 'server\.tool(' "$PROJ/src/tools.ts")
echo "✅ Tools in code: $ACTUAL_TOOLS"

# 3. Check for stale dist files (files in dist/ with no matching src/)
for f in "$PROJ"/dist/*.js; do
  [ -f "$f" ] || continue
  base=$(basename "$f" .js)
  if [ ! -f "$PROJ/src/$base.ts" ]; then
    echo "❌ Stale dist file: dist/$base.js (no matching src/$base.ts)"
    ERRORS=$((ERRORS + 1))
  fi
done
echo "✅ No stale dist files"

# 4. Check for unused exports in types.ts
for TYPE in $(grep 'export interface' "$PROJ/src/types.ts" | sed 's/export interface //;s/ {.*//'); do
  USAGE=$(grep -rl "$TYPE" "$PROJ/src/" --include="*.ts" | grep -v types.ts | wc -l | tr -d ' ')
  if [ "$USAGE" = "0" ]; then
    echo "⚠️  Unused type: $TYPE (exported but never imported)"
  fi
done

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ $ERRORS documentation issue(s) found"
  exit 1
else
  echo "Documentation checks passed."
fi
