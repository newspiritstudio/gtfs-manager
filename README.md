# GTFS Manager

Aplicació web per crear, editar i visualitzar feeds [GTFS](https://gtfs.org/schedule/reference/)
(els horaris oberts del transport públic) de manera molt visual: mapa de la xarxa, esquema de cada
línia, horaris, diagrames de Marey, calendari de servei, validació i un editor de tots els fitxers.

Comparteix la tecnologia i l'aspecte de l'Àgora: Next.js (App Router), React, TypeScript,
Tailwind 4 amb els tokens de Material Design 3, `motion`, Leaflet, Drizzle ORM i PostgreSQL.

## Què fa

- **Importa** un ZIP o una carpeta GTFS (de cap a peu en streaming: feeds com Renfe Cercanías, amb
  milions d'hores de pas) o **crea un feed en blanc**.
- **Catàleg de GTFS públics** (`/catalog`): feeds oberts d'operadors reals amb servei vigent (FGC,
  Renfe, AMB, Metro Bilbao, Euskotren, CRTM, BART, TriMet, STM...). Mostra quan es van publicar i
  els importa amb un clic; el servidor només baixa de les adreces del catàleg.
- **Explora**: resum amb xifres clau, mapa de la xarxa, galeria de línies, fitxa de línia (esquema,
  mapa, horari, Marey i calendari), parades amb sortides del dia, viatges i calendari de servei.
- **Edita** qualsevol fitxer GTFS amb validació de camps segons l'especificació.
- **Genera viatges** a partir d'una línia, unes parades i una freqüència.
- **Valida** el feed i l'**exporta** de nou com a ZIP GTFS (conserva les columnes extra).

## Posada en marxa

Requisits: Node 22 o superior (`.nvmrc` → 24), npm 10 i PostgreSQL.

```bash
npm ci
cp env.example .env.local        # i ajusta DATABASE_URL
npm run db:migrate
npm run dev                      # http://localhost:3000
```

Importar un feed des de la línia d'ordres:

```bash
npm run gtfs:import -- ~/Downloads/fomento_transit --name "Renfe Cercanías"
```

## Ordres

| Ordre                                     | Què fa                                    |
| ----------------------------------------- | ----------------------------------------- |
| `npm run dev`                             | Servidor de desenvolupament               |
| `npm run build` / `npm start`             | Build i servidor de producció             |
| `npm run type-check` / `lint` / `format`  | TypeScript, ESLint (zero avisos), Prettier |
| `npm run test -- --run`                   | Tests (Vitest)                            |
| `npm run i18n:check`                      | Textos complets en català, castellà i anglès |
| `npm run db:generate` / `db:migrate`      | Migracions de Drizzle                     |

## Estructura

```text
app/            Pàgines (App Router) i rutes /api
src/features/   Una carpeta per mòdul: overview, network, routes, stops, trips, calendar,
                validation, data, generator, feeds, catalog
src/components/ Peces compartides: closca, UI, mapes (Leaflet), gràfics, esquelets de càrrega
src/server/     Base de dades (Drizzle/Postgres) i lògica GTFS: importació, exportació,
                validació, xarxa, detalls, generador, catàleg
shared/         Contractes compartits: especificació GTFS, valors, catàleg, generador
src/locales/    ca.json, es.json, en.json (el català és la llengua de reserva)
```

## Isotips del catàleg

Els isotips de les marques (`public/catalog-logos/`) són fitxers vectorials de
[Wikimedia Commons](https://commons.wikimedia.org/) en domini públic o CC0; la pàgina del catàleg
enllaça la fitxa de cada un. Els de l'AMB i l'STM s'han retallat per deixar-ne només el símbol.
