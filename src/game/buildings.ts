// Building catalog (doc 14.2). Base job building at *3 unlocks its two
// subclass buildings [LOCKED]. Stars come only from dedication.

import { store } from '../core/save';

export interface BuildingType {
  type: string;
  name: string;
  w: number; h: number;
  cost: { wood: number; stone: number; gold: number };
  wall: number; roof: number;
  requiresBase?: string;   // base job building type that must be *3
  desc: string;
}

export const BUILDING_TYPES: Record<string, BuildingType> = {
  townhall: {
    type: 'townhall', name: 'Town Hall', w: 3, h: 3,
    cost: { wood: 0, stone: 0, gold: 0 },
    wall: 0xe8e0c8, roof: 0x4a6acc,
    desc: 'The seat of your kingdom. Everything begins here.',
  },
  tavern: {
    type: 'tavern', name: 'Waypoint Tavern', w: 3, h: 2,
    cost: { wood: 40, stone: 20, gold: 0 },
    wall: 0xd8c8a0, roof: 0xc07a30,
    desc: 'Travellers rest here. Recruiting needs their job\'s building.',
  },
  farm: {
    type: 'farm', name: 'Farm', w: 2, h: 2,
    cost: { wood: 30, stone: 10, gold: 0 },
    wall: 0xd8c890, roof: 0x8a9a3a,
    desc: 'Produces gold while you are away.',
  },
  house: {
    type: 'house', name: 'Cottage', w: 2, h: 2,
    cost: { wood: 35, stone: 20, gold: 0 },
    wall: 0xe0d0b0, roof: 0x3a8a4a,
    desc: 'Villagers live here and produce materials.',
  },
  storage: {
    type: 'storage', name: 'Storehouse', w: 2, h: 2,
    cost: { wood: 40, stone: 40, gold: 0 },
    wall: 0xb8a880, roof: 0x6a5a3a,
    desc: 'Extends offline production caps.',
  },
  memorial: {
    type: 'memorial', name: 'Memorial', w: 2, h: 2,
    cost: { wood: 10, stone: 60, gold: 50 },
    wall: 0xc8c8d8, roof: 0x9a9ab8,
    desc: 'A quiet place. The Wall of Honor is read here.',
  },
  // base job buildings
  knightschool: {
    type: 'knightschool', name: 'Knight School', w: 3, h: 2,
    cost: { wood: 60, stone: 40, gold: 30 },
    wall: 0xc8c8d0, roof: 0x8a3030,
    desc: 'Knights train here. ★3 unlocks Vanguard Hall and Bulwark Keep.',
  },
  thievesguild: {
    type: 'thievesguild', name: "Thieves' Guild", w: 3, h: 2,
    cost: { wood: 60, stone: 40, gold: 30 },
    wall: 0xa8a8b0, roof: 0x3a3a4a,
    desc: "Rogues gather here. ★3 unlocks Ranger's Lodge and Assassin's Den.",
  },
  magetower: {
    type: 'magetower', name: 'Mage Tower', w: 2, h: 3,
    cost: { wood: 40, stone: 60, gold: 30 },
    wall: 0xc0b8d8, roof: 0x6a4ac0,
    desc: 'Mages study here. ★3 unlocks Sorcerer\'s Sanctum and Cleric\'s Chapel.',
  },
  // subclass buildings — gated by base at *3 [LOCKED]
  vanguardhall: {
    type: 'vanguardhall', name: 'Vanguard Hall', w: 2, h: 2,
    cost: { wood: 80, stone: 60, gold: 60 }, requiresBase: 'knightschool',
    wall: 0xc8c0c0, roof: 0xa04030, desc: 'Greatswords and fury.',
  },
  bulwarkkeep: {
    type: 'bulwarkkeep', name: 'Bulwark Keep', w: 2, h: 2,
    cost: { wood: 60, stone: 90, gold: 60 }, requiresBase: 'knightschool',
    wall: 0xb8b8c8, roof: 0x703030, desc: 'The line that does not move.',
  },
  rangerslodge: {
    type: 'rangerslodge', name: "Ranger's Lodge", w: 2, h: 2,
    cost: { wood: 90, stone: 40, gold: 60 }, requiresBase: 'thievesguild',
    wall: 0xa8b090, roof: 0x2a4a3a, desc: 'Longbows and patience.',
  },
  assassinsden: {
    type: 'assassinsden', name: "Assassin's Den", w: 2, h: 2,
    cost: { wood: 70, stone: 60, gold: 60 }, requiresBase: 'thievesguild',
    wall: 0x909098, roof: 0x25252f, desc: 'You never saw it built.',
  },
  sorcerersanctum: {
    type: 'sorcerersanctum', name: "Sorcerer's Sanctum", w: 2, h: 2,
    cost: { wood: 50, stone: 80, gold: 60 }, requiresBase: 'magetower',
    wall: 0xb0a8d0, roof: 0x4a2aa0, desc: 'Meteors are studied here. Carefully.',
  },
  clericschapel: {
    type: 'clericschapel', name: "Cleric's Chapel", w: 2, h: 2,
    cost: { wood: 60, stone: 70, gold: 60 }, requiresBase: 'magetower',
    wall: 0xe0dcd0, roof: 0xc8b050, desc: 'Light for the wounded.',
  },
};

export function buildable(): BuildingType[] {
  return Object.values(BUILDING_TYPES).filter((bt) => {
    if (bt.type === 'townhall') return false; // placed in onboarding only
    if (bt.requiresBase) {
      const base = store.building(bt.requiresBase);
      if (!base || base.stars < 3) return false;
    }
    // one of each except house/farm
    if (!['house', 'farm'].includes(bt.type) && store.hasBuilding(bt.type)) return false;
    return true;
  });
}

export function lockedSubclassBuildings(): { bt: BuildingType; baseName: string; baseStars: number }[] {
  return Object.values(BUILDING_TYPES)
    .filter((bt) => bt.requiresBase && !store.hasBuilding(bt.type))
    .map((bt) => {
      const base = store.building(bt.requiresBase!);
      return {
        bt,
        baseName: BUILDING_TYPES[bt.requiresBase!].name,
        baseStars: base?.stars ?? 0,
      };
    })
    .filter((x) => x.baseStars < 3);
}
