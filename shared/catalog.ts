/**
 * Catàleg de GTFS públics. Cada entrada és un feed obert que s'ha comprovat que es descarrega i que
 * té servei vigent. L'estat d'actualització no es desa aquí: el servidor el consulta en directe
 * (capçalera Last-Modified, metadades d'ArcGIS o d'Opendatasoft) i el mostra al catàleg.
 */

export type CatalogSource =
  /** Un ZIP en una URL fixa. */
  | { kind: 'zip'; url: string }
  /** Un element d'ArcGIS Online (ZIP a `/data`, metadades a `?f=json`). */
  | { kind: 'arcgis'; portal: string; item: string }
  /** Un conjunt d'Opendatasoft que publica cada fitxer .txt per separat. */
  | { kind: 'opendatasoft'; portal: string; dataset: string };

export interface CatalogEntry {
  id: string;
  name: string;
  operator: string;
  /** Codi de país ISO 3166-1 alfa-2. */
  country: string;
  region: string;
  /** Tipus de ruta GTFS (route_type) que conté el feed. */
  routeTypes: number[];
  homepage: string;
  source: CatalogSource;
  /** Clau de `CATALOG_LOGOS`: l'isotip de la marca, si n'hi ha un de lliure. */
  logo?: CatalogLogoId;
}

/**
 * Isotips de les marques, en vector, de Wikimedia Commons (`public/catalog-logos/`). Són logotips
 * en domini públic o CC0 segons la fitxa de cada fitxer; la pàgina del catàleg en cita l'origen.
 * L'AMB i l'STM s'han retallat per deixar només el símbol, sense el nom.
 */
export const CATALOG_LOGOS = {
  fgc: {
    src: '/catalog-logos/fgc.svg',
    file: 'FGC logo (2019).svg',
    url: 'https://commons.wikimedia.org/wiki/File:FGC_logo_(2019).svg',
    license: 'pd',
  },
  cercanias: {
    src: '/catalog-logos/cercanias.svg',
    file: 'Cercanias Logo.svg',
    url: 'https://commons.wikimedia.org/wiki/File:Cercanias_Logo.svg',
    license: 'pd',
  },
  renfe: {
    src: '/catalog-logos/renfe.svg',
    file: 'Isotipo de Renfe Operadora.svg',
    url: 'https://commons.wikimedia.org/wiki/File:Isotipo_de_Renfe_Operadora.svg',
    license: 'pd',
  },
  amb: {
    src: '/catalog-logos/amb.svg',
    file: "Icona de l'AMB.svg",
    url: 'https://commons.wikimedia.org/wiki/File:Icona_de_l%27AMB.svg',
    license: 'pd',
  },
  'metro-bilbao': {
    src: '/catalog-logos/metro-bilbao.svg',
    file: 'Símbolo del Metro de Bilbao.svg',
    url: 'https://commons.wikimedia.org/wiki/File:S%C3%ADmbolo_del_Metro_de_Bilbao.svg',
    license: 'pd',
  },
  euskotren: {
    src: '/catalog-logos/euskotren.svg',
    file: 'Euskotren Trena Logo.svg',
    url: 'https://commons.wikimedia.org/wiki/File:Euskotren_Trena_Logo.svg',
    license: 'pd',
  },
  bizkaibus: {
    src: '/catalog-logos/bizkaibus.svg',
    file: 'Logo Bizkaibus B.svg',
    url: 'https://commons.wikimedia.org/wiki/File:Logo_Bizkaibus_B.svg',
    license: 'cc0',
  },
  'emt-madrid': {
    src: '/catalog-logos/emt-madrid.svg',
    file: 'Símbolo de EMT Madrid.svg',
    url: 'https://commons.wikimedia.org/wiki/File:S%C3%ADmbolo_de_EMT_Madrid.svg',
    license: 'pd',
  },
  'metro-ligero': {
    src: '/catalog-logos/metro-ligero.svg',
    file: 'MetroLigeroLogo.svg',
    url: 'https://commons.wikimedia.org/wiki/File:MetroLigeroLogo.svg',
    license: 'pd',
  },
  bart: {
    src: '/catalog-logos/bart.svg',
    file: 'Bart-logo.svg',
    url: 'https://commons.wikimedia.org/wiki/File:Bart-logo.svg',
    license: 'pd',
  },
  trimet: {
    src: '/catalog-logos/trimet.svg',
    file: 'TriMet icon.svg',
    url: 'https://commons.wikimedia.org/wiki/File:TriMet_icon.svg',
    license: 'pd',
  },
  stm: {
    src: '/catalog-logos/stm.svg',
    file: 'STM (logo, 2010).svg',
    url: 'https://commons.wikimedia.org/wiki/File:STM_(logo,_2010).svg',
    license: 'pd',
  },
} as const satisfies Record<
  string,
  { src: string; file: string; url: string; license: 'pd' | 'cc0' }
