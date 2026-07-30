// Hero lifecycle: creation, stats (job + tree + allocation), XP/JP earning,
// job switching, and building-gated tavern candidates.

import { Hero, JobProgress, TavernCandidate, store } from '../core/save';
import { JobKey, JOBS, jobTree, ULTIMATES, BASE_JOBS, ALL_JOBS } from './jobs';
import { mulberry32, hashStr } from '../core/rng';
import { JOB_LEVEL_CAP, SUBCLASS_JP_REQ, RESPEC_COST_PER_JOBLEVEL } from '../config/constants';

const NAMES = ['Aldric', 'Brenna', 'Cassian', 'Dara', 'Edwin', 'Fiora', 'Garen', 'Hilde', 'Ivo', 'Joren',
  'Kira', 'Lucan', 'Mira', 'Nolan', 'Orla', 'Piers', 'Quinn', 'Rowan', 'Saskia', 'Tomas',
  'Una', 'Viktor', 'Wren', 'Yara', 'Zeph', 'Bram', 'Celia', 'Doran', 'Elsa', 'Falk'];

let ctr = 0;

export function newJobProgress(): JobProgress {
  return { level: 1, xp: 0, jpSpent: [], jpUnspent: 0 };
}

export function createHero(job: JobKey, charLevel: number, recruitLabel: string): Hero {
  const id = `h${Date.now()}_${ctr++}`;
  const r = mulberry32(hashStr(id));
  const jobs: Hero['jobs'] = { [job]: newJobProgress() };
  // subclasses arrive carrying JP in the parent too (doc 5.6)
  const parent = JOBS[job].parent;
  if (parent) {
    const p = newJobProgress();
    p.level = Math.min(JOB_LEVEL_CAP, SUBCLASS_JP_REQ + 1);
    jobs[parent] = p;
  }
  return {
    id,
    name: NAMES[Math.floor(r() * NAMES.length)],
    job,
    charLevel,
    charXp: 0,
    statPoints: (charLevel - 1) * 2,
    alloc: { str: 0, dex: 0, int: 0 },
    luck: 1 + Math.floor(r() * 10), // innate, non-allocatable
    jobs,
    equippedUlt: 0,
    recruit: { label: recruitLabel, date: new Date().toLocaleDateString() },
    dedicated: null,
    villager: false,
  };
}

export interface EffStats {
  hp: number; atk: number; def: number;
  attackInterval: number; range: number;
  crit: number; ultCost: number; magic: boolean;
}

export function effStats(h: Hero): EffStats {
  const def = JOBS[h.job];
  const jp = h.jobs[h.job] ?? newJobProgress();
  const tree = jobTree(h.job);
  let atkPct = 0, hpPct = 0, flatDef = 0, speedRed = 0, costRed = 0, crit = h.luck;
  for (const nodeId of jp.jpSpent) {
    const n = tree.find((x) => x.id === nodeId);
    if (!n) continue;
    if (n.effect.t === 'atk') atkPct += n.effect.v;
    else if (n.effect.t === 'hp') hpPct += n.effect.v;
    else if (n.effect.t === 'def') flatDef += n.effect.v;
    else if (n.effect.t === 'speed') speedRed += n.effect.v;
    else if (n.effect.t === 'ultcost') costRed += n.effect.v;
    else if (n.effect.t === 'crit') crit += n.effect.v;
  }
  const primary = def.magic ? h.alloc.int : def.school === 'rogue' ? h.alloc.dex : h.alloc.str;
  const ultKey = def.ultimates[h.equippedUlt] ?? def.ultimates[0];
  return {
    hp: Math.round((def.baseHp + def.hpGrowth * (h.charLevel - 1) + jp.level * 3) * (1 + hpPct / 100)),
    atk: Math.round((def.baseAtk + def.atkGrowth * (jp.level - 1) + primary * 1.6) * (1 + atkPct / 100)),
    def: def.baseDef + Math.floor(h.charLevel / 3) + flatDef + Math.floor(h.alloc.str / 2),
    attackInterval: Math.max(1, def.attackInterval - speedRed - Math.floor(h.alloc.dex / 5)),
    range: def.range,
    crit,
    ultCost: Math.max(15, ULTIMATES[ultKey].cost - costRed),
    magic: def.magic,
  };
}

// ---- XP / JP (HARD RULES 1-2: wins only, scaled vs enemy level) ----

