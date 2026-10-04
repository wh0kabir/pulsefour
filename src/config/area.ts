/**
 * Study area: South Mumbai's eastern spine (Fort/CST up to Parel/Chinchpokli).
 * Locked decision 1. This is the ONLY place the bounding box is defined --
 * every script, query and map view reads it from here.
 *
 * These coordinates are real, from CLAUDE.md section 4. Nothing else in the
 * codebase may contain hand-typed real-world coordinates.
 */

export const AREA = {
  minLat: 18.930000,
  maxLat: 19.008228,
  minLon: 72.820000,
  maxLon: 72.850000,
} as const;

/** Overpass expects south, west, north, east. */
export const OVERPASS_BBOX =
  `${AREA.minLat},${AREA.minLon},${AREA.maxLat},${AREA.maxLon}` as const;

/** OSMnx 2.x takes a single (west, south, east, north) tuple. */
export const OSMNX_BBOX = [AREA.minLon, AREA.minLat, AREA.maxLon, AREA.maxLat] as const;

/** MapLibre bounds: [[west, south], [east, north]]. */
export const MAP_BOUNDS = [
  [AREA.minLon, AREA.minLat],
  [AREA.maxLon, AREA.maxLat],
] as const;

export const MAP_CENTER = { lat: 18.969114, lng: 72.835000 } as const;

/**
 * The original, smaller northern box. Kept only so the data pipeline can
 * report hospital counts for both boxes in docs/DATA.md (section 4).
 * Not used for the build itself.
 */
export const ORIGINAL_BOX_SOUTH_EDGE = 18.961517 as const;
