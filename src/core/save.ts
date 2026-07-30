// Game state + persistence for v2.2.
// PROTOTYPE: localStorage stands in for the server-authoritative backend.

import { OFFLINE_CAP_HOURS, STAR_JP_GATES } from '../config/constants';
import { JobKey } from '../game/jobs';

export interface JobProgress {
  level: number;              // 1..30, 1 JP per level [LOCKED]
  xp: number;
  jpSpent: string[];          // tree node ids bought (permanent per job)
  jpUnspent: number;
}

export interface Hero {
  id: string;
  name: string;
  job: JobKey;                          // currently worn job
  charLevel: number;
  charXp: number;
  statPoints: number;
  alloc: { str: number; dex: number; int: number };
  luck: number;                         // innate, non-allocatable
  jobs: Partial<Record<JobKey, JobProgress>>;
  equippedUlt: number;                  // 0..3 index into job's ultimates
  recruit: { label: string; date: string };
  dedicated: { buildingId: string; date: string; jpAtDedication: number } | null;
  villager: boolean;                    // reversible [LOCKED]
}

export interface Building {
  id: string;                // unique instance id
  type: string;              // building type key
  name: string;
  gx: number; gy: number; w: number; h: number;
  stars: number;
  ledger: string[];          // hero ids, dedication order
}

export interface Deco {
  kind: 'path' | 'tree' | 'shrub';
  gx: number;
  gy: number;
}

export interface TavernCandidate {
  name: string;
  job: JobKey;
  charLevel: number;
  luck: number;
  taken: boolean;
}

// Onboarding steps (doc s.2 session-one shape)
export type OnboardStep =
  | 'chest'        // a chest at your feet
  | 'freeHero'     // one free hero, with a name
  | 'firstBattle'  // first battle + "this is your street" callout
  | 'townhall'     // kingdom unlocked, place the Town Hall
  | 'introDungeon' // the seeded intro dungeon
  | 'done';

export interface GameState {
  version: number;
  gold: number;
  wood: number;
  stone: number;
  crystal: number;            // dungeon-only material
  heroes: Hero[];
  buildings: Building[];
  decos: Deco[];
  tavern: { rolledAt: number; candidates: TavernCandidate[] };
  consumed: Record<string, string>;
  harvestedCells: Record<string, string>;  // walk-regen clamp: cell -> dayKey
  epicCheckpoint: Record<string, number>;  // dungeonKey -> floor reached
  lastSeen: number;
  admin: { enabled: boolean; pos: { lat: number; lon: number } | null };
  onboard: OnboardStep;
}

const KEY = 'ke3_save';

function defaultState(): GameState {
  return {
    version: 3,
    gold: 120,
    wood: 60,
    stone: 40,
    crystal: 0,
    heroes: [],
    buildings: [],  // kingdom starts EMPTY — Town Hall is placed in onboarding
    decos: [],
    tavern: { rolledAt: 0, candidates: [] },
    consumed: {},
    harvestedCells: {},
    epicCheckpoint: {},
    lastSeen: Date.now(),
    admin: { enabled: false, pos: null },
    onboard: 'chest',
  };
}

class Store {
  state: GameState = defaultState();

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.version === 3) this.state = { ...defaultState(), ...s };
      }
    } catch { /* fresh */ }
  }

  save(): void {
    try {
      this.state.lastSeen = Date.now();
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch { /* non-fatal */ }
  }

  reset(): void {
    this.state = defaultState();
    this.save();
  }

  // ---- derived ----
  hero(id: string): Hero | undefined {
    return this.state.heroes.find((h) => h.id === id);
  }

  building(idOrType: string): Building | undefined {
    return this.state.buildings.find((b) => b.id === idOrType || b.type === idOrType);
  }

  hasBuilding(type: string): boolean {
    return this.state.buildings.some((b) => b.type === type);
  }

  activeHeroes(): Hero[] {
    return this.state.heroes.filter((h) => !h.dedicated && !h.villager);
  }

  villagers(): Hero[] {
    return this.state.heroes.filter((h) => h.villager);
  }

  kingdomLevel(): number {
    const stars = this.state.buildings.reduce((a, b) => a + b.stars, 0);
    return 1 + Math.floor(stars / 2) + Math.floor(this.state.buildings.length / 4);
  }

  avgCharLevel(): number {
    const hs = this.activeHeroes();
    if (!hs.length) return 1;
    return Math.max(1, Math.round(hs.reduce((a, h) => a + h.charLevel, 0) / hs.length));
  }

  // Total JP EARNED by a hero across all jobs (1 per job level past 1).
  // This is "the only honest record of a hero's life" — gates dedication.
  totalJpEarned(h: Hero): number {
    return Object.values(h.jobs).reduce((a, j) => a + (j ? j.level - 1 : 0), 0);
  }

  maxStarReachable(h: Hero): number {
    const jp = this.totalJpEarned(h);
    let s = 0;
    for (let i = 0; i < STAR_JP_GATES.length; i++) {
      if (jp >= STAR_JP_GATES[i]) s = i + 1;
    }
    return s;
  }

  dedicationUnlocked(): boolean {
    return this.state.heroes.some((h) => this.totalJpEarned(h) >= 8);
  }

  // Offline production: flat per body (doc 14.4), capped [LOCKED]
  collectOffline(): { wood: number; stone: number; gold: number } {
    const bodies = this.villagers().length + this.state.buildings.filter((b) => b.type === 'house').length;
    const farms = this.state.buildings.filter((b) => b.type === 'farm').length;
    const hours = Math.min((Date.now() - this.state.lastSeen) / 3600000, OFFLINE_CAP_HOURS);
    const wood = Math.floor(hours * 5 * bodies);
    const stone = Math.floor(hours * 3 * bodies);
    const gold = Math.floor(hours * 2 * farms);
    this.state.wood += wood;
    this.state.stone += stone;
    this.state.gold += gold;
    return { wood, stone, gold };
  }
}

export const store = new Store();
