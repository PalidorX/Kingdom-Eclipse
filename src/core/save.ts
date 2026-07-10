// Game state + persistence.
// PROTOTYPE NOTE: localStorage stands in for the server-authoritative save
// the design doc requires. The shape is kept flat/serializable so it can be
// lifted onto a backend without redesign.

import { OFFLINE_CAP_HOURS } from '../config/constants';

export type HeroClass = 'Knight' | 'Archer' | 'Mage' | 'Rogue' | 'Cleric';

export interface Hero {
  id: string;
  name: string;
  cls: HeroClass;
  level: number;
  xp: number;
  statPoints: number;
  alloc: { hp: number; atk: number; def: number; spd: number };
  recruit: { label: string; date: string; lat: number; lon: number };
  dedicated: { buildingId: string; date: string } | null;
}

export interface Building {
  id: string;
  type: string;   // townhall | tavern | knightschool | archery | magetower | shrine | storage | house
  name: string;
  gx: number;
  gy: number;
  w: number;
  h: number;
  stars: number;
  ledger: string[]; // hero ids in dedication order
}

export interface TavernOffer {
  name: string;
  cls: HeroClass;
  level: number;
  cost: number;
}

export interface GameState {
  version: number;
  gold: number;
  wood: number;
  stone: number;
  heroes: Hero[];
  buildings: Building[];
  tavern: { day: string; offers: TavernOffer[] };
  // world interaction flags: key -> dayKey when consumed
  consumed: Record<string, string>;
  lastSeen: number;
  admin: { enabled: boolean; pos: { lat: number; lon: number } | null };
  introSeen: boolean;
}

const KEY = 'ke2_save';

function defaultState(): GameState {
  return {
    version: 1,
    gold: 300,
    wood: 120,
    stone: 80,
    heroes: [],
    buildings: [
      { id: 'townhall', type: 'townhall', name: 'Town Hall', gx: 7, gy: 1, w: 3, h: 3, stars: 0, ledger: [] },
      { id: 'tavern', type: 'tavern', name: 'The Waypoint Tavern', gx: 1, gy: 2, w: 3, h: 2, stars: 0, ledger: [] },
      { id: 'knightschool', type: 'knightschool', name: 'Knight School', gx: 1, gy: 8, w: 3, h: 2, stars: 0, ledger: [] },
      { id: 'storage', type: 'storage', name: 'Storehouse', gx: 8, gy: 8, w: 2, h: 2, stars: 0, ledger: [] },
      { id: 'house1', type: 'house', name: 'Cottage', gx: 2, gy: 13, w: 2, h: 2, stars: 0, ledger: [] },
      { id: 'house2', type: 'house', name: 'Cottage', gx: 8, gy: 13, w: 2, h: 2, stars: 0, ledger: [] },
    ],
    tavern: { day: '', offers: [] },
    consumed: {},
    lastSeen: Date.now(),
    admin: { enabled: false, pos: null },
    introSeen: false,
  };
}

class Store {
  state: GameState = defaultState();

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.version === 1) this.state = { ...defaultState(), ...s };
      }
    } catch { /* fresh start */ }
  }

  save(): void {
    try {
      this.state.lastSeen = Date.now();
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch { /* non-fatal */ }
  }

  // ---- derived ----
  kingdomLevel(): number {
    const stars = this.state.buildings.reduce((a, b) => a + b.stars, 0);
    return 1 + Math.floor(stars / 2);
  }

  livingHeroes(): Hero[] {
    return this.state.heroes.filter((h) => !h.dedicated);
  }

  hero(id: string): Hero | undefined {
    return this.state.heroes.find((h) => h.id === id);
  }

  building(id: string): Building | undefined {
    return this.state.buildings.find((b) => b.id === id);
  }

  // Offline villager production: MATERIALS ONLY, hard-capped (design doc s.7)
  collectOffline(): { wood: number; stone: number } {
    const houses = this.state.buildings.filter((b) => b.type === 'house').length;
    const storageStars = this.building('storage')?.stars ?? 0;
    const capHours = OFFLINE_CAP_HOURS + storageStars * 2;
    const hours = Math.min((Date.now() - this.state.lastSeen) / 3600000, capHours);
    const wood = Math.floor(hours * 6 * houses);
    const stone = Math.floor(hours * 4 * houses);
    this.state.wood += wood;
    this.state.stone += stone;
    return { wood, stone };
  }
}

export const store = new Store();
