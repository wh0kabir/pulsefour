import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

// MapLibre locates its worker at runtime with
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. That path is built
// from a variable, so Rollup cannot see it statically, never emits the file,
// and the built site fails with "Worker failed to load" and a blank map.
// `?worker&url` makes Vite BUNDLE the worker and hand us its URL. Plain
// `?url` is not enough: it copies the file verbatim, and the worker imports
// `./maplibre-gl-shared.mjs`, which is then missing beside it.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(maplibreWorkerUrl);

import { MAP_BOUNDS } from '../../config/area';
import type { GraphFile } from '../../sim/types';
import { ROAD_COLOUR, graphToRoadGeoJson, type RoadProps } from './graph-geojson';
import {
  HOSPITAL_COLOUR,
  hospitalsToGeoJson,
  type HospitalFile,
  type HospitalProps,
} from './hospitals-geojson';
import {
  ambulancesToGeoJson,
  casualtiesToGeoJson,
  routesToGeoJson,
  type AmbulanceProps,
  type CasualtyProps,
} from './live-geojson';
import { ICON_PIXEL_RATIO, buildAllIcons } from './icons';
import Legend from './Legend';
import { useStore } from '../state/store';

/**
 * The map (CLAUDE.md sections 5, 13, 14).
 *
 * Base map is OUR OWN road data on a plain matte black background. No raster
 * tiles, so the demo works with no network. Attribution for OpenStreetMap is
 * always visible, as section 15 requires.
 *
 * Casualties, ambulances and hospitals arrive with the engine (M3, M6). Those
 * layers update through `setData` on a source, never by re-rendering React per
 * ambulance per tick (section 14).
 */

const ROADS_SOURCE = 'roads';
const HOSPITALS_SOURCE = 'hospitals';
const ROUTES_SOURCE = 'routes';
const CASUALTIES_SOURCE = 'casualties';
const AMBULANCES_SOURCE = 'ambulances';

/** A style with no tile sources: just a matte background we draw on top of. */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#090A0C' } }],
};

interface Selected {
  name: string;
  tier: string;
  lengthM: number;
  oneway: boolean;
  osmWayId: number;
  edgeId: number;
}

/**
 * How the map is framed.
 *
 * The study area is tall and narrow (about 8.7 km by 3.2 km) and the console
 * panel is wide, so fitting the whole box letterboxes it and leaves most of
 * the width empty. 'incident' fills the panel instead, framed on where the
 * casualties actually are; 'area' pulls back to the whole spine.
 */
type Framing = 'incident' | 'area' | 'follow';

/** A selected marker swaps to its `-selected` sprite, which adds a ring. */
function iconExpression(selectedId: string | null): ExpressionSpecification | string {
  if (!selectedId) return ['get', 'icon'];
  return [
    'case',
    ['==', ['get', 'id'], selectedId],
    ['concat', ['get', 'icon'], '-selected'],
    ['get', 'icon'],
  ];
}

/** Layers carrying a selectable marker sprite. */
const SYMBOL_LAYERS = ['hospitals-ring', 'casualties', 'ambulances'] as const;

/** Full-bleed: fit the data's full WIDTH, letting the height crop. */
function incidentBounds(centreLat: number): [[number, number], [number, number]] {
  // A deliberately thin latitude band. fitBounds satisfies the larger
  // constraint, which here is longitude, so the roads fill the panel edge to
  // edge and the zoom is driven by the data's real width.
  const band = 0.004;
  return [
    [MAP_BOUNDS[0][0], centreLat - band],
    [MAP_BOUNDS[1][0], centreLat + band],
  ];
}

/**
 * Fill the panel with road data, centred as near `targetLat` as possible
 * without showing emptiness beyond the extracted area.
 *
 * The incident sits at the very northern edge of the study area, so centring
 * on it directly would leave the top half of the view blank. This fits the
 * width first, measures how much latitude that zoom actually shows, then
 * clamps the centre so the viewport stays inside the data.
 */
