#!/usr/bin/env bash
# Uploads deploy/.build (made by build.sh), the compose file and the backup script to
# /opt/gtfs-manager and recreates the app. /opt/gtfs-manager/.env (DB_PASSWORD) must already be
# there: see deploy/README.md.
set -euo pipefail
cd "$(dirname "$0")"
HOST="${GTFS_HOST:-agora-vps}"
[ -f .build/server.js ] || { echo "Run deploy/build.sh first" >&2; exit 1; }

ssh "$HOST" 'sudo test -f /opt/gtfs-manager/.env' || { echo "/opt/gtfs-manager/.env is missing" >&2; exit 1; }
tar -czf - -C .build . | ssh "$HOST" 'sudo rm -rf /opt/gtfs-manager/build.new && sudo mkdir -p /opt/gtfs-manager/build.new && sudo tar -xzf - -C /opt/gtfs-manager/build.new'
ssh "$HOST" 'sudo tee /opt/gtfs-manager/docker-compose.yml >/dev/null' < docker-compose.vps.yml
ssh "$HOST" 'sudo tee /opt/gtfs-manager/backup.sh >/dev/null && sudo chmod 700 /opt/gtfs-manager/backup.sh' < backup.sh
ssh "$HOST" 'set -e
  cd /opt/gtfs-manager
  test -f build.new/REVISION
  sudo rm -rf build.prev; [ -d build ] && sudo mv build build.prev; sudo mv build.new build
  sudo docker compose build
  sudo docker compose up -d
  echo "Revision: $(cat build/REVISION)"'
