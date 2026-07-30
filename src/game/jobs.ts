// Nine jobs, three schools, job trees, ultimates.
// Trees are simplified for the prototype: trunk signature ultimate + three
// branches of 5 passive nodes each, tier-gated at 5/10/15 points; each branch
// tip unlocks that branch's ultimate (4 ultimates per job, one equipped).
// Crossover nodes and mastery slots are deferred (noted in the doc as v-next).

export type School = 'knight' | 'rogue' | 'mage';

export type JobKey =
  | 'Knight' | 'Vanguard' | 'Bulwark'
  | 'Rogue' | 'Ranger' | 'Assassin'
  | 'Mage' | 'Sorcerer' | 'Cleric';

export type Targeting = 'nearest' | 'backline' | 'lowestHp' | 'cluster' | 'lowestAlly';

export interface JobDef {
  key: JobKey;
  school: School;
  parent: JobKey | null;      // null = base job
  building: string;           // building id that gates recruitment / job entry
  buildingName: string;
  range: number;              // tiles
  targeting: Targeting;
  manaFrom: 'attack' | 'damageTaken' | 'damageDealt';
  baseHp: number; hpGrowth: number;
  baseAtk: number; atkGrowth: number;
  baseDef: number;
  attackInterval: number;     // combat ticks between attacks (DEX reduces)
  magic: boolean;
  branches: [string, string, string]; // branch names (doc 5.2)
  ultimates: [UltimateKey, UltimateKey, UltimateKey, UltimateKey]; // trunk + 3 branch tips
}

export type UltimateKey =
  | 'ShieldWall' | 'Fury' | 'Rally' | 'Banner'
  | 'Onslaught' | 'Bloodlust' | 'Breaker' | 'WarCry'
  | 'Retribution' | 'Aegis' | 'Anchor' | 'Phalanx'
  | 'Flurry' | 'ShadowStep' | 'VenomFang' | 'Eviscerate'
  | 'Volley' | 'Camouflage' | 'Snare' | 'Longshot'
  | 'Execution' | 'Evasion' | 'Garrote' | 'DeathMark'
  | 'Immolate' | 'Ward' | 'FrostNova' | 'Fireball'
  | 'Meteor' | 'GlacialField' | 'ChainBolt' | 'Absorb'
  | 'Judgement' | 'Sanctuary' | 'Restoration' | 'Smite';

export interface UltimateDef {
  key: UltimateKey;
  name: string;
  cost: number;          // mana threshold; fires and resets to zero
  desc: string;
  kind: 'damage' | 'aoe' | 'heal' | 'buff' | 'terrain';
  power: number;         // multiplier vs ATK (or heal fraction)
  radius?: number;
  terrainFx?: 'burnTrees' | 'freezeWater' | 'breakObstacles';
}

