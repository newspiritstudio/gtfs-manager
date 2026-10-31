# GTFS Manager

Aplicació web per crear, editar i visualitzar feeds [GTFS](https://gtfs.org/schedule/reference/)
(els horaris oberts del transport públic) de manera molt visual: mapa de la xarxa, esquema de cada
línia, horaris, diagrames de Marey, calendari de servei, validació i un editor de tots els fitxers.

Comparteix la tecnologia i l'aspecte de l'Àgora: Next.js (App Router), React, TypeScript,
Tailwind 4 amb els tokens de Material Design 3, `motion`, Leaflet, Drizzle ORM i PostgreSQL.

## Què fa

- **Importa** un ZIP o una carpeta GTFS (de cap a peu en streaming: feeds com Renfe Cercanías, amb
  milions d'hores de pas) o **crea un feed en blanc**.
- **Catàleg de GTFS públics** (`/catalog`): 68 feeds oberts d'operadors d'Europa, Amèrica,
  Oceania i Israel amb servei vigent, ordenats per nom i filtrables per país. Mostra quan es van
  publicar i els importa amb un clic; el servidor només baixa de les adreces del catàleg.
- **Explora**: resum amb xifres clau, mapa de la xarxa, galeria de línies, fitxa de línia (esquema,
  mapa, horari, Marey i calendari), parades amb sortides del dia, viatges i calendari de servei.
- **Edita** qualsevol fitxer GTFS amb validació de camps segons l'especificació.
- **Genera viatges** a partir d'una línia, unes parades i una freqüència.
- **Valida** el feed i l'**exporta** de nou com a ZIP GTFS (conserva les columnes extra).

## Idiomes i cercadors

La interfície és en català, castellà, anglès, francès, alemany, italià, portuguès, xinès
(simplificat) i japonès (`src/locales/`; `npm run i18n:check` en comprova les claus i les variables).

Les pàgines públiques (l'inici i el catàleg, amb una fitxa per feed) tenen una adreça per idioma:
`/catalog` en anglès (el que indexen els cercadors per defecte), `/ca/catalog`, `/ja/catalog/fgc`... Totes porten canònica, `hreflang`,
Open Graph i dades estructurades (schema.org), i surten a `/sitemap.xml`. L'espai de treball
(`/feeds`, `/new`) porta `noindex`. `SITE_URL` és l'adreça pública (per defecte, https://gtfs.newspirit.studio).

## Posada en marxa

Requisits: Node 22 o superior (`.nvmrc` → 24), npm 10 i PostgreSQL.

```bash
npm ci
cp env.example .env.local        # i ajusta DATABASE_URL
npm run db:migrate
npm run dev                      # http://localhost:3000 (l'editor és a /feeds)
```

Importar un feed des de la línia d'ordres:

```bash
npm run gtfs:import -- ~/Downloads/fomento_transit --name "Renfe Cercanías"
```

## Ordres

| Ordre                                    | Què fa                                       |
| ---------------------------------------- | -------------------------------------------- |
| `npm run dev`                            | Servidor de desenvolupament                  |
| `npm run build` / `npm start`            | Build i servidor de producció                |
| `npm run type-check` / `lint` / `format` | TypeScript, ESLint (zero avisos), Prettier   |
| `npm run test -- --run`                  | Tests (Vitest)                               |
| `npm run i18n:check`                     | Textos complets i variables en els 9 idiomes |
| `npm run db:generate` / `db:migrate`     | Migracions de Drizzle                        |

## Estructura

```text
app/            Pàgines (App Router) i rutes /api
src/features/   Una carpeta per mòdul: overview, network, routes, stops, trips, calendar,
                validation, data, generator, feeds, catalog
src/components/ Peces compartides: closca, UI, mapes (Leaflet), gràfics, esquelets de càrrega
src/server/     Base de dades (Drizzle/Postgres) i lògica GTFS: importació, exportació,
                validació, xarxa, detalls, generador, catàleg
shared/         Contractes compartits: especificació GTFS, valors, catàleg, generador
src/locales/    Un JSON per idioma (el català és la llengua de reserva)
```

## Isotips del catàleg

Els isotips de les marques (`public/catalog-logos/`) són fitxers vectorials de
[Wikimedia Commons](https://commons.wikimedia.org/) en domini públic o CC0; la pàgina del catàleg
enllaça la fitxa de cada un. Els de l'AMB i l'STM s'han retallat per deixar-ne només el símbol.

Les banderes del filtre de països (`public/flags/`) són de
[circle-flags](https://github.com/HatScripts/circle-flags) v2.8.0 (MIT).

## Animació de la portada

La xarxa de FGC de la portada i els seus trens surten del feed GTFS obert de FGC: un dia feiner
entre les 7 i les 10. Per regenerar-la amb un feed més nou, importa FGC des del catàleg i executa
`npm run landing:network -- AAAA-MM-DD` (amb la data d'un dia feiner dins del període del feed).
