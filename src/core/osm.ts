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

const CACHE_KEY = 'ke2_osm_cache';
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

export function loadCache(): { pos: GeoPos; data: { elements: RawElement[] } } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (typeof c?.pos?.lat === 'number' && c?.data) return c;
  } catch { /* ignore */ }
  return null;
}

export function saveCache(pos: GeoPos, data: { elements: RawElement[] }): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ pos, data }));
  } catch { /* storage full - non-fatal */ }
}

// Get map data for a position: cache within 60m -> cached; else network;
// on failure -> null (caller synthesizes procedural terrain).
export async function getMapData(pos: GeoPos): Promise<{ features: OSMFeature[]; pinned: GeoPos } | null> {
  const c = loadCache();
  if (c && haversineM(c.pos, pos) < 60) {
    return { features: parseOSM(c.data), pinned: c.pos };
  }
  try {
    const data = await fetchOSM(pos);
    saveCache(pos, data);
    return { features: parseOSM(data), pinned: pos };
  } catch {
    if (c) return { features: parseOSM(c.data), pinned: c.pos };
    return null;
  }
}
