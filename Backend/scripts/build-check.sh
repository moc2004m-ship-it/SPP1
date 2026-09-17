#!/usr/bin/env bash
# Stage 1 CI "build" step for a plain (non-bundled) Node backend.
#
# There is no transpiler/bundler in this project — the closest real
# equivalent of a "build" is verifying that every source file is at
# least syntactically valid and that the entrypoint can be required
# without throwing. This is intentionally NOT a fake "build successful"
# echo: it fails (non-zero exit) the moment any file fails to parse or
# the entrypoint throws on require.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== Stage 1 build check: syntax-checking all source files =="
status=0
while IFS= read -r -d '' file; do
  if ! node --check "$file"; then
    echo "SYNTAX ERROR: $file"
    status=1
  fi
done < <(find src -name '*.js' -print0)

if [ "$status" -ne 0 ]; then
  echo "Build FAILED: one or more source files have syntax errors."
  exit 1
fi

echo "== Stage 1 build check: verifying entrypoint loads =="
# NODE_ENV=development on purpose: production/staging require a live
# Postgres (STAGE3_ENABLE_POSTGRES=true + DATABASE_URL), which this build
# step must not depend on. The load check only verifies that every
# module wires together without throwing; it does not start the server
# (require.main !== module keeps app.listen() from being called).
NODE_ENV=development node -e "require('./src/index.js'); console.log('entrypoint loaded OK');"

echo "Build check PASSED."
