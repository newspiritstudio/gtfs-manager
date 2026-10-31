/**
 * Les xarxes de l'animació de la portada. Cada visita en tria una a l'atzar; les dades
 * (`public/landing-networks/<id>.json`) les genera `npm run landing:network` a partir del feed GTFS
 * importat des del catàleg. L'id és el de l'entrada del catàleg.
 */
export interface LandingNetworkConfig {
  /** Entrada del catàleg (`shared/catalog.ts`). */
  id: string;
  /** Centre de la ciutat, per saber quins extrems de línia queden «a fora» i s'etiqueten. */
  center: [lat: number, lon: number];
  /** Franja simulada, en segons des de mitjanit (per defecte, de 7 a 10). */
  window?: [number, number];
  /** Línies (route_short_name) que no es dibuixen: lluny de la resta o sense traçat útil. */
  skip?: string[];
  /** Tipus de ruta que es dibuixen (per defecte, tots). */
  routeTypes?: number[];
}

export const LANDING_NETWORKS: LandingNetworkConfig[] = [
  { id: 'fgc', center: [41.3874, 2.1686], skip: ['RL1', 'RL2', 'BusBV', 'L1'] },
  { id: 'mta-subway', center: [40.758, -73.9855] },
  { id: 'atm-milano', center: [45.4642, 9.19], routeTypes: [1] },
  { id: 'tisseo', center: [43.6047, 1.4442], routeTypes: [0, 1] },
  { id: 'metrovalencia', center: [39.4699, -0.3763] },
  { id: 'bart', center: [37.7749, -122.4194], routeTypes: [1] },
  { id: 'lametro-rail', center: [34.0522, -118.2437] },
];

/** Les dades d'una xarxa, tal com les escriu el generador i les llegeix l'animació. */
export interface LandingNetwork {
  id: string;
  /** Dia simulat (AAAAMMDD). */
  date: string;
  window: [number, number];
  width: number;
  height: number;
  /** Centre de la ciutat en coordenades del dibuix: les etiquetes se n'aparten. */
  center: [number, number];
  lines: { name: string; color: string; text: string; d: string }[];
  /** Extrems de línia allunyats del centre, amb les línies que hi acaben. */
  labels: { x: number; y: number; lines: number[] }[];
  /** [línia, sortida, arribada, fracció inicial, fracció final] del traçat. */
  trains: [number, number, number, number, number][];
}