>;

export type CatalogLogoId = keyof typeof CATALOG_LOGOS;

export const GTFS_CATALOG: CatalogEntry[] = [
  {
    id: 'fgc',
    name: 'FGC',
    operator: 'Ferrocarrils de la Generalitat de Catalunya',
    country: 'ES',
    region: 'Catalunya',
    routeTypes: [1, 2, 3, 7],
    homepage: 'https://dadesobertes.fgc.cat/explore/dataset/gtfs_zip/',
    source: { kind: 'opendatasoft', portal: 'https://dadesobertes.fgc.cat', dataset: 'gtfs_zip' },
    logo: 'fgc',
  },
  {
    id: 'renfe-cercanias',
    name: 'Renfe Cercanías i Rodalies',
    operator: 'Renfe Viajeros',
    country: 'ES',
    region: 'Espanya',
    routeTypes: [2, 3],
    homepage: 'https://data.renfe.com/dataset/horarios-cercanias',
    source: {
      kind: 'zip',
      url: 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip',
    },
    logo: 'cercanias',
  },
  {
    id: 'renfe-ld',
    name: 'Renfe Alta Velocitat, Llarga i Mitjana Distància',
    operator: 'Renfe Viajeros',
    country: 'ES',
    region: 'Espanya',
    routeTypes: [2],
    homepage:
      'https://data.renfe.com/dataset/horarios-de-alta-velocidad-larga-distancia-y-media-distancia',
    source: { kind: 'zip', url: 'https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip' },
    logo: 'renfe',
  },
  {
    id: 'amb',
    name: 'AMB Mobilitat',
    operator: 'Àrea Metropolitana de Barcelona',
    country: 'ES',
    region: 'Àrea metropolitana de Barcelona',
    routeTypes: [3],
    homepage: 'https://www.ambmobilitat.cat/',
    source: { kind: 'zip', url: 'https://www.ambmobilitat.cat/OpenData/google_transit.zip' },
    logo: 'amb',
  },
  {
    id: 'metro-bilbao',
    name: 'Metro Bilbao',
    operator: 'Metro Bilbao',
    country: 'ES',
    region: 'Bizkaia',
    routeTypes: [1],
    homepage: 'https://opendata.euskadi.eus/',
    source: {
      kind: 'zip',
      url: 'https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfs_metro_bilbao.zip',
    },
    logo: 'metro-bilbao',
  },
  {
    id: 'euskotren',
    name: 'Euskotren',
    operator: 'Euskotren',
    country: 'ES',
    region: 'Euskadi',
    routeTypes: [0, 2, 7],
    homepage: 'https://opendata.euskadi.eus/',
    source: {
      kind: 'zip',
      url: 'https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfs_euskotren.zip',
    },
    logo: 'euskotren',
  },
  {
    id: 'bilbobus',
    name: 'Bilbobus',
    operator: 'Bilbobus',
    country: 'ES',
    region: 'Bilbao',
    routeTypes: [3],
    homepage: 'https://opendata.euskadi.eus/',
    source: {
      kind: 'zip',
      url: 'https://opendata.euskadi.eus/transport/moveuskadi/bilbobus/gtfs_bilbobus.zip',
    },
  },
  {
    id: 'bizkaibus',
    name: 'Bizkaibus',
    operator: 'Bizkaibus',
    country: 'ES',
    region: 'Bizkaia',
    routeTypes: [3],
    homepage: 'https://opendata.euskadi.eus/',
    source: {
      kind: 'zip',
      url: 'https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfs_bizkaibus.zip',
    },
    logo: 'bizkaibus',
  },
  {
    id: 'crtm-emt',
    name: 'EMT Madrid',
    operator: 'Consorcio Regional de Transportes de Madrid',
    country: 'ES',
    region: 'Madrid',
    routeTypes: [3],
    homepage: 'https://datos-movilidad.crtm.es/',
    source: {
      kind: 'arcgis',
      portal: 'https://crtm.maps.arcgis.com',
      item: '868df0e58fca47e79b942902dffd7da0',
    },
    logo: 'emt-madrid',
  },
  {
    id: 'crtm-cercanias',
    name: 'Cercanías Madrid',
    operator: 'Consorcio Regional de Transportes de Madrid',
    country: 'ES',
    region: 'Madrid',
    routeTypes: [2, 3],
    homepage: 'https://datos-movilidad.crtm.es/',
    source: {
      kind: 'arcgis',
      portal: 'https://crtm.maps.arcgis.com',
      item: '1a25440bf66f499bae2657ec7fb40144',
    },
    logo: 'cercanias',
  },
  {
    id: 'crtm-metro-ligero',
    name: 'Metro Ligero de Madrid',
    operator: 'Consorcio Regional de Transportes de Madrid',
    country: 'ES',
    region: 'Madrid',
    routeTypes: [0],
    homepage: 'https://datos-movilidad.crtm.es/',
    source: {
      kind: 'arcgis',
      portal: 'https://crtm.maps.arcgis.com',
      item: 'aaed26cc0ff64b0c947ac0bc3e033196',
    },
    logo: 'metro-ligero',
  },
  {
    id: 'gtfs-de-fv',
    name: 'Llarga distància d’Alemanya',
    operator: 'gtfs.de',
    country: 'DE',
    region: 'Alemanya',
    routeTypes: [2],
    homepage: 'https://gtfs.de/',
    source: { kind: 'zip', url: 'https://download.gtfs.de/germany/fv_free/latest.zip' },
  },
  {
    id: 'bart',
    name: 'BART',
    operator: 'Bay Area Rapid Transit',
    country: 'US',
    region: 'San Francisco Bay Area',
    routeTypes: [1, 3],
    homepage: 'https://www.bart.gov/schedules/developers/gtfs',
    source: { kind: 'zip', url: 'https://www.bart.gov/dev/schedules/google_transit.zip' },
    logo: 'bart',
  },
  {
    id: 'trimet',
    name: 'TriMet',
    operator: 'TriMet',
    country: 'US',
    region: 'Portland',
    routeTypes: [0, 2, 3, 6],
    homepage: 'https://developer.trimet.org/GTFS.shtml',
    source: { kind: 'zip', url: 'https://developer.trimet.org/schedule/gtfs.zip' },
    logo: 'trimet',
  },
  {
    id: 'stm',
    name: 'STM',
    operator: 'Société de transport de Montréal',
    country: 'CA',
    region: 'Montréal',
    routeTypes: [1, 3],
    homepage: 'https://www.stm.info/en/about/developers',
    source: { kind: 'zip', url: 'https://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip' },
    logo: 'stm',
  },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return GTFS_CATALOG.find((entry) => entry.id === id);
}

/** Estat en directe d'una entrada del catàleg. */
export interface CatalogStatus {
  id: string;
  available: boolean;
  /** Darrera publicació segons la font (ISO), si la dona. */
  updatedAt: string | null;
  /** Mida del ZIP en bytes, si la font la dona. */
  size: number | null;
}