function frameFullBleed(
  instance: MapLibreMap,
  targetLat: number,
  animate: boolean,
): void {
  instance.fitBounds(incidentBounds(targetLat), { padding: 0, animate: false });

  const visible = instance.getBounds();
  const halfSpan = (visible.getNorth() - visible.getSouth()) / 2;

  const south = MAP_BOUNDS[0][1];
  const north = MAP_BOUNDS[1][1];

  // When the data is shorter than the viewport, centre it and accept the gap.
  const clamped =
    north - south <= halfSpan * 2
      ? (north + south) / 2
      : Math.min(Math.max(targetLat, south + halfSpan), north - halfSpan);

  const centre = { lat: clamped, lng: instance.getCenter().lng };
  if (animate) instance.easeTo({ center: centre, duration: 500 });
  else instance.setCenter(centre);
}

function areaBounds(): [[number, number], [number, number]] {
  return [
    [MAP_BOUNDS[0][0], MAP_BOUNDS[0][1]],
    [MAP_BOUNDS[1][0], MAP_BOUNDS[1][1]],
  ];
}

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [hospital, setHospital] = useState<HospitalProps | null>(null);
  const [unit, setUnit] = useState<
    { kind: 'casualty'; props: CasualtyProps } | { kind: 'ambulance'; props: AmbulanceProps } | null
  >(null);
  const [meta, setMeta] = useState<GraphFile['meta'] | null>(null);
  const [hospitalCount, setHospitalCount] = useState<number | null>(null);
  const graphRef = useRef<GraphFile | null>(null);
  const readyRef = useRef(false);
  const [framing, setFraming] = useState<Framing>('incident');
  // Read from the scenario file, never typed in: rule 3 forbids coordinates
  // from memory. Null until the file loads.
  const [incidentLat, setIncidentLat] = useState<number | null>(null);

  const world = useStore((s) => s.world);
  const inject = useStore((s) => s.inject);

  /**
   * Where the action is: the mean latitude of casualties still on the ground,
   * falling back to the scenario's incident end of the map before any have
   * appeared. Keeps the default view on the part that matters.
   */
  const actionLat = (() => {
    const onGround = (world?.casualties ?? []).filter(
      (c) => c.status === 'waiting' || c.status === 'assigned' || c.status === 'pickup',
    );
    if (onGround.length === 0) return incidentLat ?? (MAP_BOUNDS[0][1] + MAP_BOUNDS[1][1]) / 2;
    return onGround.reduce((sum, c) => sum + c.position.lat, 0) / onGround.length;
  })();

  // The map's load handler closes over state from first render, so hand it
  // the current value through a ref.
  const actionLatRef = useRef(actionLat);
  actionLatRef.current = actionLat;

  /** The id currently highlighted, across all three marker layers. */
  const selectedMarkerId = hospital?.id ?? unit?.props.id ?? null;

  const clearSelection = useCallback(() => {
    setSelected(null);
    setHospital(null);
    setUnit(null);
    map.current?.setFilter('roads-selected', ['==', ['get', 'edgeId'], -1]);
  }, []);

  /** Swap the selected marker to its ringed sprite. */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !readyRef.current) return;
    for (const layer of SYMBOL_LAYERS) {
      if (instance.getLayer(layer)) {
        instance.setLayoutProperty(layer, 'icon-image', iconExpression(selectedMarkerId));
      }
    }
  }, [selectedMarkerId]);

  /** Escape clears whatever is selected. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new MapLibreMap({
      container: container.current,
      style: BLANK_STYLE,
      // Frame by the data's WIDTH so the panel fills edge to edge. Fitting the
      // whole box would letterbox it: the area is tall and narrow and the
      // console panel is wide. `bounds` is passed INSTEAD of center/zoom --
      // supplying both leaves center/zoom winning. Re-fitted properly on load.
      bounds: incidentBounds((MAP_BOUNDS[0][1] + MAP_BOUNDS[1][1]) / 2),
      fitBoundsOptions: { padding: 0 },
      // Deliberately NO maxBounds. It imposes a minimum zoom so the viewport
      // can never show more than those bounds, and because the study area is
      // tall and narrow inside a wide console panel, that floor (about z14)
      // overrode any attempt to fit the whole area. A zoom range gives the
      // same protection without fighting the fit.
      minZoom: 11,
      maxZoom: 18,
      attributionControl: false,
      // Our own vector data; no need for the default 512px tile pyramid.
      renderWorldCopies: false,
    });
    map.current = instance;

    instance.addControl(
      new AttributionControl({
        compact: false,
        customAttribution: '© OpenStreetMap contributors',
      }),
      'bottom-right',
    );
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    let cancelled = false;

    instance.on('load', async () => {
      try {
        const response = await fetch('/data/graph.json');
        if (!response.ok) throw new Error(`graph.json returned ${response.status}`);
        const graph = (await response.json()) as GraphFile;
        if (cancelled) return;

        graphRef.current = graph;
        setMeta(graph.meta);

        // The incident point frames the default view, so it has to be known
        // BEFORE the first fitBounds. Read from the scenario file, never
        // typed in (rule 3).
        let frameLat = (MAP_BOUNDS[0][1] + MAP_BOUNDS[1][1]) / 2;
        try {
          const scenarioResponse = await fetch('/data/scenario-parel.json');
          if (scenarioResponse.ok) {
            const scenario = (await scenarioResponse.json()) as {
              incident?: { lat?: number };
            };
            if (typeof scenario.incident?.lat === 'number') {
              frameLat = scenario.incident.lat;
              setIncidentLat(scenario.incident.lat);
            }
          }
        } catch {
          // Falls back to the centre of the study area.
        }
        if (cancelled) return;

        // Re-fit once the container has its final size. The constructor's
        // fitBounds runs against whatever size the element had at mount,
        // which inside a flex/grid console layout is not yet the real one.
        instance.resize();
        frameFullBleed(instance, frameLat, false);

        // Sprites are generated on a canvas so the severity letters need no
        // font glyph fetch (see icons.ts).
        for (const [id, sprite] of Object.entries(buildAllIcons())) {
          if (!instance.hasImage(id)) {
            instance.addImage(id, sprite, { pixelRatio: ICON_PIXEL_RATIO });
          }
        }

        instance.addSource(ROADS_SOURCE, {
          type: 'geojson',
          data: graphToRoadGeoJson(graph),
        });

        // Minor roads first so arterials draw on top of them.
        for (const tier of ['minor', 'main', 'arterial'] as const) {
          instance.addLayer({
            id: `roads-${tier}`,
            type: 'line',
            source: ROADS_SOURCE,
            filter: ['==', ['get', 'tier'], tier],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ROAD_COLOUR[tier],
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                11,
                tier === 'arterial' ? 1.1 : tier === 'main' ? 0.7 : 0.4,
                14,
                tier === 'arterial' ? 2.6 : tier === 'main' ? 1.7 : 1.0,
                17,
                tier === 'arterial' ? 7 : tier === 'main' ? 5 : 3,
              ],
            },
          });
        }

        // A wide, invisible hit target makes thin roads clickable.
        instance.addLayer({
          id: 'roads-hit',
          type: 'line',
          source: ROADS_SOURCE,
          paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 12 },
        });

        // The selected road, highlighted in ice.
        instance.addLayer({
          id: 'roads-selected',
          type: 'line',
          source: ROADS_SOURCE,
          filter: ['==', ['get', 'edgeId'], -1],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#4DA8FF', 'line-width': 3.5 },
        });

        instance.on('click', 'roads-hit', (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const props = feature.properties as unknown as RoadProps;
          setSelected({
            name: props.name || 'Unnamed road',
            tier: props.tier,
            lengthM: props.lengthM,
            // GeoJSON properties round-trip booleans as strings through MapLibre.
            oneway: props.oneway === true || String(props.oneway) === 'true',
            osmWayId: props.osmWayId,
            edgeId: props.edgeId,
          });
          setHospital(null);
          setUnit(null);
          instance.setFilter('roads-selected', ['==', ['get', 'edgeId'], props.edgeId]);
        });

        instance.on('mouseenter', 'roads-hit', () => {
          instance.getCanvas().style.cursor = 'pointer';
        });
        instance.on('mouseleave', 'roads-hit', () => {
          instance.getCanvas().style.cursor = '';
        });

        // --- hospitals ----------------------------------------------------
        const hospitalResponse = await fetch('/data/hospitals.json');
        if (!hospitalResponse.ok) {
          throw new Error(`hospitals.json returned ${hospitalResponse.status}`);
        }
        const hospitalFile = (await hospitalResponse.json()) as HospitalFile;
        if (cancelled) return;


        setHospitalCount(hospitalFile.meta.hospitalCount);
        instance.addSource(HOSPITALS_SOURCE, {
          type: 'geojson',
          data: hospitalsToGeoJson(hospitalFile.hospitals),
        });

        // Capacity ring: radius shows relative size, colour shows load.
        const loadColour = [
          'step',
          ['get', 'load'],
          HOSPITAL_COLOUR.healthy,
          0.8,
          HOSPITAL_COLOUR.busy,
          0.999,
          HOSPITAL_COLOUR.full,
        ];

        // A generous transparent circle underneath: the icons are small and
        // the map is dense, so clicking needs a bigger target than the art.
        instance.addLayer({
          id: 'hospitals-halo',
          type: 'circle',
          source: HOSPITALS_SOURCE,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 12, 16, 22],
            'circle-color': loadColour as never,
            'circle-opacity': 0.1,
          },
        });

        instance.addLayer({
          id: 'hospitals-ring',
          type: 'symbol',
          source: HOSPITALS_SOURCE,
          layout: {
            'icon-image': iconExpression(null),
            'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.72, 16, 1.1],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });

        instance.on('click', 'hospitals-halo', (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const props = feature.properties as unknown as HospitalProps;
          setHospital({
            ...props,
            // MapLibre round-trips booleans through strings.
            traumaCapable: String(props.traumaCapable) === 'true',
            capacityVerified: String(props.capacityVerified) === 'true',
            capabilityVerified: String(props.capabilityVerified) === 'true',
          });
          setSelected(null);
          setUnit(null);
          instance.setFilter('roads-selected', ['==', ['get', 'edgeId'], -1]);
        });

        instance.on('mouseenter', 'hospitals-halo', () => {
          instance.getCanvas().style.cursor = 'pointer';
        });
        instance.on('mouseleave', 'hospitals-halo', () => {
          instance.getCanvas().style.cursor = '';
        });

        // --- casualty and ambulance selection -----------------------------
        instance.on('click', 'casualties-hit', (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature) return;
          setUnit({ kind: 'casualty', props: feature.properties as unknown as CasualtyProps });
          setHospital(null);
          setSelected(null);
          instance.setFilter('roads-selected', ['==', ['get', 'edgeId'], -1]);
        });

        instance.on('click', 'ambulances-glow', (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature) return;
          setUnit({ kind: 'ambulance', props: feature.properties as unknown as AmbulanceProps });
          setHospital(null);
          setSelected(null);
          instance.setFilter('roads-selected', ['==', ['get', 'edgeId'], -1]);
        });

        for (const layer of ['casualties-hit', 'ambulances-glow']) {
          instance.on('mouseenter', layer, () => {
            instance.getCanvas().style.cursor = 'pointer';
          });
          instance.on('mouseleave', layer, () => {
            instance.getCanvas().style.cursor = '';
          });
        }

        // Clicking bare map clears the selection. Registered last so the
        // layer handlers above have already run for this click.
        instance.on('click', (event) => {
          const hits = instance.queryRenderedFeatures(event.point, {
            layers: [
              'ambulances-glow',
              'casualties-hit',
              'hospitals-halo',
              'roads-hit',
            ].filter((id) => instance.getLayer(id)),
          });
          if (hits.length === 0) {
            setSelected(null);
            setHospital(null);
            setUnit(null);
            instance.setFilter('roads-selected', ['==', ['get', 'edgeId'], -1]);
          }
        });

        // --- live layers, fed by setData each tick ------------------------
        const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

        instance.addSource(ROUTES_SOURCE, { type: 'geojson', data: empty });
        instance.addSource(CASUALTIES_SOURCE, { type: 'geojson', data: empty });
        instance.addSource(AMBULANCES_SOURCE, { type: 'geojson', data: empty });

        // Closed roads: dashed red (section 13).
        instance.addLayer({
          id: 'roads-closed',
          type: 'line',
          source: ROADS_SOURCE,
          filter: ['in', ['get', 'edgeId'], ['literal', []]],
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': '#FF5468',
            'line-width': 2.5,
            'line-dasharray': [2, 2],
            'line-opacity': 0.9,
          },
        });

        // Active routes: ice-blue dashes flowing along the path.
        instance.addLayer({
          id: 'routes',
          type: 'line',
          source: ROUTES_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#4DA8FF',
            'line-width': 1.6,
            'line-opacity': 0.55,
            'line-dasharray': [1.5, 2],
          },
        });

        // Casualties: circle sprite carrying the START letter. Section 7.5
        // forbids relying on colour alone.
        instance.addLayer({
          id: 'casualties-hit',
          type: 'circle',
          source: CASUALTIES_SOURCE,
          paint: { 'circle-radius': 13, 'circle-color': '#000', 'circle-opacity': 0 },
        });

        instance.addLayer({
          id: 'casualties',
          type: 'symbol',
          source: CASUALTIES_SOURCE,
          layout: {
            'icon-image': iconExpression(null),
            'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 16, 1.05],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            // Picked up or already dealt with: faded back.
            'icon-opacity': ['case', ['==', ['get', 'onScene'], 1], 1, 0.5],
          },
        });

        // Ambulances: chevrons aimed along their bearing, with a soft glow.
        instance.addLayer({
          id: 'ambulances-glow',
          type: 'circle',
          source: AMBULANCES_SOURCE,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 9, 16, 18],
            'circle-color': '#4DA8FF',
            'circle-opacity': ['case', ['==', ['get', 'busy'], 1], 0.16, 0.05],
          },
        });

        instance.addLayer({
          id: 'ambulances',
          type: 'symbol',
          source: AMBULANCES_SOURCE,
          layout: {
            'icon-image': iconExpression(null),
            'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.72, 16, 1.08],
            'icon-rotate': ['get', 'bearing'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });

        readyRef.current = true;
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      cancelled = true;
      instance.remove();
      map.current = null;
    };
  }, []);

  /** Re-frame when the operator switches framing. */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !readyRef.current) return;

    if (framing === 'area') {
      instance.fitBounds(areaBounds(), { padding: 14, duration: 500 });
    } else if (framing === 'incident') {
      frameFullBleed(instance, actionLatRef.current, true);
    }
    // actionLat is deliberately NOT a dependency: re-framing on every tick as
    // casualties move would fight the operator panning the map.
  }, [framing]);

  /**
   * Follow mode: keep the live action in view as ambulances move.
   *
   * Only nudges the camera when the action has actually drifted out of the
   * middle of the viewport, and never changes zoom. Re-centring on every tick
   * would make the map crawl constantly and fight anyone trying to read it.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !readyRef.current || framing !== 'follow' || !world) return;

    const points: [number, number][] = [];
    for (const casualty of world.casualties) {
      if (casualty.status === 'waiting' || casualty.status === 'assigned') {
        points.push([casualty.position.lng, casualty.position.lat]);
      }
    }
    for (const ambulance of world.ambulances) {
      if (ambulance.status === 'to_patient' || ambulance.status === 'to_hospital') {
        points.push([ambulance.position.lng, ambulance.position.lat]);
      }
    }
    if (points.length === 0) return;

    const centre = points.reduce(
      (acc, [lng, lat]) => [acc[0] + lng / points.length, acc[1] + lat / points.length],
      [0, 0],
    );

    const bounds = instance.getBounds();
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();
    const current = instance.getCenter();

    // Dead zone: the middle third. Only move once the action leaves it.
    const drifted =
      Math.abs(centre[1] - current.lat) > latSpan / 6 ||
      Math.abs(centre[0] - current.lng) > lngSpan / 6;

    if (drifted) {
      instance.easeTo({ center: { lng: centre[0], lat: centre[1] }, duration: 900 });
    }
  }, [world, framing]);

  /**
   * Push the new world into MapLibre sources every tick. This is a `setData`
   * on three sources, not a React re-render per ambulance (section 14).
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !readyRef.current || !world) return;

    const graph = graphRef.current;

    (instance.getSource(CASUALTIES_SOURCE) as GeoJSONSource | undefined)?.setData(
      casualtiesToGeoJson(world),
    );
    (instance.getSource(AMBULANCES_SOURCE) as GeoJSONSource | undefined)?.setData(
      ambulancesToGeoJson(world, graph),
    );
    (instance.getSource(ROUTES_SOURCE) as GeoJSONSource | undefined)?.setData(
      routesToGeoJson(world, graph),
    );

    if (instance.getLayer('roads-closed')) {
      instance.setFilter('roads-closed', [
        'in',
        ['get', 'edgeId'],
        ['literal', world.closedEdgeIds],
      ]);
    }

    // Hospital rings follow live bed counts.
    const hospitalSource = instance.getSource(HOSPITALS_SOURCE) as GeoJSONSource | undefined;
    if (hospitalSource && world.hospitals.length > 0) {
      hospitalSource.setData(hospitalsToGeoJson(world.hospitals));
    }
  }, [world]);

  return (
    <div className="relative h-full w-full bg-matte">
      {/*
        Must be sized with h-full, NOT `absolute inset-0`: MapLibre's own
        stylesheet sets `position: relative` on .maplibregl-map, which cancels
        absolute positioning and collapses the element to zero height.
      */}
      <div ref={container} className="h-full w-full" />

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="text-sm text-mist">Loading the road network&hellip;</p>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center px-6">
          <div className="max-w-[46ch] text-center">
            <p className="text-sm text-sev-red">The road network did not load.</p>
            <p className="mt-2 text-xs leading-relaxed text-mist">{message}</p>
            <p className="mt-2 text-xs leading-relaxed text-mist">
              Build it with{' '}
              <code className="font-mono">.venv/Scripts/python.exe scripts/extract-roads.py</code>{' '}
              then <code className="font-mono">node scripts/build-graph.ts</code>.
            </p>
          </div>
        </div>
      )}

      {status === 'ready' && <Legend />}

      {/* Casualty or ambulance inspector. */}
      {unit && (
        <div className="absolute top-3 left-3 w-60 rounded-lg border border-hairline bg-slate/95 p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-frost">
              {unit.kind === 'casualty' ? 'Casualty ' : 'Ambulance '}
              {unit.props.id}
            </p>
            <button
              type="button"
              onClick={clearSelection}
              className="-mt-0.5 shrink-0 text-mist hover:text-frost"
              aria-label="Close details"
            >
              &times;
            </button>
          </div>

          {unit.kind === 'casualty' ? (
            <dl className="mt-2 space-y-1 text-mist">
              <div className="flex justify-between gap-3">
                <dt>Severity</dt>
                <dd className="text-frost">
                  {unit.props.severity} ({unit.props.letter})
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Status</dt>
                <dd className="text-frost">{String(unit.props.status).replace(/_/g, ' ')}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Waited</dt>
                <dd className="tabular text-frost">{unit.props.waitedMin} min</dd>
              </div>
              {Number(unit.props.limitMin) > 0 && (
                <div className="flex justify-between gap-3">
                  <dt>Limit</dt>
                  <dd className="tabular text-frost">{unit.props.limitMin} min</dd>
                </div>
              )}
            </dl>
          ) : (
            <dl className="mt-2 space-y-1 text-mist">
              <div className="flex justify-between gap-3">
                <dt>Kind</dt>
                <dd className="text-frost">{unit.props.kind}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Status</dt>
                <dd className="text-frost">{String(unit.props.status).replace(/_/g, ' ')}</dd>
              </div>
            </dl>
          )}

          <p className="mt-2.5 border-t border-hairline pt-2 leading-relaxed text-mist">
            {unit.kind === 'casualty'
              ? 'Simulated casualty. Triage colour follows the START scheme.'
              : 'Simulated ambulance. Position is interpolated along its route.'}
          </p>
        </div>
      )}

      {/* Framing control. The study area is much taller than the panel, so
          the operator chooses between filling the view on the incident and
          pulling back to the whole spine. */}
      {status === 'ready' && (
        <div className="absolute bottom-3 left-3 flex overflow-hidden rounded-md border border-hairline bg-slate/90">
          {(
            [
              ['incident', 'Incident'],
              ['follow', 'Follow'],
              ['area', 'Whole area'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFraming(value)}
              aria-pressed={framing === value}
              className={
                'px-2.5 py-1 text-[11px] transition-colors ' +
                (framing === value
                  ? 'bg-graphite text-frost'
                  : 'text-mist hover:text-frost')
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Graph scale, so it is obvious this is real extracted data.
          Hidden while a detail card is open: it takes this corner. */}
      {meta && !selected && !hospital && !unit && (
        <div className="pointer-events-none absolute top-3 left-3 rounded-md border border-hairline bg-slate/80 px-2.5 py-1.5 text-[11px] text-mist">
          <span className="tabular text-frost">{meta.nodeCount.toLocaleString()}</span> junctions
          {' · '}
          <span className="tabular text-frost">{meta.edgeCount.toLocaleString()}</span> road segments
          {hospitalCount !== null && (
            <>
              {' · '}
              <span className="tabular text-frost">{hospitalCount}</span> hospitals
            </>
          )}
        </div>
      )}

      {/* Hospital inspector. Section 15 requires a badge on simulated fields. */}
      {hospital && (
        <div className="absolute top-3 left-3 w-64 rounded-lg border border-hairline bg-slate/95 p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-frost">{hospital.name}</p>
            <button
              type="button"
              onClick={clearSelection}
              className="-mt-0.5 shrink-0 text-mist hover:text-frost"
              aria-label="Close hospital details"
            >
              &times;
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            <span
              className={
                'rounded px-1.5 py-0.5 text-[10px] ' +
                (hospital.traumaCapable
                  ? 'bg-ice-600/20 text-ice-300'
                  : 'bg-graphite text-mist')
              }
            >
              {hospital.traumaCapable ? 'Trauma-capable' : 'Not trauma-capable'}
            </span>
            {!hospital.capabilityVerified && (
              <span className="rounded bg-graphite px-1.5 py-0.5 text-[10px] text-mist">
                simulated
              </span>
            )}
          </div>

          <dl className="mt-2.5 space-y-1 text-mist">
            <div className="flex justify-between gap-3">
              <dt>Beds</dt>
              <dd className="tabular text-frost">
                {hospital.available} free of {hospital.total}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>ICU beds</dt>
              <dd className="tabular text-frost">{hospital.icuTotal}</dd>
            </div>
          </dl>

          <p className="mt-2.5 border-t border-hairline pt-2 leading-relaxed text-mist">
            Location from OpenStreetMap.{' '}
            {hospital.capacityVerified
              ? 'Bed counts verified.'
              : 'Bed and ICU counts are simulated, not real.'}
          </p>
        </div>
      )}

      {/* Click-to-inspect (section 13). */}
      {selected && (
        <div className="absolute top-3 left-3 w-60 rounded-lg border border-hairline bg-slate/95 p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-frost">{selected.name}</p>
            <button
              type="button"
              onClick={clearSelection}
              className="-mt-0.5 shrink-0 text-mist hover:text-frost"
              aria-label="Close road details"
            >
              &times;
            </button>
          </div>
          <dl className="mt-2 space-y-1 text-mist">
            <div className="flex justify-between gap-3">
              <dt>Class</dt>
              <dd className="text-frost">{selected.tier}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Length</dt>
              <dd className="tabular text-frost">{Math.round(selected.lengthM)} m</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>One-way</dt>
              <dd className="text-frost">{selected.oneway ? 'yes' : 'no'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Edge</dt>
              <dd className="tabular font-mono text-frost">{selected.edgeId}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>OSM way</dt>
              <dd className="tabular font-mono text-frost">{selected.osmWayId}</dd>
            </div>
          </dl>

          {/* Closing a road closes every edge sharing its OSM way id, both
              directions, which is the default in section 8. */}
          {(() => {
            const isClosed = (world?.closedEdgeIds ?? []).includes(selected.edgeId);
            return (
              <button
                type="button"
                onClick={() =>
                  inject(
                    isClosed
                      ? { type: 'openRoad', osmid: String(selected.osmWayId), wholeRoad: true }
                      : { type: 'closeRoad', osmid: String(selected.osmWayId), wholeRoad: true },
                    isClosed ? 'Road opened' : 'Road closed',
                  )
                }
                className={
                  'mt-2.5 w-full rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ' +
                  (isClosed
                    ? 'bg-ice-600 text-matte hover:bg-ice-500'
                    : 'border border-sev-red/50 text-sev-red hover:bg-sev-red/10')
                }
              >
                {isClosed ? 'Open road' : 'Close road'}
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}
