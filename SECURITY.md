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

GTFS Manager does not include user accounts yet: anyone who can reach an instance can import,
edit and delete feeds. Do not expose an instance with data you care about to the public internet
without putting authentication in front of it (for example, a reverse proxy with access control).

The server downloads the GTFS Realtime URLs set on each feed. It only follows `https` URLs whose
host, and every redirect target, resolves to public addresses, caps each body at 20 MB and times
out after 10 seconds. The address check happens before the request, so a host that changes its DNS
answer between the two (DNS rebinding) is not covered: if the instance can reach sensitive internal
services, restrict its outbound traffic at the network level as well.
