import type { GraphFile } from '../../sim/types';

/**
 * Turns the compact graph file into GeoJSON for MapLibre.
 *
 * The road network is our own data drawn on a plain matte black background,
 * so the map needs no raster tiles and works with no network (section 5).
 */

/** Visual tier, which drives colour and width. Section 14 gives three greys. */
export type RoadTier = 'arterial' | 'main' | 'minor';

export const ROAD_COLOUR: Record<RoadTier, string> = {
  arterial: '#3A4757',
  main: '#2B3440',
  minor: '#1C2128',
};

function tierOf(speedClass: string): RoadTier {
  switch (speedClass) {
    case 'motorway':
    case 'trunk':
    case 'primary':
      return 'arterial';
    case 'secondary':
    case 'tertiary':
      return 'main';
    default:
      return 'minor';
  }
}

export interface RoadProps {
  edgeId: number;
  tier: RoadTier;
  name: string;
  osmWayId: number;
  oneway: boolean;
  lengthM: number;
}

export type RoadFeature = GeoJSON.Feature<GeoJSON.LineString, RoadProps>;

/**
 * One LineString per edge. Coordinates are [lng, lat] -- GeoJSON order, which
 * is the opposite of how we store them.
 */
export function graphToRoadGeoJson(graph: GraphFile): GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  RoadProps
> {
  const { nodes, edges, speedClasses, names } = graph;
  const features: RoadFeature[] = [];

  for (let edgeId = 0; edgeId < edges.from.length; edgeId++) {
    const fromIdx = edges.from[edgeId]!;
    const toIdx = edges.to[edgeId]!;

    const coordinates: [number, number][] = [[nodes.lng[fromIdx]!, nodes.lat[fromIdx]!]];

    const interior = edges.geom[edgeId];
    if (interior !== 0 && interior !== undefined) {
      for (let i = 0; i < interior.length; i += 2) {
        coordinates.push([interior[i + 1]!, interior[i]!]);
      }
    }

    coordinates.push([nodes.lng[toIdx]!, nodes.lat[toIdx]!]);

    const classIdx = edges.classIdx[edgeId]!;
    const nameIdx = edges.nameIdx[edgeId]!;

    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: {
        edgeId,
        tier: tierOf(speedClasses[classIdx] ?? 'other'),
        name: nameIdx >= 0 ? (names[nameIdx] ?? '') : '',
        osmWayId: edges.osmWayId[edgeId]!,
        oneway: edges.oneway[edgeId] === 1,
        lengthM: edges.lengthM[edgeId]!,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}
