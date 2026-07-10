// Position provider with an admin teleport override.
// PROTOTYPE NOTE: a production build would be server-authoritative with
// speed/teleport checks (see design doc s.10). The admin override here is a
// dev tool and is clearly labelled in the UI.

export interface GeoPos {
  lat: number;
  lon: number;
}

type Listener = (pos: GeoPos) => void;

const DEFAULT_POS: GeoPos = { lat: 45.4215, lon: -75.6972 }; // Ottawa

class Geo {
  current: GeoPos = { ...DEFAULT_POS };
  adminOverride: GeoPos | null = null;
  private listeners: Listener[] = [];
  private watchId: number | null = null;
  gpsAvailable = false;

  get pos(): GeoPos {
    return this.adminOverride ?? this.current;
  }

  setAdmin(pos: GeoPos | null): void {
    this.adminOverride = pos ? { ...pos } : null;
    this.emit();
  }

  acquire(timeoutMs = 8000): Promise<GeoPos> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        resolve(this.pos);
        return;
      }
      const to = setTimeout(() => resolve(this.pos), timeoutMs);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(to);
          this.gpsAvailable = true;
          this.current = { lat: p.coords.latitude, lon: p.coords.longitude };
          resolve(this.pos);
        },
        () => {
          clearTimeout(to);
          resolve(this.pos);
        },
        { enableHighAccuracy: true, timeout: timeoutMs - 500, maximumAge: 30000 }
      );
    });
  }

  startWatch(): void {
    if (this.watchId !== null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        this.gpsAvailable = true;
        this.current = { lat: p.coords.latitude, lon: p.coords.longitude };
        if (!this.adminOverride) this.emit();
      },
      () => { /* keep last known */ },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 8000 }
    );
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    const p = this.pos;
    this.listeners.forEach((fn) => fn(p));
  }
}

export const geo = new Geo();

export function haversineM(a: GeoPos, b: GeoPos): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export const TELEPORT_PRESETS: { name: string; pos: GeoPos }[] = [
  { name: 'Ottawa', pos: { lat: 45.4215, lon: -75.6972 } },
  { name: 'New York', pos: { lat: 40.7580, lon: -73.9855 } },
  { name: 'London', pos: { lat: 51.5074, lon: -0.1278 } },
  { name: 'Tokyo', pos: { lat: 35.6595, lon: 139.7005 } },
  { name: 'Paris', pos: { lat: 48.8566, lon: 2.3522 } },
  { name: 'San Francisco', pos: { lat: 37.7749, lon: -122.4194 } },
];
