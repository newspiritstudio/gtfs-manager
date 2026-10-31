# Deployment

GTFS Manager runs at <https://gtfs.newspirit.studio> on New Spirit Studio's Hetzner server, as its
own compose stack in `/opt/gtfs-manager`. `gtfsmanager.newspirit.studio` redirects there.

The server is short of memory and compiles nothing: the bundle is built on a workstation and
uploaded ready to run.

## Pieces

| File | What it does |
| --- | --- |
| `build.sh` | Exports `HEAD`, installs the locked dependencies, runs `next build` (standalone) and assembles `deploy/.build`. |
| `Dockerfile.runtime` | Runtime image: copies `.build` onto `node:24-slim`; runs the migrations, then the server. |
| `migrate.mjs` | Applies the Drizzle migrations at start-up. |
| `docker-compose.vps.yml` | The stack: `gtfs-manager` and `gtfs-postgres`, networks `gtfs-net` (shared with Caddy) and `gtfs-db` (internal). |
| `deploy.sh` | Uploads `.build`, the compose file and `backup.sh`, keeps the previous build as `build.prev` and recreates the app. |
| `backup.sh` | Nightly `pg_dump`, encrypted with age, kept 7 days in `/opt/gtfs-manager/backups`. |
| `Caddyfile.gtfs` | The proxy block. The live copy, with the real password hash, is in the server's Caddyfile. |

## Deploy

Commit first: the build uses `HEAD`.

```bash
deploy/build.sh
deploy/deploy.sh
curl -fsS https://gtfs.newspirit.studio/robots.txt
```

To roll back, swap `build` and `build.prev` in `/opt/gtfs-manager` and run
`sudo docker compose build && sudo docker compose up -d` there. Migrations only move forward.

## Access

Reading is public. Every change goes through `/api/*` with a method other than GET or HEAD, and
the proxy asks for HTTP Basic credentials there (user `editor`). To change the password, run
`docker exec agora-caddy caddy hash-password` and put the hash in the server's Caddyfile. Then
reload Caddy.

The server's Caddyfile is a bind mount of a single file. If a release replaces that file instead
of editing it in place, the container keeps the old copy, and `caddy reload` reports "config is
unchanged". Recreate the Caddy container to fix it.

## Backups

Root's cron runs `backup.sh` at 04:40. At 05:15 Àgora's `backup-offsite.sh` uploads the dump to
object storage, as service `gtfs-manager`. The service must be listed in the Àgora instance's
`BACKUP_HOST_SOURCES`.

Restore:

```bash
age -d -i <key> gtfs-….dump.age | docker exec -i gtfs-postgres pg_restore -U gtfs -d gtfs_manager --clean --if-exists
```

## First install

1. DNS: A records `gtfs` and `gtfsmanager` pointing to the server.
2. `/opt/gtfs-manager/.env` (root, 600), containing `DB_PASSWORD=…`. Keep a copy in the password
   manager.
3. Bring the stack up with `deploy/build.sh` and `deploy/deploy.sh`.
4. Load the database, if you are moving it: `pg_dump -Fc` the source, then `pg_restore` it into
   `gtfs-postgres`.
5. Proxy:
   - add the `Caddyfile.gtfs` block (with a real hash) to the server's Caddyfile;
   - add `gtfs-net` to Caddy's networks;
   - reload Caddy, or recreate it.
6. Cron: add both backup lines.
