export const GAME_WIDTH = 375;
export const GAME_HEIGHT = 667;

export const TILE = 32;

// World map: tiles visible plus a pan margin on every side
export const VIEW_TX = Math.ceil(GAME_WIDTH / TILE);   // 12
export const VIEW_TY = Math.ceil(GAME_HEIGHT / TILE);  // 21
export const PAN_MARGIN = 8;
export const WORLD_TX = VIEW_TX + PAN_MARGIN * 2;
export const WORLD_TY = VIEW_TY + PAN_MARGIN * 2;

// Real-world scale
export const METERS_PER_TILE = 5;

// Design doc: interaction radius 100m (playtest 40m)
export const INTERACT_RADIUS_M = 100;

// Battle
export const BATTLE_COLS = 9;
export const BATTLE_ROWS = 12;
export const DEPLOY_CAP = 5;        // design doc open number: chose 5
export const DUNGEON_FLOORS = 3;    // design doc open number: chose 3

// Kingdom
export const OFFLINE_CAP_HOURS = 8; // design doc open number: chose 8h
export const MAX_STARS = 5;
// Star N requires a dedicated hero of at least level N*10
export const starLevelRequirement = (nextStar: number) => nextStar * 10;

// Economy
export const RESPEC_COST_PER_LEVEL = 25; // cheap by design ("inconvenience, not a decision")
export const TAVERN_REFRESH_COST = 150;
