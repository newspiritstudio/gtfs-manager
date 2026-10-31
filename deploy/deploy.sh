#!/usr/bin/env bash
# Builds the site here and publishes it on the server as a new release:
#
#   deploy/deploy.sh            # build, upload, switch
#   deploy/deploy.sh rollback   # point `current` back at the previous release
#
# Releases live in /opt/gtfs-manager/site/releases/<revision>; `current` is a relative symlink,
# so the switch is atomic and the last five releases stay for a rollback.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${GTFS_HOST:-agora-vps}"
SITE=/opt/gtfs-manager/site

if [ "${1:-}" = rollback ]; then
  ssh "$HOST" "set -e; cd $SITE
    previous=\$(ls -1 releases | sort | tail -n 2 | head -n 1)
    current=\$(basename \"\$(readlink current)\")
    [ \"\$previous\" != \"\$current\" ] || { echo 'No previous release' >&2; exit 1; }
    sudo ln -sfn \"releases/\$previous\" current.new && sudo mv -T current.new current
    echo \"Now serving \$previous\""
  exit 0
fi

[ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first" >&2; exit 1; }
REVISION="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
npm run build
echo "$REVISION" > dist/REVISION

tar -czf - -C dist . | ssh "$HOST" "set -e
  sudo mkdir -p $SITE/releases/$REVISION
  sudo tar -xzf - -C $SITE/releases/$REVISION
  test -f $SITE/releases/$REVISION/404.html
  cd $SITE
  sudo ln -sfn releases/$REVISION current.new && sudo mv -T current.new current
  ls -1 releases | sort | head -n -5 | xargs -r -I{} sudo rm -rf releases/{}
  echo \"Now serving \$(cat current/REVISION)\""

curl -fsS "https://gtfs.newspirit.studio/REVISION?$(date +%s)" | grep -qx "$REVISION" \
  && echo "Live: $REVISION" || { echo "The site does not answer with $REVISION yet" >&2; exit 1; }
