#!/usr/bin/env bash
# Builds the production bundle on this machine (the server is short of memory and compiles
# nothing): exports the committed HEAD to deploy/.work, installs the locked dependencies, runs
# `next build` and assembles deploy/.build, which deploy.sh uploads.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
# Outside the repository: inside it, Next would take the repository as the tracing root.
WORK="${TMPDIR:-/tmp}/gtfs-manager-build"
OUT="$ROOT/deploy/.build"
SITE_URL="${SITE_URL:-https://gtfs.newspirit.studio}"

[ -z "$(git status --porcelain -- . ':!deploy/.build')" ] ||
  echo "Note: uncommitted changes are not included; the build uses HEAD." >&2
REVISION="$(git rev-parse --short HEAD)"

rm -rf "$WORK" "$OUT"
mkdir -p "$WORK" "$OUT"
git archive --format=tar HEAD | tar -x -C "$WORK"

cd "$WORK"
# npm 12 cannot install this tree; pin the npm the project is tested with.
npx -y npm@10.9.2 ci --no-audit --no-fund --ignore-scripts
SITE_URL="$SITE_URL" NEXT_TELEMETRY_DISABLED=1 npx next build --webpack

# A native addon would be built for this machine, not the server: refuse it.
if find .next/standalone -name '*.node' | grep -q .; then
  echo "Native addons in the standalone output; build on linux/amd64 instead." >&2
  exit 1
fi

cp -R .next/standalone/. "$OUT/"
mkdir -p "$OUT/.next"
cp -R .next/static "$OUT/.next/static"
cp -R public "$OUT/public"

# Migrations run at start-up with the full drizzle-orm (the standalone trace only keeps what
# the app imports).
mkdir -p "$OUT/migrate/node_modules"
cp -R src/server/db/migrations "$OUT/migrate/migrations"
cp -R node_modules/drizzle-orm node_modules/postgres "$OUT/migrate/node_modules/"
cp deploy/migrate.mjs "$OUT/migrate/migrate.mjs"
cp deploy/Dockerfile.runtime "$OUT/Dockerfile"
echo "$REVISION" > "$OUT/REVISION"

echo "Built $REVISION in deploy/.build ($(du -sh "$OUT" | cut -f1))."
