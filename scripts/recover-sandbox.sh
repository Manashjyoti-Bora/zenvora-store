#!/usr/bin/env bash
# Sandbox recovery — restores local dev environment after a sandbox reset. Idempotent.
set -euo pipefail
cd /home/user/resellix

echo "== 1/6 node_modules =="
[ -x node_modules/.bin/prisma ] || npm install --no-audit --no-fund 2>&1 | tail -1

echo "== 2/6 postgresql =="
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq >/dev/null 2>&1 || true
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/dev/null 2>&1
fi

echo "== 3/6 cluster =="
sudo pg_ctlcluster 17 main start 2>/dev/null || true
for i in $(seq 1 15); do pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break; sleep 1; done
pg_isready -h 127.0.0.1 -p 5432

echo "== 4/6 role + databases =="
# Extract dev password from .env (bash parameter expansion — sed keeps unmatched prefixes!)
LINE=$(grep -E "^DATABASE_URL=" .env); TMP=${LINE#*://app:}; PW=${TMP%%@*}
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app LOGIN PASSWORD '$PW' CREATEDB; ELSE ALTER ROLE app WITH LOGIN PASSWORD '$PW' CREATEDB; END IF; END \$\$;" >/dev/null
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='resellix'" | grep -q 1 || sudo -u postgres createdb -O app resellix
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='resellix_test'" | grep -q 1 || sudo -u postgres createdb -O app resellix_test

echo "== 5/6 prisma generate + migrations (dev, then test via .env swap) =="
./node_modules/.bin/prisma generate >/dev/null 2>&1
./node_modules/.bin/prisma migrate deploy 2>&1 | tail -1
# NOTE: prisma CLI prefers .env over shell env, and migrate uses directUrl (DIRECT_URL).
# Target the test DB by temporarily swapping both lines.
cp .env .env.keep
TURL=$(grep -E "^TEST_DATABASE_URL=" .env | cut -d= -f2-)
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${TURL}|" .env
sed -i "s|^DIRECT_URL=.*|DIRECT_URL=${TURL}|" .env
./node_modules/.bin/prisma migrate deploy 2>&1 | tail -1

echo "== 6/6 seeds (test first while swapped, then dev after restore) =="
# tsx directly: `prisma db seed` spawns bare `tsx` which is not on PATH.
./node_modules/.bin/tsx --env-file=.env prisma/seed.ts >/dev/null 2>&1 || echo "test seed FAILED"
cp .env.keep .env && rm .env.keep
./node_modules/.bin/prisma migrate deploy 2>&1 | tail -1
./node_modules/.bin/tsx --env-file=.env prisma/seed.ts >/dev/null 2>&1 || echo "dev seed FAILED"

echo "RECOVERY COMPLETE"
