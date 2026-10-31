# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub security advisories](https://github.com/newspiritstudio/gtfs-manager/security/advisories/new).

Include a description of the issue, the steps to reproduce it and the affected version or commit.
We aim to acknowledge reports within five working days and to keep you informed until a fix is
released.

## Supported versions

Only the latest version on the `main` branch receives security fixes.

## Deployment notes

GTFS Manager is a static site with no server-side code and no accounts. Each visitor's feeds are
stored in their own browser (the origin private file system) and are only sent anywhere when they
export them. Anyone who can open the site can use it, but no one can see another visitor's data.

The browser downloads catalog feeds and GTFS Realtime URLs directly from their publishers, so those
requests come from the visitor's computer and are subject to the browser's own cross-origin rules.