export const ULTIMATES: Record<UltimateKey, UltimateDef> = {
  // Knight school
  ShieldWall:  { key: 'ShieldWall', name: 'Shield Wall', cost: 50, kind: 'buff', power: 0.35, desc: 'Harden: allies nearby take less damage' },
  Fury:        { key: 'Fury', name: 'Fury Strike', cost: 45, kind: 'damage', power: 2.6, desc: 'Massive single blow' },
  Rally:       { key: 'Rally', name: 'Rally', cost: 60, kind: 'heal', power: 0.2, radius: 2, desc: 'Nearby allies recover HP' },
  Banner:      { key: 'Banner', name: 'War Banner', cost: 70, kind: 'buff', power: 0.3, radius: 2, desc: 'Plant a banner: allies near it hit harder' },
  Onslaught:   { key: 'Onslaught', name: 'Onslaught', cost: 60, kind: 'aoe', power: 1.7, radius: 1, desc: 'Cleave everything adjacent' },
  Bloodlust:   { key: 'Bloodlust', name: 'Bloodlust', cost: 55, kind: 'buff', power: 0.5, desc: 'Attack speed surges' },
  Breaker:     { key: 'Breaker', name: 'Line Breaker', cost: 65, kind: 'damage', power: 3.0, desc: 'Crushing blow that ignores defence' },
  WarCry:      { key: 'WarCry', name: 'War Cry', cost: 55, kind: 'aoe', power: 1.2, radius: 2, desc: 'Shout that staggers nearby foes' },
  Retribution: { key: 'Retribution', name: 'Retribution', cost: 55, kind: 'damage', power: 2.2, desc: 'Return stored pain as one strike' },
  Aegis:       { key: 'Aegis', name: 'Aegis', cost: 60, kind: 'buff', power: 0.5, desc: 'A shield that absorbs the next blows' },
  Anchor:      { key: 'Anchor', name: 'Anchor', cost: 70, kind: 'buff', power: 0.4, radius: 2, desc: 'Hold the line: nearby allies rooted and hardened' },
  Phalanx:     { key: 'Phalanx', name: 'Phalanx', cost: 75, kind: 'buff', power: 0.45, radius: 2, desc: 'Wall of spears guards the rank' },
  // Rogue school
  Flurry:      { key: 'Flurry', name: 'Flurry', cost: 30, kind: 'damage', power: 1.6, desc: 'A blur of dagger strikes (fires often)' },
  ShadowStep:  { key: 'ShadowStep', name: 'Shadow Step', cost: 40, kind: 'damage', power: 2.0, desc: 'Blink behind the target and strike' },
  VenomFang:   { key: 'VenomFang', name: 'Venom Fang', cost: 45, kind: 'damage', power: 2.4, desc: 'Poisoned blade bites deep' },
  Eviscerate:  { key: 'Eviscerate', name: 'Eviscerate', cost: 50, kind: 'damage', power: 2.8, desc: 'Open an artery' },
  Volley:      { key: 'Volley', name: 'Volley', cost: 45, kind: 'aoe', power: 1.3, radius: 1, desc: 'Arrows rain on the target and its neighbours' },
  Camouflage:  { key: 'Camouflage', name: 'Camouflage', cost: 50, kind: 'buff', power: 0.6, desc: 'Fade: harder to hit for a while' },
  Snare:       { key: 'Snare', name: 'Snare Trap', cost: 55, kind: 'aoe', power: 1.5, radius: 1, desc: 'Trap that outlives its caster' },
  Longshot:    { key: 'Longshot', name: 'Longshot', cost: 60, kind: 'damage', power: 3.2, desc: 'One arrow, the length of the field' },
  Execution:   { key: 'Execution', name: 'Execution', cost: 65, kind: 'damage', power: 3.6, desc: 'The lowest-HP enemy meets the knife' },
  Evasion:     { key: 'Evasion', name: 'Evasion', cost: 45, kind: 'buff', power: 0.7, desc: 'Untouchable for a few heartbeats' },
  Garrote:     { key: 'Garrote', name: 'Garrote', cost: 55, kind: 'damage', power: 2.9, desc: 'Silent, from behind' },
  DeathMark:   { key: 'DeathMark', name: 'Death Mark', cost: 70, kind: 'damage', power: 3.4, desc: 'Mark them. End them.' },
  // Mage school — includes the three terrain-reshaping demo ultimates
  Immolate:    { key: 'Immolate', name: 'Immolate', cost: 60, kind: 'terrain', power: 1.6, radius: 1, terrainFx: 'burnTrees', desc: 'Fire that SPREADS through real tree cover, burning it away' },
  Ward:        { key: 'Ward', name: 'Ward', cost: 50, kind: 'buff', power: 0.4, desc: 'Arcane shell over nearby allies' },
  FrostNova:   { key: 'FrostNova', name: 'Frost Nova', cost: 55, kind: 'aoe', power: 1.4, radius: 1, desc: 'Cold snap around the caster' },
  Fireball:    { key: 'Fireball', name: 'Fireball', cost: 50, kind: 'aoe', power: 1.8, radius: 1, desc: 'The classic' },
  Meteor:      { key: 'Meteor', name: 'Meteor', cost: 110, kind: 'terrain', power: 3.0, radius: 2, terrainFx: 'breakObstacles', desc: 'Falling star that PERMANENTLY destroys obstacles' },
  GlacialField:{ key: 'GlacialField', name: 'Glacial Field', cost: 80, kind: 'terrain', power: 1.2, radius: 2, terrainFx: 'freezeWater', desc: 'Freezes water into walkable ground' },
  ChainBolt:   { key: 'ChainBolt', name: 'Chain Bolt', cost: 65, kind: 'aoe', power: 1.5, radius: 2, desc: 'Lightning leaps between clustered foes' },
  Absorb:      { key: 'Absorb', name: 'Absorption', cost: 60, kind: 'buff', power: 0.5, desc: 'Drink the next spells aimed your way' },
  Judgement:   { key: 'Judgement', name: 'Judgement', cost: 70, kind: 'damage', power: 2.6, desc: 'Holy verdict on one foe' },
  Sanctuary:   { key: 'Sanctuary', name: 'Sanctuary', cost: 75, kind: 'heal', power: 0.35, radius: 2, desc: 'Consecrated ground mends allies' },
  Restoration: { key: 'Restoration', name: 'Restoration', cost: 60, kind: 'heal', power: 0.45, desc: 'Fully mend the most wounded ally' },
  Smite:       { key: 'Smite', name: 'Smite', cost: 45, kind: 'damage', power: 2.0, desc: 'The mace remembers' },
};

