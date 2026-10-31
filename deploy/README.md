# Deployment

GTFS Manager is a static site: `npm run build` writes everything to `dist/`, and any web server
that can serve files can host it. Nothing runs on the server, and there is no database there: each
visitor's feeds live in their own browser.

## Any static host

Serve `dist/` with two rules:

1. An address that is a file (`/assets/…`, `/robots.txt`) gets that file.
2. Otherwise, `<address>/index.html` if it exists (the prerendered public pages, such as
   `/fr/catalog/fgc/index.html`), and `/404.html` (the app itself) if it does not. The app routes
   the workspace (`/feeds/…`) in the browser.

GitHub Pages and Netlify follow these rules on their own. Set `VITE_SITE_URL` at build time to the
public URL (no trailing slash): it goes into the canonical URLs, the sitemap and the social cards.
The default is `https://gtfs.newspirit.studio`.

The database uses the browser's origin private file system with SQLite's "SAH pool" VFS, so the
host needs no special headers (no `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`).

## gtfs.newspirit.studio

The site runs on New Spirit Studio's Hetzner server, behind that server's Caddy (the
`agora-caddy` container). `gtfsmanager.newspirit.studio` redirects there.

| File             | What it does                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `deploy.sh`      | Builds the site here, uploads it as a new release to `/opt/gtfs-manager/site/releases/<revision>` and switches `current`.  |
| `Caddyfile.gtfs` | The Caddy block: the files of `current`, the rules above, cache and security headers. Copy it into the server's Caddyfile. |

```bash
deploy/deploy.sh            # build, upload, switch; checks that the site answers with the new revision
deploy/deploy.sh rollback   # back to the previous release (the last five are kept)
```

The server compiles nothing. Commit first: `deploy.sh` refuses a dirty working tree, and the
revision name carries the commit.

The Caddy container mounts `/opt/gtfs-manager/site` read-only as `/srv/gtfs-manager` (Àgora's
`compose.override.yml` for that instance). `current` is a relative symlink, so it resolves inside
the container too.

The server's Caddyfile is a bind mount of a single file. If something replaces that file instead
of editing it in place, the container keeps the old copy, and `caddy reload` reports "config is
unchanged". Recreate the Caddy container to fix it.
