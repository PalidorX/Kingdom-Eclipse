// Tactical auto-battler on a grid generated from the real ground (HARD RULE 7).
// Silhouette setup, elite modifier tags, one equipped ultimate per hero,
// terrain-reshaping ultimates (Immolate/Glacial Field/Meteor — the demo),
// tiered floors with permadeath-within-run and an epic halfway checkpoint.

import Phaser from 'phaser';
import { ZOOM } from '../core/zoom';
import {
  GAME_WIDTH, GAME_HEIGHT, TILE, BATTLE_COLS, BATTLE_ROWS, DEPLOY_CAP,
  EPIC_CHECKPOINT_FLOOR, DungeonTier,
} from '../config/constants';
import { store, Hero } from '../core/save';
import { effStats, grantWinXp } from '../game/heroes';
import { JOBS, ULTIMATES, UltimateDef } from '../game/jobs';
import { bakeAllSprites, MONSTER_SPRITES } from '../game/sprites';
import { makeButton, toast, UI_DEPTH } from '../game/ui';
import { mulberry32, hashStr, dayKey } from '../core/rng';

interface Launch {
  mode: 'monster' | 'boss' | 'dungeon';
  enemyLevel: number;
  floors: number;
  tier?: DungeonTier;
  terrain: string[][];
  rewardKey: string;
  label: string;
  intro?: string;
}

type EliteTag = 'Frenzied' | 'Warded' | null;

interface Unit {
  side: 'player' | 'enemy';
  heroId?: string;
  name: string;
  archetype: string; // for silhouette label
  elite: EliteTag;
  gx: number; gy: number;
  hp: number; maxHp: number;
  atk: number; def: number;
  attackInterval: number; cd: number;
  range: number;
  mana: number; ultCost: number; ult?: UltimateDef;
  crit: number;
  shield: number;          // absorb pool
  atkBuffTicks: number; defBuffTicks: number; hasteTicks: number;
  boss: boolean;
  sprKey: string;
  obj: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  dead: boolean;
}

type Cell = { walkable: boolean; deco?: 'tree' | 'rock' | 'wall'; fire?: number; frozen?: boolean };

const GRID_X = (GAME_WIDTH - BATTLE_COLS * TILE) / 2;
const GRID_Y = 96;

export class BattleScene extends Phaser.Scene {
  private launch!: Launch;
  private grid: Cell[][] = [];
  private units: Unit[] = [];
  private floor = 1;
  private phase: 'setup' | 'combat' | 'done' = 'setup';
  private runRoster: Map<string, { hp: number }> = new Map();
  private checkpointRoster: Map<string, { hp: number }> | null = null;
  private benchObjs: Phaser.GameObjects.Container[] = [];
  private placed: Set<string> = new Set();
  private statusText!: Phaser.GameObjects.Text;
  private tickEvent: Phaser.Time.TimerEvent | null = null;
  private speed2x = false;
  private decoG!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
  private groundRT!: Phaser.GameObjects.RenderTexture;

  constructor() { super({ key: 'BattleScene' }); }

  init(data: Launch): void {
    this.launch = data;
    this.floor = 1;
    this.resetRunRoster();
    this.checkpointRoster = null;
  }

  private resetRunRoster(): void {
    this.runRoster = new Map();
    store.activeHeroes().forEach((h) => this.runRoster.set(h.id, { hp: effStats(h).hp }));
  }

  create(): void {
    bakeAllSprites(this);
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    this.defineTiles();
    this.buildFloor();
  }

  private defineTiles(): void {
    const tex = this.textures.get('world-tileset');
    const cell = (name: string, c: number, r: number) => {
      if (!tex.has(name)) tex.add(name, 0, c * 32, r * 32, 32, 32);
    };
    cell('t_grass', 0, 0);
    cell('clean_water', 1, 0);
    cell('clean_forest', 2, 0);
    cell('clean_road', 3, 0);
    cell('clean_sand', 4, 0);
    cell('clean_mountain', 5, 0);
    cell('clean_park', 1, 14);
    cell('clean_res', 2, 14);
    cell('clean_com', 3, 14);
    cell('clean_ind', 4, 14);
    cell('clean_civ', 5, 14);
  }

  // ---------------- floor construction ----------------