export const JOBS: Record<JobKey, JobDef> = {
  Knight: {
    key: 'Knight', school: 'knight', parent: null,
    building: 'knightschool', buildingName: 'Knight School',
    range: 1, targeting: 'nearest', manaFrom: 'damageTaken',
    baseHp: 140, hpGrowth: 13, baseAtk: 13, atkGrowth: 1.7, baseDef: 12,
    attackInterval: 3, magic: false,
    branches: ['Fury', 'Guard', 'Banner'],
    ultimates: ['ShieldWall', 'Fury', 'Rally', 'Banner'],
  },
  Vanguard: {
    key: 'Vanguard', school: 'knight', parent: 'Knight',
    building: 'vanguardhall', buildingName: 'Vanguard Hall',
    range: 1, targeting: 'nearest', manaFrom: 'attack',
    baseHp: 120, hpGrowth: 11, baseAtk: 18, atkGrowth: 2.3, baseDef: 8,
    attackInterval: 3, magic: false,
    branches: ['Onslaught', 'Bloodlust', 'Breaker'],
    ultimates: ['WarCry', 'Onslaught', 'Bloodlust', 'Breaker'],
  },
  Bulwark: {
    key: 'Bulwark', school: 'knight', parent: 'Knight',
    building: 'bulwarkkeep', buildingName: 'Bulwark Keep',
    range: 1, targeting: 'backline', manaFrom: 'damageTaken',
    baseHp: 170, hpGrowth: 16, baseAtk: 10, atkGrowth: 1.3, baseDef: 16,
    attackInterval: 4, magic: false,
    branches: ['Retribution', 'Aegis', 'Anchor'],
    ultimates: ['Phalanx', 'Retribution', 'Aegis', 'Anchor'],
  },
  Rogue: {
    key: 'Rogue', school: 'rogue', parent: null,
    building: 'thievesguild', buildingName: "Thieves' Guild",
    range: 1, targeting: 'nearest', manaFrom: 'attack',
    baseHp: 95, hpGrowth: 8, baseAtk: 15, atkGrowth: 2.0, baseDef: 7,
    attackInterval: 2, magic: false,
    branches: ['Finesse', 'Shadow', 'Venom'],
    ultimates: ['Flurry', 'ShadowStep', 'Eviscerate', 'VenomFang'],
  },
  Ranger: {
    key: 'Ranger', school: 'rogue', parent: 'Rogue',
    building: 'rangerslodge', buildingName: "Ranger's Lodge",
    range: 4, targeting: 'nearest', manaFrom: 'attack',
    baseHp: 85, hpGrowth: 7, baseAtk: 16, atkGrowth: 2.1, baseDef: 6,
    attackInterval: 3, magic: false,
    branches: ['Volley', 'Camouflage', 'Trapper'],
    ultimates: ['Longshot', 'Volley', 'Camouflage', 'Snare'],
  },
  Assassin: {
    key: 'Assassin', school: 'rogue', parent: 'Rogue',
    building: 'assassinsden', buildingName: "Assassin's Den",
    range: 1, targeting: 'lowestHp', manaFrom: 'attack',
    baseHp: 90, hpGrowth: 7, baseAtk: 19, atkGrowth: 2.5, baseDef: 6,
    attackInterval: 2, magic: false,
    branches: ['Execution', 'Evasion', 'Silence'],
    ultimates: ['DeathMark', 'Execution', 'Evasion', 'Garrote'],
  },
  Mage: {
    key: 'Mage', school: 'mage', parent: null,
    building: 'magetower', buildingName: 'Mage Tower',
    range: 3, targeting: 'nearest', manaFrom: 'attack',
    baseHp: 75, hpGrowth: 6, baseAtk: 18, atkGrowth: 2.4, baseDef: 5,
    attackInterval: 3, magic: true,
    branches: ['Flame', 'Ward', 'Frost'],
    ultimates: ['Fireball', 'Immolate', 'Ward', 'FrostNova'],
  },
  Sorcerer: {
    key: 'Sorcerer', school: 'mage', parent: 'Mage',
    building: 'sorcerersanctum', buildingName: "Sorcerer's Sanctum",
    range: 3, targeting: 'cluster', manaFrom: 'attack',
    baseHp: 70, hpGrowth: 5, baseAtk: 21, atkGrowth: 2.8, baseDef: 4,
    attackInterval: 4, magic: true,
    branches: ['Cataclysm', 'Absorption', 'Chain'],
    ultimates: ['GlacialField', 'Meteor', 'Absorb', 'ChainBolt'],
  },
  Cleric: {
    key: 'Cleric', school: 'mage', parent: 'Mage',
    building: 'clericschapel', buildingName: "Cleric's Chapel",
    range: 3, targeting: 'lowestAlly', manaFrom: 'damageDealt',
    baseHp: 90, hpGrowth: 8, baseAtk: 10, atkGrowth: 1.4, baseDef: 8,
    attackInterval: 3, magic: true,
    branches: ['Judgement', 'Sanctuary', 'Restoration'],
    ultimates: ['Smite', 'Judgement', 'Sanctuary', 'Restoration'],
  },
};

