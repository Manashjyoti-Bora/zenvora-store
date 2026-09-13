#!/usr/bin/env bash
# Export every KEY=VALUE line of .env.test (values may contain spaces) and
# then exec the given command. Used to run the E2E dev server and the test-DB
# seeder with exactly the environment the E2E specs expect.
set -euo pipefail
cd "$(dirname "$0")/.."
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  key="${line%%=*}"
  val="${line#*=}"
  case "$key" in *[!A-Z0-9_]*|'') continue ;; esac
  export "$key=$val"
done < .env.test
exec "$@"
