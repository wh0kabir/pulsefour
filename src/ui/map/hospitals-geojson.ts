import type { Hospital } from '../../sim/types';

/** The shape of public/data/hospitals.json. */
export interface HospitalFile {
  meta: {
    generated: string;
    source: string;
    attribution: string;
    hospitalCount: number;
    traumaCapableCount: number;
    note: string;
    curationRule: string;
  };
  hospitals: Hospital[];
}

export interface HospitalProps {
  id: string;
  name: string;
  traumaCapable: boolean;
  total: number;
  available: number;
  icuTotal: number;
  /** 0..1 share of beds in use. Drives the ring colour. */
  load: number;
  capacityVerified: boolean;
  capabilityVerified: boolean;
  /** Sprite id; see src/ui/map/icons.ts. */
  icon: string;
}

/** Section 14: ice when healthy, amber at 80% or more, red when full. */
export const HOSPITAL_COLOUR = {
  healthy: '#4DA8FF',
  busy: '#FF8A3D',
  full: '#FF5468',
} as const;

export function hospitalsToGeoJson(
  hospitals: Hospital[],
): GeoJSON.FeatureCollection<GeoJSON.Point, HospitalProps> {
  return {
    type: 'FeatureCollection',
    features: hospitals.map((h) => {
      const load = h.beds.total > 0 ? 1 - h.beds.available / h.beds.total : 0;
      const ring = h.beds.available <= 0 ? 'full' : load >= 0.8 ? 'busy' : 'healthy';
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.position.lng, h.position.lat] },
        properties: {
          id: h.id,
          name: h.name,
          traumaCapable: h.traumaCapable,
          total: h.beds.total,
          available: h.beds.available,
          icuTotal: h.beds.icuTotal,
          load,
          capacityVerified: h.provenance.capacity === 'verified',
          capabilityVerified: h.provenance.capability === 'verified',
          icon: `hospital-${ring}-${h.traumaCapable ? 'trauma' : 'plain'}`,
        },
      };
    }),
  };
}
