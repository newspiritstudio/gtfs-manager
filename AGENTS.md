# Agent notes

Read [README.md](README.md) (architecture and project structure) and
[CONTRIBUTING.md](CONTRIBUTING.md) (conventions and checks) before changing code.

- The app is a static site. There is no server: never add one, nor code that assumes one.
- Data work runs in the Web Worker under `src/engine/`; the page calls it through
  `src/lib/engine.ts`.
- Run `npm run type-check`, `npm run lint`, `npm run test -- --run`, `npm run i18n:check` and
  `npm run build` before you finish.
