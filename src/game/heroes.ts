// Hero creation, stats, and the XP rules the design doc calls load-bearing:
// XP only from victories, scaled against enemy level so trash farming dies.

import { Hero, HeroClass, store } from '../core/save';
import { mulberry32, hashStr } from '../core/rng';
import { RESPEC_COST_PER_LEVEL } from '../config/constants';

export const CLASS_BASE: Record<HeroClass, { hp: number; atk: number; def: number; spd: number; range: number }> = {
  Knight: { hp: 130, atk: 12, def: 13, spd: 8, range: 1 },
  Archer: { hp: 85, atk: 16, def: 6, spd: 12, range: 3 },
  Mage:   { hp: 72, atk: 18, def: 5, spd: 9, range: 3 },
  Rogue:  { hp: 90, atk: 15, def: 7, spd: 14, range: 1 },
  Cleric: { hp: 80, atk: 8, def: 8, spd: 10, range: 2 },
};

export const CLASS_GROWTH: Record<HeroClass, { hp: number; atk: number; def: number }> = {
  Knight: { hp: 14, atk: 1.6, def: 1.6 },
  Archer: { hp: 8, atk: 2.2, def: 0.8 },
  Mage:   { hp: 7, atk: 2.4, def: 0.7 },
  Rogue:  { hp: 9, atk: 2.0, def: 0.9 },
  Cleric: { hp: 9, atk: 1.2, def: 1.1 },
};

const FIRST = ['Aldric', 'Brenna', 'Cassian', 'Dara', 'Edwin', 'Fiora', 'Garen', 'Hilde', 'Ivo', 'Joren',
  'Kira', 'Lucan', 'Mira', 'Nolan', 'Orla', 'Piers', 'Quinn', 'Rowan', 'Saskia', 'Tomas',
  'Una', 'Viktor', 'Wren', 'Yara', 'Zeph'];

export function heroName(seed: number): string {
  const r = mulberry32(seed);
  return FIRST[Math.floor(r() * FIRST.length)];
}

export function effectiveStats(h: Hero): { hp: number; atk: number; def: number; spd: number; range: number } {
  const b = CLASS_BASE[h.cls];
  const g = CLASS_GROWTH[h.cls];
  const lv = h.level - 1;
  return {
    hp: Math.round(b.hp + g.hp * lv + h.alloc.hp * 5),
    atk: Math.round(b.atk + g.atk * lv + h.alloc.atk * 1.5),
    def: Math.round(b.def + g.def * lv + h.alloc.def * 1.5),
    spd: b.spd + h.alloc.spd,
    range: b.range,
  };
}

export function xpToNext(level: number): number {
  return Math.floor(90 * Math.pow(level, 1.35));
}

// Design doc s.2: XP scales against enemy level; overleveled farming yields
// near-nothing. Ratio^1.6 makes a fight 5 levels below you nearly worthless.
export function xpForWin(heroLevel: number, enemyLevel: number, enemyCount: number): number {
  const ratio = Math.min(2, Math.max(0.08, enemyLevel / heroLevel));
  return Math.max(1, Math.floor(26 * enemyCount * Math.pow(ratio, 1.6)));
}

export function grantXp(h: Hero, amount: number): { leveled: number } {
  let leveled = 0;
  h.xp += amount;
  while (h.xp >= xpToNext(h.level)) {
    h.xp -= xpToNext(h.level);
    h.level++;
    h.statPoints += 3;
    leveled++;
  }
  return { leveled };
}

export function respecCost(h: Hero): number {
  return h.level * RESPEC_COST_PER_LEVEL;
}

export function respec(h: Hero): boolean {
  const cost = respecCost(h);
  if (store.state.gold < cost) return false;
  store.state.gold -= cost;
  const spent = h.alloc.hp + h.alloc.atk + h.alloc.def + h.alloc.spd;
  h.statPoints += spent;
  h.alloc = { hp: 0, atk: 0, def: 0, spd: 0 };
  store.save();
  return true;
}

let heroCounter = 0;

export function createHero(
  cls: HeroClass,
  level: number,
  recruitLabel: string,
  lat: number,
  lon: number
): Hero {
  const id = `h${Date.now()}_${heroCounter++}`;
  const h: Hero = {
    id,
    name: heroName(hashStr(id)),
    cls,
    level,
    xp: 0,
    statPoints: (level - 1) * 3,
    alloc: { hp: 0, atk: 0, def: 0, spd: 0 },
    recruit: { label: recruitLabel, date: new Date().toLocaleDateString(), lat, lon },
    dedicated: null,
  };
  return h;
}

// Tavern offers: quality gated by kingdom level (design doc s.2).
export function rollTavernOffers(kingdomLevel: number, daySeed: number): { name: string; cls: HeroClass; level: number; cost: number }[] {
  const r = mulberry32(daySeed);
  const pool: HeroClass[] = ['Knight', 'Archer'];
  if (kingdomLevel >= 2) pool.push('Rogue');
  if (kingdomLevel >= 3) pool.push('Mage');
  if (kingdomLevel >= 4) pool.push('Cleric');
  const offers = [];
  for (let i = 0; i < 3; i++) {
    const cls = pool[Math.floor(r() * pool.length)];
    const level = Math.max(1, kingdomLevel * 2 - 1 + Math.floor(r() * 3));
    offers.push({
      name: FIRST[Math.floor(r() * FIRST.length)],
      cls,
      level,
      cost: 100 + level * 40,
    });
  }
  return offers;
}
