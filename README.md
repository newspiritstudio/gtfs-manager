# GTFS Manager

A web app to import, explore, edit, validate and export [GTFS Schedule](https://gtfs.org/documentation/schedule/reference/)
feeds, the open format public transport agencies use to publish their timetables. It is built to
be visual: a network map, a diagram of every line, timetables, Marey diagrams, the service
calendar, validation, and an editor for every file in the feed.

Built with Next.js (App Router), React, TypeScript, Tailwind CSS 4 with Material Design 3 tokens,
`motion`, Leaflet, Drizzle ORM and PostgreSQL. Made by [New Spirit Studio](https://newspirit.studio).

## Features

- **Import** a GTFS ZIP or folder. Import streams end to end, so feeds with millions of stop
  times (such as Renfe Cercanías) load fine. You can also **start a blank feed**.
- **Public feed catalog** (`/catalog`): 68 open feeds with current service from 20 countries in
  Europe, the Americas, Oceania and Israel, sorted by name and filterable by country. It shows when
  each feed was last published and imports it in one click; the server only downloads from the
  URLs in the catalog.
- **Explore**: an overview with key figures, the network map, a line gallery, a page per line
  (diagram, map, timetable, Marey diagram and calendar), stops with their departures for the day,
  trips, and the service calendar.
- **Edit** any GTFS file, with field validation based on the specification.
- **Generate trips** from a line, a list of stops and a frequency.
- **Validate** the feed and **export** it back as a GTFS ZIP (extra columns are kept).

## Languages and SEO

The interface is available in Catalan, Spanish, English, French, German, Italian, Portuguese,
Chinese (Simplified) and Japanese. Strings live in `src/locales/`; `npm run i18n:check` checks
that every locale has every key and the same variables. Catalan is the fallback locale.

Public pages (home, catalog, and one page per catalog entry) have one URL per language. English is
unprefixed (`/catalog`) and the rest are prefixed (`/ca/catalog`, `/ja/catalog/fgc`). Every page
has a canonical URL, `hreflang` alternates, Open Graph tags and schema.org structured data, and is
listed in `/sitemap.xml`. The workspace (`/feeds`, `/new`) is `noindex`. `SITE_URL` sets the public
origin (default: https://gtfs.newspirit.studio).

## Getting started

Requirements: Node.js 22 or later (`.nvmrc` pins 24), npm 10 and PostgreSQL.

```bash
npm ci
cp env.example .env.local        # then set DATABASE_URL
npm run db:migrate
npm run dev                      # http://localhost:3000 (the editor is at /feeds)
```

Import a feed from the command line:

```bash
npm run gtfs:import -- ~/Downloads/fomento_transit --name "Renfe Cercanías"
npm run gtfs:import -- fgc.zip --catalog fgc    # link it to a catalog entry
```

## Scripts

| Command                                  | What it does                                    |
| ---------------------------------------- | ----------------------------------------------- |
| `npm run dev`                            | Development server                              |
| `npm run build` / `npm start`            | Production build and server                     |
| `npm run type-check` / `lint` / `format` | TypeScript, ESLint (zero warnings), Prettier    |
| `npm run test -- --run`                  | Unit tests (Vitest)                             |
| `npm run i18n:check`                     | Complete strings and variables in all 9 locales |
| `npm run db:generate` / `db:migrate`     | Drizzle migrations                              |
| `npm run gtfs:import`                    | Import a GTFS folder or ZIP                     |
| `npm run landing:network`                | Regenerate the home page animation data         |

## Project structure

```text
app/            Pages (App Router) and /api route handlers
src/features/   One folder per area: overview, network, routes, stops, trips, calendar,
                validation, data, generator, feeds, catalog, landing
src/components/ Shared pieces: app shell, UI primitives, maps (Leaflet), charts, loading skeletons
src/server/     Database (Drizzle/Postgres) and GTFS logic: import, export, validation,
                network, details, trip generator, catalog
shared/         Contracts shared by client and server: GTFS spec, values, catalog, generator
src/locales/    One JSON file per language
```

`shared/gtfs-spec.ts` is the single source of truth for the GTFS files and fields the app
understands: import, export, validation, the generic editor and the database schema all derive
from it.

## Home page animation

Each visit shows one of the networks in `src/features/landing/networks.ts`, picked at random (FGC,
New York City Subway, Milan, Toulouse, Metrovalencia, BART and LA Metro Rail), with the real trains
of a weekday between 7 and 10 am and a caption that explains what you are looking at. The data in
`public/landing-networks/` comes from each operator's open GTFS feed. To regenerate it, import each
feed from the catalog (or with `npm run gtfs:import -- feed.zip --catalog <id>`) and run
`npm run landing:network` (or `npm run landing:network -- fgc bart` for some of them). The day used
is the Tuesday, Wednesday or Thursday with the most trips in the next four weeks.

## Credits

- Catalog logos (`public/catalog-logos/`) are vector files from
  [Wikimedia Commons](https://commons.wikimedia.org/) in the public domain or under CC0; each
  catalog page links to the file's page. The AMB, STM and TFI files were cropped to the symbol.
- Country flags (`public/flags/`) are from [circle-flags](https://github.com/HatScripts/circle-flags)
  v2.8.0 (MIT).
- Feed data belongs to each operator and is used under its open data licence.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

Copyright © 2026 New Spirit Studio S.L.

GTFS Manager is free software: you can redistribute it and/or modify it under the terms of the
[GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version. If you run a modified version as a
network service, you must offer its source code to its users.
