import type { GraphFile, WorldState } from '../../sim/types';

/**
 * Live layers built from WorldState (CLAUDE.md section 13).
 *
 * These are rebuilt each tick and pushed through `setData`, never by
 * re-rendering React per ambulance per tick (section 14).
 */

/** START colours. Never carried by colour alone: each marker has a letter. */
export const SEVERITY_COLOUR = {
  red: '#FF5468',
  yellow: '#FFC247',
  green: '#4ADE9A',
  black: '#6B7480',
} as const;

export const SEVERITY_LETTER = {
  red: 'R',
  yellow: 'Y',
  green: 'G',
  black: 'B',
} as const;

export interface CasualtyProps {
  id: string;
  severity: string;
  letter: string;
  status: string;
  waitedMin: number;
  limitMin: number;
  /** Still on the ground and waiting for an ambulance. */
  onScene: number;
  /** Sprite id; see src/ui/map/icons.ts. */
  icon: string;
}

export function casualtiesToGeoJson(
  state: WorldState,
): GeoJSON.FeatureCollection<GeoJSON.Point, CasualtyProps> {
  const onGround = new Set([
    'waiting',
    'assigned',
    'pickup',
    'adverse',
    'unserved',
  ]);

  return {
    type: 'FeatureCollection',
    features: state.casualties
      .filter((c) => onGround.has(c.status))
      .map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [c.position.lng, c.position.lat] },
        properties: {
          id: c.id,
          severity: c.severity,
          letter: SEVERITY_LETTER[c.severity as keyof typeof SEVERITY_LETTER] ?? '?',
          status: c.status,
          waitedMin: c.waitedMin,
          limitMin: Number.isFinite(c.limitMin) ? c.limitMin : 0,
          onScene: c.status === 'waiting' ? 1 : 0,
          icon: `casualty-${c.severity}`,
        },
      })),
  };
}

export interface AmbulanceProps {
  id: string;
  kind: string;
  status: string;
  busy: number;
  bearing: number;
  /** Sprite id; see src/ui/map/icons.ts. */
  icon: string;
}

export function ambulancesToGeoJson(
  state: WorldState,
  graph: GraphFile | null,
): GeoJSON.FeatureCollection<GeoJSON.Point, AmbulanceProps> {
  return {
    type: 'FeatureCollection',
    features: state.ambulances
      .filter((a) => a.status !== 'offline')
      .map((a) => {
        // Point the chevron along the edge it is travelling.
        let bearing = 0;
        if (graph && a.routeEdgeIds.length > 0) {
          const edgeId = a.routeEdgeIds[0]!;
          const from = graph.edges.from[edgeId];
          const to = graph.edges.to[edgeId];
          if (from !== undefined && to !== undefined) {
            const dLng = graph.nodes.lng[to]! - graph.nodes.lng[from]!;
            const dLat = graph.nodes.lat[to]! - graph.nodes.lat[from]!;
            bearing = (Math.atan2(dLng, dLat) * 180) / Math.PI;
          }
        }
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [a.position.lng, a.position.lat] },
          properties: {
            id: a.id,
            kind: a.kind,
            status: a.status,
            busy: a.status === 'idle' ? 0 : 1,
            bearing,
            icon: `ambulance-${a.status === 'idle' ? 'idle' : 'busy'}-${
              a.kind === 'ALS' ? 'als' : 'bls'
            }`,
          },
        };
      }),
  };
}

/** Active routes, drawn as flowing dashed lines. */
export function routesToGeoJson(
  state: WorldState,
  graph: GraphFile | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString, { id: string }> {
  if (!graph) return { type: 'FeatureCollection', features: [] };

  const features: GeoJSON.Feature<GeoJSON.LineString, { id: string }>[] = [];

  for (const ambulance of state.ambulances) {
    if (ambulance.routeEdgeIds.length === 0) continue;

    const coordinates: [number, number][] = [
      [ambulance.position.lng, ambulance.position.lat],
    ];

    for (const edgeId of ambulance.routeEdgeIds) {
      const to = graph.edges.to[edgeId];
      if (to === undefined) continue;
      coordinates.push([graph.nodes.lng[to]!, graph.nodes.lat[to]!]);
    }

    if (coordinates.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { id: ambulance.id },
    });
  }

  return { type: 'FeatureCollection', features };
}