  private buildFloor(): void {
    this.children.removeAll();
    this.units = [];
    this.benchObjs = [];
    this.placed = new Set();
    this.phase = 'setup';
    if (this.tickEvent) { this.tickEvent.remove(); this.tickEvent = null; }

    this.genGrid();
    this.renderGround();
    this.decoG = this.add.graphics().setDepth(5);
    this.fxG = this.add.graphics().setDepth(120);
    this.redrawDecos();
    this.spawnEnemies();
    this.renderBench();
    this.renderChrome();

    if (this.launch.intro === 'firstBattle' && this.floor === 1) {
      const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 160,
        'This battlefield was generated from\nTHE ACTUAL GROUND YOU ARE STANDING ON.\nRoads are lanes. Trees are cover. Water blocks.', {
          fontSize: '10px', color: '#66ddff', fontFamily: 'monospace', align: 'center',
          backgroundColor: '#001a22ee', padding: { x: 8, y: 6 }, lineSpacing: 3,
        }).setOrigin(0.5, 1).setDepth(UI_DEPTH + 5);
      this.tweens.add({ targets: t, alpha: 0, delay: 6000, duration: 800, onComplete: () => t.destroy() });
    }
  }

  private genGrid(): void {
    const r = mulberry32(hashStr(`${this.launch.rewardKey}|f${this.floor}`));
    this.grid = [];
    for (let y = 0; y < BATTLE_ROWS; y++) {
      this.grid[y] = [];
      for (let x = 0; x < BATTLE_COLS; x++) {
        const t = this.launch.terrain[y]?.[x] ?? 'grass';
        let cell: Cell = { walkable: true };
        if (t === 'water') cell = { walkable: false };
        else if (t === 'mountain') cell = { walkable: false, deco: 'wall' };
        else if (t === 'forest' && r() < 0.5) cell = { walkable: false, deco: 'tree' };
        else if ((t === 'grass' || t === 'park') && r() < 0.07) cell = { walkable: false, deco: 'tree' };
        else if (['res', 'com', 'ind', 'civ'].includes(t) && r() < 0.12) cell = { walkable: false, deco: 'rock' }; // ruin rubble as cover
        this.grid[y][x] = cell;
      }
    }
    for (let i = 0; i < (this.floor - 1); i++) {
      const x = Math.floor(r() * BATTLE_COLS);
      const y = 3 + Math.floor(r() * (BATTLE_ROWS - 6));
      this.grid[y][x] = { walkable: false, deco: 'rock' };
    }
    for (let x = 0; x < BATTLE_COLS; x++) {
      this.grid[0][x] = { walkable: true };
      this.grid[1][x] = { walkable: true };
      this.grid[BATTLE_ROWS - 1][x] = { walkable: true };
      this.grid[BATTLE_ROWS - 2][x] = { walkable: true };
    }
    this.ensureConnectivity();
  }

  private ensureConnectivity(): void {
    const seen = new Set<string>();
    const q: [number, number][] = [];
    for (let x = 0; x < BATTLE_COLS; x++) { q.push([x, BATTLE_ROWS - 1]); seen.add(`${x},${BATTLE_ROWS - 1}`); }
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= BATTLE_COLS || ny >= BATTLE_ROWS) continue;
        const k = `${nx},${ny}`;
        if (seen.has(k) || !this.grid[ny][nx].walkable) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    if (!seen.has(`${Math.floor(BATTLE_COLS / 2)},0`)) {
      const cx = Math.floor(BATTLE_COLS / 2);
      for (let y = 0; y < BATTLE_ROWS; y++) this.grid[y][cx] = { walkable: true };
    }
  }

  private renderGround(): void {
    this.groundRT = this.add.renderTexture(GRID_X, GRID_Y, BATTLE_COLS * TILE, BATTLE_ROWS * TILE).setOrigin(0, 0);
    for (let y = 0; y < BATTLE_ROWS; y++) {
      for (let x = 0; x < BATTLE_COLS; x++) {
        const t = this.launch.terrain[y]?.[x] ?? 'grass';
        const frame =
          t === 'water' ? 'clean_water' :
          t === 'path' ? 'clean_road' :
          t === 'sand' ? 'clean_sand' :
          t === 'mountain' ? 'clean_mountain' :
          t === 'park' ? 'clean_park' :
          t === 'res' ? 'clean_res' :
          t === 'com' ? 'clean_com' :
          t === 'ind' ? 'clean_ind' :
          t === 'civ' ? 'clean_civ' :
          't_grass'; // forest floors render grass; the trees are obstacle decos
        this.groundRT.drawFrame('world-tileset', frame, x * TILE, y * TILE);
      }
    }
    const g = this.add.graphics().setDepth(2);
    for (let y = 0; y <= BATTLE_ROWS; y++) g.lineStyle(1, 0x000000, 0.1).lineBetween(GRID_X, GRID_Y + y * TILE, GRID_X + BATTLE_COLS * TILE, GRID_Y + y * TILE);
    for (let x = 0; x <= BATTLE_COLS; x++) g.lineStyle(1, 0x000000, 0.1).lineBetween(GRID_X + x * TILE, GRID_Y, GRID_X + x * TILE, GRID_Y + BATTLE_ROWS * TILE);
    g.fillStyle(0x4488ff, 0.12);
    g.fillRect(GRID_X, GRID_Y + (BATTLE_ROWS - 3) * TILE, BATTLE_COLS * TILE, 3 * TILE);
  }

  private redrawDecos(): void {
    this.decoG.clear();
    for (let y = 0; y < BATTLE_ROWS; y++) {
      for (let x = 0; x < BATTLE_COLS; x++) {
        const c = this.grid[y][x];
        const px = GRID_X + x * TILE, py = GRID_Y + y * TILE;
        if (c.frozen) {
          this.decoG.fillStyle(0xbfe8ff, 0.85);
          this.decoG.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          this.decoG.fillStyle(0xffffff, 0.5);
          this.decoG.fillRect(px + 4, py + 4, 8, 3);
        }
        if (c.deco === 'tree') {
          this.decoG.fillStyle(0x1e5a28, 1);
          this.decoG.fillCircle(px + 16, py + 12, 10);
          this.decoG.fillStyle(0x2f7a38, 1);
          this.decoG.fillCircle(px + 12, py + 9, 6);
          this.decoG.fillStyle(0x5a3a1a, 1);
          this.decoG.fillRect(px + 14, py + 20, 4, 8);
        } else if (c.deco === 'rock') {
          this.decoG.fillStyle(0x5a4a6a, 1);
          this.decoG.fillRect(px + 6, py + 10, 20, 16);
          this.decoG.fillStyle(0x8866aa, 0.8);
          this.decoG.fillRect(px + 10, py + 6, 12, 10);
        }
        if (c.fire && c.fire > 0) {
          this.decoG.fillStyle(0xff6622, 0.75);
          this.decoG.fillCircle(px + 16, py + 16, 11);
          this.decoG.fillStyle(0xffcc44, 0.9);
          this.decoG.fillCircle(px + 16, py + 18, 6);
        }
      }
    }
  }

  // ---------------- enemies (doc 10: scale to party, elites as tags) ----------------

  private spawnEnemies(): void {
    const r = mulberry32(hashStr(`${this.launch.rewardKey}|e${this.floor}|${dayKey()}`));
    const isBossFloor = this.launch.mode === 'boss' || (this.launch.mode === 'dungeon' && this.floor === this.launch.floors);
    // session one must be winnable from the couch with one Lv1 hero
    const count =
      this.launch.intro === 'firstBattle' ? 2 :
      this.launch.intro === 'introDungeon' ? Math.max(1, this.floor) :
      this.launch.mode === 'dungeon' ? Math.min(6, 2 + this.floor) : 3 + Math.floor(r() * 2);
    for (let i = 0; i < count; i++) {
      const gx = 1 + Math.floor(r() * (BATTLE_COLS - 2));
      const gy = Math.floor(r() * 2);
      const boss = isBossFloor && i === 0;
      const elite: EliteTag = !boss && r() < 0.22 ? (r() < 0.5 ? 'Frenzied' : 'Warded') : null;
      const archetype = r() < 0.25 ? 'ranged' : 'melee';
      this.addEnemy(this.findFree(gx, gy), gy, boss, elite, archetype);
    }
  }

  private addEnemy(gx: number, gy: number, boss: boolean, elite: EliteTag, archetype: string): void {
    // stats filled at START when the deployed party is known (doc 10)
    const c = this.add.container(0, 0);
    const img = this.add.image(0, 6, 'spr_sil').setOrigin(0.5, 1).setScale(0.72);
    c.add(img);
    const tag = this.add.text(0, -46, `${boss ? '☠ BOSS' : archetype}${elite ? `\n⚠ ${elite}` : ''}`, {
      fontSize: '8px', color: elite ? '#ffaa44' : '#8899bb', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 1);
    c.add(tag);
    const bar = this.add.graphics();
    c.add(bar);
    const u: Unit = {
      side: 'enemy', name: boss ? 'BOSS' : 'Blightling', archetype, elite,
      gx, gy, hp: 1, maxHp: 1, atk: 1, def: 1,
      attackInterval: 3, cd: 0, range: archetype === 'ranged' ? 3 : 1,
      mana: 0, ultCost: 9999, crit: 3,
      shield: 0, atkBuffTicks: 0, defBuffTicks: 0, hasteTicks: 0,
      boss,
      sprKey: boss ? 'spr_boss' : MONSTER_SPRITES[hashStr(`${gx},${gy}`) % MONSTER_SPRITES.length],
      obj: c, img, bar, dead: false,
    };
    this.positionUnit(u);
    this.units.push(u);
    this.drawBar(u);
  }

  private revealEnemies(enemyLevel: number): void {
    const introScale = this.launch.intro === 'firstBattle' ? 0.55 : this.launch.intro === 'introDungeon' ? 0.55 : 1;
    for (const u of this.units) {
      if (u.side !== 'enemy') continue;
      const mult = (u.boss ? 3.4 : 1) * introScale;
      u.maxHp = Math.round((50 + enemyLevel * 14) * mult * (u.elite === 'Warded' ? 1.3 : 1));
      u.hp = u.maxHp;
      u.atk = Math.round((8 + enemyLevel * 2.2) * (u.boss ? 1.5 : 1) * (u.elite === 'Frenzied' ? 1.5 : 1) * introScale);
      u.def = Math.round(3 + enemyLevel * 1.1 + (u.elite === 'Warded' ? 6 : 0));
      u.attackInterval = u.elite === 'Frenzied' ? 2 : 3;
      u.img.setTexture(u.sprKey);
      u.img.setScale(u.boss ? 1 : 0.95);
      this.drawBar(u);
    }
  }

  private findFree(gx: number, gy: number): number {
    for (let d = 0; d < BATTLE_COLS; d++) {
      for (const x of [gx - d, gx + d]) {
        if (x >= 0 && x < BATTLE_COLS && this.grid[gy][x].walkable && !this.unitAt(x, gy)) return x;
      }
    }
    return gx;
  }

  private unitAt(gx: number, gy: number): Unit | undefined {
    return this.units.find((u) => !u.dead && u.gx === gx && u.gy === gy);
  }

  private positionUnit(u: Unit): void {
    u.obj.setPosition(GRID_X + u.gx * TILE + TILE / 2, GRID_Y + u.gy * TILE + TILE / 2);
    u.obj.setDepth(10 + u.gy);
  }

  private drawBar(u: Unit): void {
    u.bar.clear();
    const w = 26;
    u.bar.fillStyle(0x222222, 1);
    u.bar.fillRect(-w / 2, -40, w, 4);
    u.bar.fillStyle(u.side === 'player' ? 0x44dd44 : 0xdd4444, 1);
    u.bar.fillRect(-w / 2, -40, w * Math.max(0, u.hp / u.maxHp), 4);
    if (u.side === 'player' && u.ult) {
      u.bar.fillStyle(0x3388ff, 1);
      u.bar.fillRect(-w / 2, -35, w * Math.min(1, u.mana / u.ultCost), 2);
    }
    if (u.shield > 0) {
      u.bar.lineStyle(1, 0xffffff, 0.9);
      u.bar.strokeRect(-w / 2 - 1, -41, w + 2, 6);
    }
  }

  // ---------------- setup: bench + AUTO ----------------

  private renderBench(): void {
    const alive = store.activeHeroes().filter((h) => this.runRoster.has(h.id));
    const benchY = GAME_HEIGHT - 56;
    const bg = this.add.graphics().setDepth(UI_DEPTH - 1);
    bg.fillStyle(0x101828, 0.96);
    bg.fillRect(0, benchY - 44, GAME_WIDTH, 100);
    this.add.text(8, benchY - 40, `deploy up to ${DEPLOY_CAP} · drag to the blue zone`, {
      fontSize: '9px', color: '#8899bb', fontFamily: 'monospace',
    }).setDepth(UI_DEPTH);

    alive.slice(0, 8).forEach((h, i) => {
      const bx = 30 + i * 44;
      const c = this.add.container(bx, benchY + 6).setDepth(UI_DEPTH);
      c.add(this.add.image(0, 0, `spr_job_${h.job}`).setOrigin(0.5, 0.75).setScale(0.6));
      const frac = this.runRoster.get(h.id)!.hp / effStats(h).hp;
      c.add(this.add.text(0, 12, `${h.name}\n${JOBS[h.job].key} ${Math.round(frac * 100)}%`, {
        fontSize: '7px', color: frac < 0.4 ? '#ff9999' : '#aaccee', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0));
      c.setSize(40, 60);
      c.setInteractive({ draggable: true });
      const home = { x: bx, y: benchY + 6 };
      c.on('drag', (_p: Phaser.Input.Pointer, dx: number, dy: number) => { c.x = dx; c.y = dy; });
      c.on('dragend', (p: Phaser.Input.Pointer) => {
        const gx = Math.floor((p.worldX - GRID_X) / TILE);
        const gy = Math.floor((p.worldY - GRID_Y) / TILE);
        if (this.tryPlace(h, gx, gy)) c.destroy();
        else c.setPosition(home.x, home.y);
      });
      this.benchObjs.push(c);
    });
  }

  private tryPlace(h: Hero, gx: number, gy: number): boolean {
    if (
      this.phase !== 'setup' ||
      gx < 0 || gx >= BATTLE_COLS || gy < BATTLE_ROWS - 3 || gy >= BATTLE_ROWS ||
      !this.grid[gy][gx].walkable || this.unitAt(gx, gy) ||
      this.placed.has(h.id) || this.placed.size >= DEPLOY_CAP
    ) return false;
    const st = effStats(h);
    const cur = this.runRoster.get(h.id)!;
    const def = JOBS[h.job];
    const ult = ULTIMATES[def.ultimates[h.equippedUlt] ?? def.ultimates[0]];
    this.placed.add(h.id);
    const c = this.add.container(0, 0);
    const img = this.add.image(0, 6, `spr_job_${h.job}`).setOrigin(0.5, 1).setScale(0.72);
    c.add(img);
    const bar = this.add.graphics();
    c.add(bar);
    const u: Unit = {
      side: 'player', heroId: h.id, name: h.name, archetype: h.job, elite: null,
      gx, gy, hp: cur.hp, maxHp: st.hp, atk: st.atk, def: st.def,
      attackInterval: st.attackInterval, cd: 0, range: st.range,
      mana: 0, ultCost: st.ultCost, ult, crit: st.crit,
      shield: 0, atkBuffTicks: 0, defBuffTicks: 0, hasteTicks: 0,
      boss: false, sprKey: `spr_job_${h.job}`,
      obj: c, img, bar, dead: false,
    };
    this.positionUnit(u);
    this.units.push(u);
    this.drawBar(u);
    return true;
  }

  private autoPlace(): void {
    const alive = store.activeHeroes().filter((h) => this.runRoster.has(h.id) && !this.placed.has(h.id));
    let gx = 1, gy = BATTLE_ROWS - 2;
    for (const h of alive) {
      if (this.placed.size >= DEPLOY_CAP) break;
      let ok = false;
      for (let tries = 0; tries < BATTLE_COLS * 3 && !ok; tries++) {
        if (this.grid[gy][gx].walkable && !this.unitAt(gx, gy)) ok = this.tryPlace(h, gx, gy);
        gx++;
        if (gx >= BATTLE_COLS) { gx = 0; gy = gy === BATTLE_ROWS - 2 ? BATTLE_ROWS - 1 : BATTLE_ROWS - 3; }
      }
    }
    this.benchObjs.forEach((b) => b.destroy());
    this.benchObjs = [];
    this.renderBench();
  }

  private renderChrome(): void {
    const bar = this.add.graphics().setDepth(UI_DEPTH - 1);
    bar.fillStyle(0x101828, 0.96);
    bar.fillRect(0, 0, GAME_WIDTH, 88);
    const floorTxt = this.launch.floors > 1 ? ` · floor ${this.floor}/${this.launch.floors}` : '';
    this.add.text(GAME_WIDTH / 2, 10, `${this.launch.label}${floorTxt}`, {
      fontSize: '13px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(UI_DEPTH);
    this.statusText = this.add.text(GAME_WIDTH / 2, 30, 'enemies wait as silhouettes — place your line', {
      fontSize: '9px', color: '#88aacc', fontFamily: 'monospace',
    }).setOrigin(0.5, 0).setDepth(UI_DEPTH);

    makeButton(this, 40, 62, 62, 26, '← FLEE', () => this.exitToWorld(false), { color: 0x883333 }).setDepth(UI_DEPTH);
    makeButton(this, 116, 62, 62, 26, 'AUTO', () => this.autoPlace(), { color: 0x555577 }).setDepth(UI_DEPTH);
    const spd = makeButton(this, 192, 62, 62, 26, this.speed2x ? '2× ▶▶' : '1× ▶', () => {
      this.speed2x = !this.speed2x;
      (spd.getData('label') as Phaser.GameObjects.Text).setText(this.speed2x ? '2× ▶▶' : '1× ▶');
      if (this.tickEvent) {
        this.tickEvent.remove();
        this.tickEvent = this.time.addEvent({ delay: this.speed2x ? 160 : 320, loop: true, callback: () => this.tick() });
      }
    }, { color: 0x555577 }).setDepth(UI_DEPTH);
    makeButton(this, GAME_WIDTH - 52, 62, 84, 30, '⚔ START', () => this.startCombat(), { color: 0x2a7a3a }).setDepth(UI_DEPTH);
  }

  // ---------------- combat ----------------

  private startCombat(): void {
    if (this.phase !== 'setup') return;
    if (this.placed.size === 0) { toast(this, 'Place at least one hero'); return; }
    this.phase = 'combat';
    this.benchObjs.forEach((b) => b.destroy());
    // enemy level scales to the DEPLOYED party average ± band (doc 10)
    const placedHeroes = [...this.placed].map((id) => store.hero(id)!).filter(Boolean);
    const avg = Math.round(placedHeroes.reduce((a, h) => a + h.charLevel, 0) / placedHeroes.length);
    const band = (hashStr(this.launch.rewardKey + this.floor) % 3) - 1; // -1..+1
    const enemyLevel = Math.max(1, avg + band + Math.floor((this.floor - 1) / 2));
    this.revealEnemies(enemyLevel);
    this.registry.set('lastEnemyLevel', enemyLevel);
    this.statusText.setText(`enemy Lv${enemyLevel} revealed — the line holds itself now`);
    this.tickEvent = this.time.addEvent({ delay: this.speed2x ? 160 : 320, loop: true, callback: () => this.tick() });
  }

  private tick(): void {
    if (this.phase !== 'combat') return;
    // environment: fire burns and spreads through tree cover
    this.tickFire();
    const order = this.units.filter((u) => !u.dead);
    for (const u of order) {
      if (u.dead) continue;
      if (u.atkBuffTicks > 0) u.atkBuffTicks--;
      if (u.defBuffTicks > 0) u.defBuffTicks--;
      if (u.hasteTicks > 0) u.hasteTicks--;
      if (u.cd > 0) { u.cd -= u.hasteTicks > 0 ? 2 : 1; if (u.cd < 0) u.cd = 0; }

      // Cleric behaviour: heal the most wounded ally in range first
      if (u.side === 'player' && u.heroId && JOBS[(store.hero(u.heroId)!).job].targeting === 'lowestAlly') {
        const wounded = this.units
          .filter((x) => !x.dead && x.side === u.side && x !== u && x.hp < x.maxHp)
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (wounded && Math.abs(wounded.gx - u.gx) + Math.abs(wounded.gy - u.gy) <= u.range && u.cd === 0) {
          const heal = Math.round(u.atk * 1.2);
          wounded.hp = Math.min(wounded.maxHp, wounded.hp + heal);
          u.cd = u.attackInterval;
          u.mana += 14; // mana from damage dealt (healing counts)
          this.floatText(wounded.obj.x, wounded.obj.y - 44, `+${heal}`, '#66ff88');
          this.drawBar(wounded); this.drawBar(u);
          this.maybeUlt(u);
          continue;
        }
      }

      const foes = this.units.filter((x) => !x.dead && x.side !== u.side);
      if (!foes.length) break;
      const target = this.pickTarget(u, foes);
      const dist = Math.abs(target.gx - u.gx) + Math.abs(target.gy - u.gy);
      if (dist <= u.range) {
        if (u.cd === 0) this.attack(u, target);
      } else {
        this.stepToward(u, target);
      }
      this.maybeUlt(u);
    }
    this.checkEnd();
  }

  private pickTarget(u: Unit, foes: Unit[]): Unit {
    const targeting = u.side === 'player' && u.heroId ? JOBS[store.hero(u.heroId)!.job].targeting : 'nearest';
    if (targeting === 'lowestHp') {
      return [...foes].sort((a, b) => a.hp - b.hp)[0];
    }
    if (targeting === 'backline') {
      return [...foes].sort((a, b) => a.gy - b.gy)[0];
    }
    if (targeting === 'cluster') {
      let best = foes[0], bestScore = -1;
      for (const f of foes) {
        const near = foes.filter((x) => Math.abs(x.gx - f.gx) + Math.abs(x.gy - f.gy) <= 1).length;
        if (near > bestScore) { bestScore = near; best = f; }
      }
      return best;
    }
    let best = foes[0], bd = 1e9;
    for (const f of foes) {
      const d = Math.abs(f.gx - u.gx) + Math.abs(f.gy - u.gy);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  private stepToward(u: Unit, t: Unit): void {
    const dx = Math.sign(t.gx - u.gx), dy = Math.sign(t.gy - u.gy);
    const tries: [number, number][] = Math.abs(t.gx - u.gx) > Math.abs(t.gy - u.gy)
      ? [[dx, 0], [0, dy], [0, dy === 0 ? 1 : -dy]]
      : [[0, dy], [dx, 0], [dx === 0 ? 1 : -dx, 0]];
    for (const [mx, my] of tries) {
      if (mx === 0 && my === 0) continue;
      const nx = u.gx + mx, ny = u.gy + my;
      if (nx < 0 || ny < 0 || nx >= BATTLE_COLS || ny >= BATTLE_ROWS) continue;
      const cell = this.grid[ny][nx];
      if ((!cell.walkable && !cell.frozen) || this.unitAt(nx, ny)) continue;
      u.gx = nx; u.gy = ny;
      this.tweens.add({
        targets: u.obj,
        x: GRID_X + nx * TILE + TILE / 2, y: GRID_Y + ny * TILE + TILE / 2,
        duration: this.speed2x ? 90 : 180,
      });
      u.obj.setDepth(10 + ny);
      return;
    }
  }

  private attack(u: Unit, t: Unit): void {
    u.cd = u.attackInterval;
    const heroDef = u.side === 'player' && u.heroId ? JOBS[store.hero(u.heroId)!.job] : null;
    // mana generation model (doc 5.1)
    if (!heroDef || heroDef.manaFrom === 'attack' || heroDef.manaFrom === 'damageDealt') u.mana += 12;
    const atkMult = u.atkBuffTicks > 0 ? 1.35 : 1;
    let dmg = Math.max(1, Math.round(u.atk * atkMult - t.def / 2 + (Math.random() * 4 - 2)));
    if (Math.random() * 100 < u.crit) {
      dmg = Math.round(dmg * 1.8);
      this.floatText(t.obj.x, t.obj.y - 52, 'CRIT', '#ffdd00');
    }
    this.dealDamage(u, t, dmg, false);
    const lx = Math.sign(t.obj.x - u.obj.x) * 6;
    this.tweens.add({ targets: u.obj, x: u.obj.x + lx, duration: 60, yoyo: true });
  }

  private dealDamage(src: Unit | null, t: Unit, dmg: number, isUlt: boolean): void {
    if (t.defBuffTicks > 0) dmg = Math.round(dmg * 0.6);
    if (t.shield > 0) {
      const absorbed = Math.min(t.shield, dmg);
      t.shield -= absorbed;
      dmg -= absorbed;
    }
    if (dmg <= 0) { this.drawBar(t); return; }
    t.hp -= dmg;
    // mana from damage taken (Knights/Bulwarks)
    const tDef = t.side === 'player' && t.heroId ? JOBS[store.hero(t.heroId)!.job] : null;
    if (tDef?.manaFrom === 'damageTaken') t.mana += Math.min(20, Math.round(dmg / 3) + 4);
    this.floatText(t.obj.x, t.obj.y - 44, `${isUlt ? '✦' : ''}-${dmg}`, isUlt ? '#ffd700' : '#ff6666');
    this.drawBar(t);
    if (t.hp <= 0) this.kill(t);
  }

  private maybeUlt(u: Unit): void {
    if (u.dead || !u.ult || u.mana < u.ultCost) return;
    u.mana = 0;
    const ult = u.ult;
    this.floatText(u.obj.x, u.obj.y - 58, ult.name.toUpperCase(), '#66ddff');
    const foes = this.units.filter((x) => !x.dead && x.side !== u.side);
    const allies = this.units.filter((x) => !x.dead && x.side === u.side);
    const power = Math.round(u.atk * ult.power);
    switch (ult.kind) {
      case 'damage': {
        const t = this.pickTarget(u, foes.length ? foes : [u]);
        if (foes.length) this.dealDamage(u, t, power, true);
        break;
      }
      case 'aoe': {
        const t = this.pickTarget(u, foes.length ? foes : [u]);
        if (!foes.length) break;
        const r = ult.radius ?? 1;
        for (const f of foes) {
          if (Math.abs(f.gx - t.gx) <= r && Math.abs(f.gy - t.gy) <= r) this.dealDamage(u, f, power, true);
        }
        this.flashCells(t.gx, t.gy, r, 0xffaa33);
        break;
      }
      case 'heal': {
        if (ult.radius) {
          for (const a of allies) {
            if (Math.abs(a.gx - u.gx) <= ult.radius && Math.abs(a.gy - u.gy) <= ult.radius) {
              a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * ult.power));
              this.drawBar(a);
            }
          }
        } else {
          const w = [...allies].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (w) { w.hp = Math.min(w.maxHp, w.hp + Math.round(w.maxHp * ult.power)); this.drawBar(w); }
        }
        this.flashCells(u.gx, u.gy, ult.radius ?? 1, 0x66ff88);
        break;
      }
      case 'buff': {
        const r = ult.radius ?? 0;
        for (const a of allies) {
          if (Math.abs(a.gx - u.gx) <= r && Math.abs(a.gy - u.gy) <= r) {
            if (ult.key === 'Aegis' || ult.key === 'Ward' || ult.key === 'Absorb') a.shield += Math.round(a.maxHp * ult.power);
            else if (ult.key === 'Bloodlust') a.hasteTicks += 10;
            else if (ult.key === 'Camouflage' || ult.key === 'Evasion' || ult.key === 'ShieldWall' || ult.key === 'Anchor' || ult.key === 'Phalanx') a.defBuffTicks += 10;
            else a.atkBuffTicks += 10;
            this.drawBar(a);
          }
        }
        this.flashCells(u.gx, u.gy, r || 1, 0x88aaff);
        break;
      }
      case 'terrain': {
        // THE DEMO: ultimates that read and reshape the real ground
        const t = foes.length ? this.pickTarget(u, foes) : u;
        const r = ult.radius ?? 1;
        for (const f of foes) {
          if (Math.abs(f.gx - t.gx) <= r && Math.abs(f.gy - t.gy) <= r) this.dealDamage(u, f, power, true);
        }
        if (ult.terrainFx === 'burnTrees') {
          for (let y = t.gy - r; y <= t.gy + r; y++) for (let x = t.gx - r; x <= t.gx + r; x++) {
            if (this.grid[y]?.[x]) this.grid[y][x].fire = Math.max(this.grid[y][x].fire ?? 0, 4);
          }
        } else if (ult.terrainFx === 'freezeWater') {
          for (let y = t.gy - r; y <= t.gy + r; y++) for (let x = t.gx - r; x <= t.gx + r; x++) {
            const cell = this.grid[y]?.[x];
            const terr = this.launch.terrain[y]?.[x];
            if (cell && terr === 'water') { cell.frozen = true; cell.walkable = true; }
          }
          this.floatText(GRID_X + t.gx * TILE, GRID_Y + t.gy * TILE - 10, 'the water freezes solid', '#bfe8ff');
        } else if (ult.terrainFx === 'breakObstacles') {
          for (let y = t.gy - r; y <= t.gy + r; y++) for (let x = t.gx - r; x <= t.gx + r; x++) {
            const cell = this.grid[y]?.[x];
            if (cell?.deco) { cell.deco = undefined; cell.walkable = true; }
          }
          this.cameras.main.shake(220, 0.012);
          this.floatText(GRID_X + t.gx * TILE, GRID_Y + t.gy * TILE - 10, 'the ground is remade', '#ffaa66');
        }
        this.redrawDecos();
        this.flashCells(t.gx, t.gy, r, ult.terrainFx === 'freezeWater' ? 0x88ddff : 0xff6622);
        break;
      }
    }
    this.drawBar(u);
  }

  private tickFire(): void {
    let changed = false;
    const toSpread: [number, number][] = [];
    for (let y = 0; y < BATTLE_ROWS; y++) {
      for (let x = 0; x < BATTLE_COLS; x++) {
        const c = this.grid[y][x];
        if (!c.fire || c.fire <= 0) continue;
        changed = true;
        // burn units standing on/adjacent
        for (const u of this.units) {
          if (u.dead) continue;
          if (Math.abs(u.gx - x) <= 0 && Math.abs(u.gy - y) <= 0) {
            this.dealDamage(null, u, 6, false);
          }
        }
        // fire consumes tree cover and spreads through it (Immolate demo)
        if (c.deco === 'tree') { c.deco = undefined; c.walkable = true; }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = this.grid[y + dy]?.[x + dx];
          if (n?.deco === 'tree' && !(n.fire && n.fire > 0)) toSpread.push([x + dx, y + dy]);
        }
        c.fire--;
      }
    }
    for (const [x, y] of toSpread) this.grid[y][x].fire = 3;
    if (changed) this.redrawDecos();
  }

  private flashCells(cx: number, cy: number, r: number, color: number): void {
    this.fxG.clear();
    this.fxG.fillStyle(color, 0.35);
    this.fxG.fillRect(GRID_X + (cx - r) * TILE, GRID_Y + (cy - r) * TILE, (r * 2 + 1) * TILE, (r * 2 + 1) * TILE);
    this.time.delayedCall(260, () => this.fxG.clear());
  }

  private floatText(x: number, y: number, msg: string, color: string): void {
    const t = this.add.text(x, y, msg, {
      fontSize: '10px', color, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({ targets: t, y: y - 18, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  private kill(u: Unit): void {
    u.dead = true;
    if (u.side === 'player' && u.heroId) this.runRoster.delete(u.heroId); // the dead stay dead
    this.tweens.add({ targets: u.obj, alpha: 0, scaleX: 0.6, scaleY: 0.6, duration: 240, onComplete: () => u.obj.destroy() });
  }

  // ---------------- end / floors / rewards ----------------

  private checkEnd(): void {
    const pAlive = this.units.some((u) => !u.dead && u.side === 'player');
    const eAlive = this.units.some((u) => !u.dead && u.side === 'enemy');
    if (pAlive && eAlive) return;
    this.phase = 'done';
    if (this.tickEvent) { this.tickEvent.remove(); this.tickEvent = null; }

    if (!pAlive) { this.defeatOverlay(); return; }

    // survivors heal 35% between floors; XP only to survivors of a win
    for (const u of this.units) {
      if (u.side === 'player' && !u.dead && u.heroId) {
        const e = this.runRoster.get(u.heroId);
        if (e) e.hp = Math.min(u.maxHp, Math.round(u.hp + u.maxHp * 0.35));
      }
    }
    const enemyLevel = (this.registry.get('lastEnemyLevel') as number) ?? this.launch.enemyLevel;
    const enemyCount = this.units.filter((u) => u.side === 'enemy').length;
    const gains: string[] = [];
    for (const u of this.units) {
      if (u.side !== 'player' || u.dead || !u.heroId) continue;
      const h = store.hero(u.heroId);
      if (h) gains.push(grantWinXp(h, enemyLevel, enemyCount));
    }
    store.save();

    if (this.floor < this.launch.floors) {
      // epic checkpoint at the halfway floor [LOCKED]
      if (this.launch.tier === 'epic' && this.floor + 1 === EPIC_CHECKPOINT_FLOOR + 1) {
        this.checkpointRoster = new Map(JSON.parse(JSON.stringify([...this.runRoster])));
      }
      this.interstitial(gains);
    } else {
      this.finishRun(gains);
    }
  }

  private interstitial(gains: string[]): void {
    const dim = this.add.graphics().setDepth(UI_DEPTH + 10);
    dim.fillStyle(0x000000, 0.75);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.add.text(GAME_WIDTH / 2, 200, `FLOOR ${this.floor} CLEARED`, {
      fontSize: '20px', color: '#66dd88', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
    this.add.text(GAME_WIDTH / 2, 244, gains.join('\n'), {
      fontSize: '9px', color: '#cceeff', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 11);
    const cp = this.launch.tier === 'epic' && this.floor >= EPIC_CHECKPOINT_FLOOR ? '\ncheckpoint reached — a wipe returns here' : '';
    this.add.text(GAME_WIDTH / 2, 330, `The wounded are bandaged. The dead stay dead.${cp}`, {
      fontSize: '9px', color: '#8899aa', fontFamily: 'monospace', fontStyle: 'italic', align: 'center',
    }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
    makeButton(this, GAME_WIDTH / 2, 400, 180, 38, `DESCEND → floor ${this.floor + 1}`, () => {
      this.floor++;
      this.buildFloor();
    }, { color: 0x2a7a3a }).setDepth(UI_DEPTH + 11);
  }

  private finishRun(gains: string[]): void {
    const { mode, floors } = this.launch;
    const enemyLevel = (this.registry.get('lastEnemyLevel') as number) ?? 1;
    const gold = mode === 'dungeon' ? 50 + floors * 24 + enemyLevel * 8 : mode === 'boss' ? 60 + enemyLevel * 14 : 15 + enemyLevel * 6;
    const wood = mode === 'dungeon' ? 20 + floors * 6 : 6;
    const stone = mode === 'dungeon' ? 14 + floors * 5 : 5;
    const crystal = mode === 'dungeon' ? Math.ceil(floors / 2) : mode === 'boss' ? 2 : 0;
    store.state.gold += gold;
    store.state.wood += wood;
    store.state.stone += stone;
    store.state.crystal += crystal;
    store.state.consumed[this.launch.rewardKey] = dayKey();
    store.save();

    const dim = this.add.graphics().setDepth(UI_DEPTH + 10);
    dim.fillStyle(0x000000, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.add.text(GAME_WIDTH / 2, 180, 'VICTORY', {
      fontSize: '30px', color: '#66dd88', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
    this.add.text(GAME_WIDTH / 2, 226, `⛃+${gold}  🪵+${wood}  🪨+${stone}${crystal ? `  ◆+${crystal}` : ''}`, {
      fontSize: '12px', color: '#ffe080', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
    this.add.text(GAME_WIDTH / 2, 254, gains.join('\n'), {
      fontSize: '9px', color: '#cceeff', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 11);
    makeButton(this, GAME_WIDTH / 2, 440, 190, 40, 'RETURN TO WORLD', () => this.exitToWorld(true), { color: 0x2a4a8a }).setDepth(UI_DEPTH + 11);
  }

  private defeatOverlay(): void {
    const dim = this.add.graphics().setDepth(UI_DEPTH + 10);
    dim.fillStyle(0x000000, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.add.text(GAME_WIDTH / 2, 190, 'DEFEAT', {
      fontSize: '30px', color: '#dd5555', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
    const hasCp = this.launch.tier === 'epic' && this.checkpointRoster && this.floor > EPIC_CHECKPOINT_FLOOR;
    this.add.text(GAME_WIDTH / 2, 240,
      `No XP for losses. Nothing lost but the walk —\nand you already took it.${hasCp ? '\nYour checkpoint holds at the halfway floor.' : ''}`, {
        fontSize: '10px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
    makeButton(this, GAME_WIDTH / 2, 390, 210, 40, hasCp ? `↻ RETRY (floor ${EPIC_CHECKPOINT_FLOOR + 1})` : '↻ RETRY (floor 1)', () => {
      if (hasCp && this.checkpointRoster) {
        this.runRoster = new Map(this.checkpointRoster);
        this.floor = EPIC_CHECKPOINT_FLOOR + 1;
      } else {
        this.resetRunRoster();
        this.floor = 1;
      }
      this.buildFloor();
    }, { color: 0x2a7a3a }).setDepth(UI_DEPTH + 11);
    makeButton(this, GAME_WIDTH / 2, 442, 210, 38, 'RETURN TO WORLD', () => this.exitToWorld(false), { color: 0x2a4a8a }).setDepth(UI_DEPTH + 11);
  }

  private exitToWorld(victory: boolean): void {
    this.registry.set('battleOutcome', { victory, intro: this.launch.intro });
    this.scene.start('WorldScene');
  }
}
