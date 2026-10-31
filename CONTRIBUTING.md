# Contributing

Thanks for helping improve GTFS Manager. Bug reports, feed compatibility issues, translations and
pull requests are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Be respectful. This project follows the
  [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/), version 2.1.

## Development setup

```bash
nvm use                 # Node.js 24 (see .nvmrc); 22 or later works
npm ci
cp env.example .env.local
npm run db:migrate
npm run dev
```

You need a PostgreSQL database; set `DATABASE_URL` in `.env.local`.

## Conventions

- **Language.** Code, comments, commit messages, issues and pull requests are in English.
  User-facing text lives in `src/locales/*.json` and must exist in all nine locales
  (`npm run i18n:check`).
- **Formatting and linting.** Prettier decides formatting (2 spaces, single quotes, semicolons,
  100 columns) and ESLint must pass with zero warnings. The pre-commit hook runs both on staged
  files.
- **Imports.** Use the `@/*` (→ `src/*`) and `@shared/*` (→ `shared/*`) aliases instead of deep
  relative paths. Client code must not import `src/server/` at runtime.
- **Contracts.** GTFS files and fields come from `shared/gtfs-spec.ts`; request and response types
  shared by client and server go in `shared/`.
- **Database.** Change `src/server/db/schema.ts`, then `npm run db:generate`; don't hand-write
  migration SQL.
- **Animation.** Import from `motion/react`, never `framer-motion`.
- **Tests.** Vitest and Testing Library, co-located as `*.test.ts(x)`. Add a test for every bug
  fix and for validation or import logic.

## Pull requests

Before opening a pull request, run:

```bash
npm run type-check
npm run lint
npm run format:check
npm run test -- --run
npm run i18n:check
npm run build
```

Keep pull requests focused on one change and describe what it does and how you tested it. Use
[Conventional Commits](https://www.conventionalcommits.org/) for commit messages
(`feat: …`, `fix: …`, `docs: …`).

## Adding a feed to the catalog

Catalog entries live in `shared/catalog.ts`. A feed qualifies when it is openly licensed,
downloadable over HTTPS without a key, and has current service. Use the operator's own name and
region. Logos must come from Wikimedia Commons with a public domain or CC0 licence.