export const BASE_JOBS: JobKey[] = ['Knight', 'Rogue', 'Mage'];
export const ALL_JOBS = Object.keys(JOBS) as JobKey[];

// ---- tree nodes: 5 per branch, tier-gated. Node effects are passives. ----
export type NodeEffect =
  | { t: 'atk'; v: number }      // +% attack
  | { t: 'hp'; v: number }       // +% hp
  | { t: 'def'; v: number }      // flat defence
  | { t: 'speed'; v: number }    // -ticks attack interval (min 1)
  | { t: 'ultcost'; v: number }  // -flat ultimate cost
  | { t: 'crit'; v: number };    // +% crit chance

export interface TreeNode {
  id: string;         // `${branchIdx}-${slot}`
  branch: number;     // 0..2
  slot: number;       // 0..4  (cost 1 JP each; slot n requires tier gates)
  name: string;
  effect: NodeEffect;
}

// One shared node template per branch position; names flavored per branch.
const NODE_EFFECTS: NodeEffect[][] = [
  // per-branch effect ladders (slot 0..4)
  [{ t: 'atk', v: 6 }, { t: 'atk', v: 8 }, { t: 'crit', v: 5 }, { t: 'atk', v: 10 }, { t: 'ultcost', v: 8 }],
  [{ t: 'hp', v: 8 }, { t: 'def', v: 3 }, { t: 'hp', v: 10 }, { t: 'def', v: 5 }, { t: 'ultcost', v: 8 }],
  [{ t: 'speed', v: 0 }, { t: 'hp', v: 6 }, { t: 'crit', v: 4 }, { t: 'speed', v: 1 }, { t: 'ultcost', v: 10 }],
];

export function jobTree(job: JobKey): TreeNode[] {
  const def = JOBS[job];
  const nodes: TreeNode[] = [];
  for (let b = 0; b < 3; b++) {
    for (let s = 0; s < 5; s++) {
      nodes.push({
        id: `${b}-${s}`,
        branch: b,
        slot: s,
        name: `${def.branches[b]} ${['I', 'II', 'III', 'IV', 'V'][s]}`,
        effect: NODE_EFFECTS[b][s],
      });
    }
  }
  return nodes;
}

// slot gating: slot s needs (s) points already in that branch AND global
// tier gates: slots 0-1 free tier, 2-3 need 5 pts in branch? Simplified:
// slot s requires s prior points in the same branch (linear climb).
export function nodeAvailable(slot: number, pointsInBranch: number): boolean {
  return pointsInBranch >= slot;
}
