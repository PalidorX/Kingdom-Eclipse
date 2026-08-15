// OpenStreetMap ingestion: fetch, parse, cache.
// Fallbacks are a launch requirement per the design doc: on any failure we
// synthesize procedural terrain so the game always has a playable map.

import { GeoPos, haversineM } from './geo';
import { METERS_PER_TILE, WORLD_TX, WORLD_TY } from '../config/constants';

export type FeatureType = 'building' | 'road' | 'water' | 'forest' | 'park' | 'parking';

export interface OSMFeature {
  type: FeatureType;
  name?: string;
  poi?: boolean; // interesting building (dungeon candidate)
  id: number;
  geometry: { lat: number; lon: number }[];
}

const CACHE_KEY = 'ke3_osm_areas';
const CACHE_SLOTS = 12;
const POI_TAGS = ['amenity', 'shop', 'leisure', 'tourism', 'historic'];

interface RawElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export function parseOSM(data: { elements: RawElement[] }): OSMFeature[] {
  const out: OSMFeature[] = [];
  for (const el of data.elements || []) {
    if (!el.geometry || el.geometry.length === 0) continue;
    const t = el.tags || {};
    let type: FeatureType | null = null;
    if (t.building) type = 'building';
    else if (t.highway) type = 'road';
    else if (t.natural === 'water' || t.waterway) type = 'water';
    else if (t.landuse === 'forest' || t.natural === 'wood') type = 'forest';
    else if (t.leisure === 'park' || t.landuse === 'grass') type = 'park';
    else if (t.amenity === 'parking') type = 'parking';
    if (!type) continue;
    const poi = type === 'building' && POI_TAGS.some((k) => t[k]);
    out.push({ type, id: el.id, geometry: el.geometry, name: t.name, poi });
  }
  return out;
}

export async function fetchOSM(center: GeoPos): Promise<{ elements: RawElement[] }> {
  const latD = (WORLD_TY * METERS_PER_TILE) / 111000;
  const lonD = (WORLD_TX * METERS_PER_TILE) / (111000 * Math.cos((center.lat * Math.PI) / 180));
  const s = center.lat - latD / 2, n = center.lat + latD / 2;
  const w = center.lon - lonD / 2, e = center.lon + lonD / 2;
  const q = `
    [out:json][timeout:12];
    (
      way["building"](${s},${w},${n},${e});
      way["highway"](${s},${w},${n},${e});
      way["natural"="water"](${s},${w},${n},${e});
      way["waterway"](${s},${w},${n},${e});
      way["landuse"="forest"](${s},${w},${n},${e});
      way["natural"="wood"](${s},${w},${n},${e});
      way["leisure"="park"](${s},${w},${n},${e});
      way["landuse"="grass"](${s},${w},${n},${e});
      way["amenity"="parking"](${s},${w},${n},${e});
    );
    out geom;
  `;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  return res.json();
}

interface CachedArea { pos: GeoPos; data: { elements: RawElement[] }; ts: number }

function loadAreas(): CachedArea[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const a = JSON.parse(raw);
      if (Array.isArray(a)) return a;
    }
  } catch { /* ignore */ }
  return [];
}

function saveAreas(areas: CachedArea[]): void {
  // trim oldest first; shrink further if storage is full
  let list = [...areas].sort((a, b) => b.ts - a.ts).slice(0, CACHE_SLOTS);
  for (;;) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
      return;
    } catch {
      if (list.length <= 1) return;
      list = list.slice(0, Math.floor(list.length / 2));
    }
  }
}

// Get map data for a position: any cached area within 60m wins; else fetch
// (and cache); on failure fall back to the nearest cached area within 400m,
// else null (caller synthesizes procedural terrain).
export async function getMapData(pos: GeoPos): Promise<{ features: OSMFeature[]; pinned: GeoPos } | null> {
  const areas = loadAreas();
  const near = areas
    .map((a) => ({ a, d: haversineM(a.pos, pos) }))
    .sort((x, y) => x.d - y.d)[0];
  if (near && near.d < 60) {
    near.a.ts = Date.now();
    saveAreas(areas);
    return { features: parseOSM(near.a.data), pinned: near.a.pos };
  }
  try {
    const data = await fetchOSM(pos);
    areas.push({ pos, data, ts: Date.now() });
    saveAreas(areas);
    return { features: parseOSM(data), pinned: pos };
  } catch {
    // only fall back to a cached area that actually covers this view;
    // otherwise let the caller synthesize terrain at the requested centre
    if (near && near.d < 60) return { features: parseOSM(near.a.data), pinned: near.a.pos };
    return null;
  }
}
