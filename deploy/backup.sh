#!/usr/bin/env bash
# GTFS Manager — daily encrypted copy of the database: pg_dump, encrypted with the age keys of
# Àgora's backups (root cron):
#
#   /opt/gtfs-manager/backup.sh
#
# Restore: age -d -i <key> gtfs-….dump.age | docker exec -i gtfs-postgres pg_restore -U gtfs -d gtfs_manager --clean --if-exists
set -euo pipefail
umask 077
RECIPIENTS="${GTFS_AGE_RECIPIENTS:-/opt/agora-app/deployments/agora-newspiritstudio/backup-age-recipients.txt}"
OUT="${GTFS_BACKUP_DIR:-/opt/gtfs-manager/backups}"
KEEP_DAYS="${GTFS_KEEP_DAYS:-7}"

log() { printf '%s [gtfs-manager] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
[ -f "$RECIPIENTS" ] || { log "!! Without $RECIPIENTS there is no copy: it is never stored in clear." >&2; exit 1; }

mkdir -p "$OUT"
chmod 700 "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$OUT/.gtfs-$STAMP.tmp"
trap 'rm -f "$TMP"' EXIT

docker exec gtfs-postgres pg_dump -U gtfs -d gtfs_manager -Fc | age -R "$RECIPIENTS" -o "$TMP"
mv "$TMP" "$OUT/gtfs-$STAMP.dump.age"
log "Done: $OUT/gtfs-$STAMP.dump.age ($(du -h "$OUT/gtfs-$STAMP.dump.age" | cut -f1))"

find "$OUT" -maxdepth 1 -name 'gtfs-*.dump.age' -mtime "+${KEEP_DAYS}" -delete