export function charXpToNext(level: number): number {
  return Math.floor(80 * Math.pow(level, 1.35));
}
export function jobXpToNext(level: number): number {
  return Math.floor(50 * Math.pow(level, 1.25));
}

export function xpForWin(heroLevel: number, enemyLevel: number, enemyCount: number): number {
  const ratio = Math.min(2, Math.max(0.08, enemyLevel / heroLevel));
  return Math.max(1, Math.floor(24 * enemyCount * Math.pow(ratio, 1.6)));
}

export function grantWinXp(h: Hero, enemyLevel: number, enemyCount: number): string {
  const xp = xpForWin(h.charLevel, enemyLevel, enemyCount);
  h.charXp += xp;
  let ups = 0;
  while (h.charXp >= charXpToNext(h.charLevel)) {
    h.charXp -= charXpToNext(h.charLevel);
    h.charLevel++;
    h.statPoints += 2;
    ups++;
  }
  // job xp: same wins feed the worn job. 1 JP per job level. [LOCKED]
  const jp = h.jobs[h.job] ?? (h.jobs[h.job] = newJobProgress());
  let jpGained = 0;
  if (jp.level < JOB_LEVEL_CAP) {
    jp.xp += Math.ceil(xp * 0.8);
    while (jp.level < JOB_LEVEL_CAP && jp.xp >= jobXpToNext(jp.level)) {
      jp.xp -= jobXpToNext(jp.level);
      jp.level++;
      jp.jpUnspent++;
      jpGained++;
    }
  }
  return `${h.name} +${xp}xp${ups ? ` →Lv${h.charLevel}` : ''}${jpGained ? ` +${jpGained}JP` : ''}`;
}

// ---- job switching (doc 5.4: JP banks into worn job; tree progress permanent) ----

export function canWearJob(h: Hero, job: JobKey): { ok: boolean; why: string } {
  const def = JOBS[job];
  if (!store.hasBuilding(def.building)) return { ok: false, why: `Requires the ${def.buildingName}` };
  if (def.parent) {
    const parentProg = h.jobs[def.parent];
    const parentJp = parentProg ? parentProg.level - 1 : 0;
    if (parentJp < SUBCLASS_JP_REQ) return { ok: false, why: `Needs ${SUBCLASS_JP_REQ} JP as ${def.parent} (has ${parentJp})` };
  }
  return { ok: true, why: '' };
}

export function wearJob(h: Hero, job: JobKey): void {
  if (!h.jobs[job]) h.jobs[job] = newJobProgress();
  h.job = job;
  h.equippedUlt = 0;
}

export function respecCost(h: Hero): number {
  const jp = h.jobs[h.job];
  return (jp?.level ?? 1) * RESPEC_COST_PER_JOBLEVEL;
}

export function respecJob(h: Hero): boolean {
  const cost = respecCost(h);
  if (store.state.gold < cost) return false;
  const jp = h.jobs[h.job];
  if (!jp) return false;
  store.state.gold -= cost;
  jp.jpUnspent += jp.jpSpent.length;
  jp.jpSpent = [];
  h.equippedUlt = 0;
  store.save();
  return true;
}

// ---- tavern (doc 13): free, anyone can appear, building-gated recruiting ----

export function rollTavern(seed: number): TavernCandidate[] {
  const r = mulberry32(seed);
  const avg = store.avgCharLevel();
  const out: TavernCandidate[] = [];
  for (let i = 0; i < 3; i++) {
    // bias to base jobs, but subclasses CAN appear — seeing what you can't
    // recruit is the mechanic (doc 13)
    const pool: JobKey[] = r() < 0.65 ? BASE_JOBS : ALL_JOBS;
    const job = pool[Math.floor(r() * pool.length)];
    out.push({
      name: NAMES[Math.floor(r() * NAMES.length)],
      job,
      charLevel: Math.max(1, avg - 1 + Math.floor(r() * 3)),
      luck: 1 + Math.floor(r() * 10),
      taken: false,
    });
  }
  return out;
}

export function canRecruit(c: TavernCandidate): { ok: boolean; why: string } {
  const def = JOBS[c.job];
  if (!store.hasBuilding(def.building)) {
    return { ok: false, why: `Build the ${def.buildingName}` };
  }
  return { ok: true, why: '' };
}
