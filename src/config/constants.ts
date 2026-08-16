export const GAME_WIDTH = 375;
export const GAME_HEIGHT = 667;
export const TILE = 32;

// World map: viewport tiles + pan margin
export const VIEW_TX = Math.ceil(GAME_WIDTH / TILE);   // 12
export const VIEW_TY = Math.ceil(GAME_HEIGHT / TILE);  // 21
// generous margin so the map never runs out under a walking player: the
// world rebuilds around them at ~70m from the pin, and 24 tiles = 120m of
// drawn ground past the view in every direction
export const PAN_MARGIN = 24;
export const WORLD_TX = VIEW_TX + PAN_MARGIN * 2;
export const WORLD_TY = VIEW_TY + PAN_MARGIN * 2;
export const METERS_PER_TILE = 5;

// HARD RULE 5: nothing outside the ring is ever interactable. [LOCKED]
export const INTERACT_RADIUS_M = 100;

// Spawn density floor (doc 8.1): 4-6 interactables inside the ring
export const DENSITY_MIN = 4;
export const DENSITY_MAX = 6;

// Battle
export const BATTLE_COLS = 9;
export const BATTLE_ROWS = 12;
export const DEPLOY_CAP = 6; // [LOCKED]

// Dungeon tiers by real POI footprint (doc 9)
export const DUNGEON_TIERS = {
  short: { floors: 2, label: 'Short' },
  medium: { floors: 4, label: 'Medium' },
  epic: { floors: 8, label: 'Epic' }, // checkpoint at floor 4
} as const;
export type DungeonTier = keyof typeof DUNGEON_TIERS;
export const EPIC_CHECKPOINT_FLOOR = 4;

// Jobs
export const JOB_LEVEL_CAP = 30;          // 1 JP per job level [LOCKED]
export const SUBCLASS_JP_REQ = 15;        // JP in parent base job to enter subclass [LOCKED]
export const BRANCH_TIER_GATES = [5, 10, 15]; // points in a branch to climb it

// Dedication: star gates on TOTAL JP EARNED [LOCKED]
export const STAR_JP_GATES = [8, 16, 26, 40, 60]; // star 1..5
export const MAX_STARS = 5;
// Dedication unlocks once any hero crosses this JP threshold (doc s.2 rec)
export const DEDICATION_UNLOCK_JP = 8;

// Kingdom
export const OFFLINE_CAP_HOURS = 12; // [LOCKED]
export const TAVERN_SLOTS = 3;
export const TAVERN_COOLDOWN_MS = 6 * 3600 * 1000; // 6h [LOCKED]
export const TAVERN_REROLL_COST = 200;             // gold stands in for premium currency

// Economy
export const RESPEC_COST_PER_JOBLEVEL = 30; // cheap by design
