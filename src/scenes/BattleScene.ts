// Tactical auto-battler. The grid is generated from the real-world terrain
// where the fight happens (the moat). Dungeons run multiple floors with
// permadeath-within-run: HP heals between floors, the dead stay dead.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, TILE, BATTLE_COLS, BATTLE_ROWS, DEPLOY_CAP } from '../config/constants';
import { store, Hero } from '../core/save';
import { effectiveStats, xpForWin, grantXp } from '../game/heroes';
import { bakeAllSprites, MONSTER_SPRITES } from '../game/sprites';
import { makeButton, toast, UI_DEPTH } from '../game/ui';
import { mulberry32, hashStr, dayKey } from '../core/rng';

interface BattleLaunch {
  mode: 'monster' | 'boss' | 'dungeon';
  enemyLevel: number;
  floors: number;
  terrain: string[][];
  rewardKey: string;
  label: string;
}

interface Unit {
  side: 'player' | 'enemy';
  heroId?: string;
  name: string;
  gx: number;
  gy: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  range: number;
  mana: number;
  cls?: string;
  obj: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
  dead: boolean;
}

type Cell = { walkable: boolean; deco?: string };

const GRID_X = (GAME_WIDTH - BATTLE_COLS * TILE) / 2;
const GRID_Y = 96;

export class BattleScene extends Phaser.Scene {
  private launch!: BattleLaunch;
  private grid: Cell[][] = [];
  private units: Unit[] = [];
  private floor = 1;
  private phase: 'setup' | 'combat' | 'done' = 'setup';
  // permadeath-within-run: heroId -> remaining hp (dead heroes removed)
  private runRoster: Map<string, { hp: number }> = new Map();
  private benchObjs: Phaser.GameObjects.Container[] = [];
  private placedHeroIds: Set<string> = new Set();
  private statusText!: Phaser.GameObjects.Text;
  private tickEvent: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super({ key: 'BattleScene' });
  }

  init(data: BattleLaunch): void {
    this.launch = data;
    this.floor = 1;
    this.phase = 'setup';
    this.units = [];
    this.benchObjs = [];
    this.placedHeroIds = new Set();
    this.runRoster = new Map();
    store.livingHeroes().forEach((h) => {
      this.runRoster.set(h.id, { hp: effectiveStats(h).hp });
    });
  }

  create(): void {
    bakeAllSprites(this);
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
    cell('t_town_blue', 6, 0);
    cell('t_town_red', 7, 0);
  }

  // ---------------- floor construction ----------------

  private buildFloor(): void {
    this.children.removeAll();
    this.units = [];
    this.benchObjs = [];
    this.placedHeroIds = new Set();
    this.phase = 'setup';
    if (this.tickEvent) { this.tickEvent.remove(); this.tickEvent = null; }

    this.genGridFromTerrain();
    this.renderGrid();
    this.spawnEnemies();
    this.renderBench();
    this.renderChrome();
  }

  // Terrain -> battle grid. Forest tiles become tree cover, water is
  // impassable, buildings are walls, roads/sand are open lanes.
  private genGridFromTerrain(): void {
    const r = mulberry32(hashStr(`${this.launch.rewardKey}|f${this.floor}`));
    this.grid = [];
    for (let y = 0; y < BATTLE_ROWS; y++) {
      this.grid[y] = [];
      for (let x = 0; x < BATTLE_COLS; x++) {
        const t = this.launch.terrain[y]?.[x] ?? 'grass';
        let walkable = true;
        let deco: string | undefined;
        if (t === 'water') walkable = false;
        else if (t === 'town' || t === 'mountain') { walkable = false; deco = 'wall'; }
        else if (t === 'forest' && r() < 0.5) { walkable = false; deco = 'tree'; }
        else if (t === 'grass' && r() < 0.06) { walkable = false; deco = 'tree'; }
        this.grid[y][x] = { walkable, deco };
      }
    }
    // Deeper floors grow more corruption obstacles
    for (let i = 0; i < (this.floor - 1) * 2; i++) {
      const x = Math.floor(r() * BATTLE_COLS);
      const y = 3 + Math.floor(r() * (BATTLE_ROWS - 6));
      this.grid[y][x] = { walkable: false, deco: 'rock' };
    }
    // Spawn rows must be clear
    for (let x = 0; x < BATTLE_COLS; x++) {
      this.grid[0][x] = { walkable: true };
      this.grid[1][x] = { walkable: true };
      this.grid[BATTLE_ROWS - 1][x] = { walkable: true };
      this.grid[BATTLE_ROWS - 2][x] = { walkable: true };
    }
    this.ensureConnectivity();
  }

  // Flood-fill from the bottom; carve a channel if the top is unreachable.
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
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    if (!seen.has(`${Math.floor(BATTLE_COLS / 2)},0`)) {
      const cx = Math.floor(BATTLE_COLS / 2);
      for (let y = 0; y < BATTLE_ROWS; y++) this.grid[y][cx] = { walkable: true };
    }
  }

  private renderGrid(): void {
    const rt = this.add.renderTexture(GRID_X, GRID_Y, BATTLE_COLS * TILE, BATTLE_ROWS * TILE).setOrigin(0, 0);
    for (let y = 0; y < BATTLE_ROWS; y++) {
      for (let x = 0; x < BATTLE_COLS; x++) {
        const t = this.launch.terrain[y]?.[x] ?? 'grass';
        const frame =
          t === 'water' ? 'clean_water' :
          t === 'path' ? 'clean_road' :
          t === 'sand' || t === 'parking' ? 'clean_sand' :
          t === 'mountain' ? 'clean_mountain' :
          t === 'town' ? (this.noise(x, y) > 0.5 ? 't_town_blue' : 't_town_red') :
          't_grass';
        rt.drawFrame('world-tileset', frame, x * TILE, y * TILE);
      }
    }
    const g = this.add.graphics();
    for (let y = 0; y < BATTLE_ROWS; y++) {
      for (let x = 0; x < BATTLE_COLS; x++) {
        const px = GRID_X + x * TILE, py = GRID_Y + y * TILE;
        g.lineStyle(1, 0x000000, 0.12);
        g.strokeRect(px, py, TILE, TILE);
        const cell = this.grid[y][x];
        if (cell.deco === 'tree') {
          g.fillStyle(0x1e5a28, 1);
          g.fillCircle(px + 16, py + 12, 10);
          g.fillStyle(0x2f7a38, 1);
          g.fillCircle(px + 12, py + 9, 6);
          g.fillStyle(0x5a3a1a, 1);
          g.fillRect(px + 14, py + 20, 4, 8);
        } else if (cell.deco === 'rock') {
          g.fillStyle(0x5a4a6a, 1);
          g.fillRect(px + 6, py + 10, 20, 16);
          g.fillStyle(0x8866aa, 0.8);
          g.fillRect(px + 10, py + 6, 12, 10);
        }
      }
    }
    // player deploy zone tint (bottom 3 rows)
    g.fillStyle(0x4488ff, 0.12);
    g.fillRect(GRID_X, GRID_Y + (BATTLE_ROWS - 3) * TILE, BATTLE_COLS * TILE, 3 * TILE);
  }

  private noise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  // ---------------- units ----------------

  private spawnEnemies(): void {
    const r = mulberry32(hashStr(`${this.launch.rewardKey}|e${this.floor}`));
    const lv = this.launch.enemyLevel + (this.floor - 1);
    const isBossFloor = this.launch.mode === 'boss' || (this.launch.mode === 'dungeon' && this.floor === this.launch.floors);
    const count = this.launch.mode === 'dungeon' ? 3 + this.floor : this.launch.mode === 'boss' ? 3 : 3 + Math.floor(r() * 2);

    for (let i = 0; i < count; i++) {
      const gx = 1 + Math.floor(r() * (BATTLE_COLS - 2));
      const gy = Math.floor(r() * 2);
      const boss = isBossFloor && i === 0;
      const mult = boss ? 3.2 : 1;
      const hp = Math.round((55 + lv * 13) * mult);
      this.addUnit({
        side: 'enemy',
        name: boss ? 'BOSS' : 'Blightling',
        gx: this.findFree(gx, gy),
        gy,
        hp, maxHp: hp,
        atk: Math.round((9 + lv * 2.1) * (boss ? 1.5 : 1)),
        def: Math.round(4 + lv * 1.1),
        spd: 9 + Math.floor(r() * 4),
        range: r() < 0.25 ? 3 : 1,
        mana: 0,
        dead: false,
      }, boss);
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

  private addUnit(u: Omit<Unit, 'obj' | 'hpBar'>, boss = false): Unit {
    const c = this.add.container(0, 0);
    const sprKey = u.side === 'player'
      ? `spr_hero_${u.cls}`
      : boss ? 'spr_boss' : MONSTER_SPRITES[hashStr(u.name + u.gx) % MONSTER_SPRITES.length];
    const img = this.add.image(0, 6, sprKey).setOrigin(0.5, 1);
    if (u.side === 'player') img.setScale(0.72);
    c.add(img);
    const hpBar = this.add.graphics();
    c.add(hpBar);
    const unit: Unit = { ...u, obj: c, hpBar };
    this.positionUnit(unit);
    this.units.push(unit);
    this.drawHp(unit);
    return unit;
  }

  private positionUnit(u: Unit): void {
    u.obj.setPosition(GRID_X + u.gx * TILE + TILE / 2, GRID_Y + u.gy * TILE + TILE / 2);
    u.obj.setDepth(10 + u.gy);
  }

  private drawHp(u: Unit): void {
    u.hpBar.clear();
    const w = 26;
    u.hpBar.fillStyle(0x222222, 1);
    u.hpBar.fillRect(-w / 2, -40, w, 4);
    u.hpBar.fillStyle(u.side === 'player' ? 0x44dd44 : 0xdd4444, 1);
    u.hpBar.fillRect(-w / 2, -40, w * Math.max(0, u.hp / u.maxHp), 4);
    u.hpBar.fillStyle(0x3388ff, 1);
    u.hpBar.fillRect(-w / 2, -35, w * Math.min(1, u.mana / 100), 2);
  }

  // ---------------- setup: bench + drag placement ----------------

  private renderBench(): void {
    const alive = store.livingHeroes().filter((h) => this.runRoster.has(h.id));
    const benchY = GAME_HEIGHT - 58;
    const bg = this.add.graphics().setDepth(UI_DEPTH - 1);
    bg.fillStyle(0x101828, 0.96);
    bg.fillRect(0, benchY - 42, GAME_WIDTH, 100);
    this.add.text(GAME_WIDTH / 2, benchY - 38, `drag knights to the blue zone  ·  deploy up to ${DEPLOY_CAP}`, {
      fontSize: '9px', color: '#8899bb', fontFamily: 'monospace',
    }).setOrigin(0.5, 0).setDepth(UI_DEPTH);

    alive.slice(0, 8).forEach((h, i) => {
      const bx = 32 + i * 44;
      const c = this.add.container(bx, benchY + 8).setDepth(UI_DEPTH);
      const img = this.add.image(0, 0, `spr_hero_${h.cls}`).setOrigin(0.5, 0.75).setScale(0.62);
      c.add(img);
      const hpFrac = this.runRoster.get(h.id)!.hp / effectiveStats(h).hp;
      c.add(this.add.text(0, 12, `${h.name}\nLv${h.level} ${Math.round(hpFrac * 100)}%`, {
        fontSize: '7px', color: hpFrac < 0.4 ? '#ff9999' : '#aaccee', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0));
      c.setSize(40, 60);
      c.setInteractive({ draggable: true });
      const home = { x: bx, y: benchY + 8 };
      c.on('drag', (_p: Phaser.Input.Pointer, dx: number, dy: number) => { c.x = dx; c.y = dy; });
      c.on('dragend', (p: Phaser.Input.Pointer) => {
        const gx = Math.floor((p.x - GRID_X) / TILE);
        const gy = Math.floor((p.y - GRID_Y) / TILE);
        if (
          this.phase === 'setup' &&
          gx >= 0 && gx < BATTLE_COLS && gy >= BATTLE_ROWS - 3 && gy < BATTLE_ROWS &&
          this.grid[gy][gx].walkable && !this.unitAt(gx, gy) &&
          !this.placedHeroIds.has(h.id) && this.placedHeroIds.size < DEPLOY_CAP
        ) {
          this.placeHero(h, gx, gy);
          c.destroy();
        } else {
          c.setPosition(home.x, home.y);
        }
      });
      this.benchObjs.push(c);
    });
  }

  private placeHero(h: Hero, gx: number, gy: number): void {
    const st = effectiveStats(h);
    const cur = this.runRoster.get(h.id)!;
    this.placedHeroIds.add(h.id);
    this.addUnit({
      side: 'player', heroId: h.id, name: h.name, cls: h.cls,
      gx, gy,
      hp: cur.hp, maxHp: st.hp,
      atk: st.atk, def: st.def, spd: st.spd, range: st.range,
      mana: 0, dead: false,
    });
  }

  private renderChrome(): void {
    const bar = this.add.graphics().setDepth(UI_DEPTH - 1);
    bar.fillStyle(0x101828, 0.96);
    bar.fillRect(0, 0, GAME_WIDTH, 88);
    const floorTxt = this.launch.floors > 1 ? `  ·  floor ${this.floor}/${this.launch.floors}` : '';
    this.add.text(GAME_WIDTH / 2, 12, `${this.launch.label}${floorTxt}`, {
      fontSize: '13px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(UI_DEPTH);
    this.statusText = this.add.text(GAME_WIDTH / 2, 34, `enemy Lv${this.launch.enemyLevel + this.floor - 1}  ·  place your knights`, {
      fontSize: '10px', color: '#88aacc', fontFamily: 'monospace',
    }).setOrigin(0.5, 0).setDepth(UI_DEPTH);

    makeButton(this, 42, 62, 66, 28, '← FLEE', () => this.scene.start('WorldScene'), { color: 0x883333 }).setDepth(UI_DEPTH);
    makeButton(this, GAME_WIDTH - 52, 62, 84, 30, '⚔ START', () => this.startCombat(), { color: 0x2a7a3a }).setDepth(UI_DEPTH);
  }

  // ---------------- combat ----------------

  private startCombat(): void {
    if (this.phase !== 'setup') return;
    if (this.placedHeroIds.size === 0) {
      toast(this, 'Place at least one knight');
      return;
    }
    this.phase = 'combat';
    this.benchObjs.forEach((b) => b.destroy());
    this.statusText.setText('battle underway — placement is your only weapon');
    this.tickEvent = this.time.addEvent({ delay: 380, loop: true, callback: () => this.tick() });
  }

  private tick(): void {
    if (this.phase !== 'combat') return;
    const order = this.units.filter((u) => !u.dead).sort((a, b) => b.spd - a.spd);
    for (const u of order) {
      if (u.dead) continue;
      const foes = this.units.filter((x) => !x.dead && x.side !== u.side);
      if (foes.length === 0) break;
      let target = foes[0];
      let bd = 1e9;
      for (const f of foes) {
        const d = Math.abs(f.gx - u.gx) + Math.abs(f.gy - u.gy);
        if (d < bd) { bd = d; target = f; }
      }
      if (bd <= u.range) {
        this.attack(u, target);
      } else {
        this.stepToward(u, target);
      }
    }
    this.checkEnd();
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
      if (!this.grid[ny][nx].walkable || this.unitAt(nx, ny)) continue;
      u.gx = nx; u.gy = ny;
      this.tweens.add({
        targets: u.obj,
        x: GRID_X + nx * TILE + TILE / 2,
        y: GRID_Y + ny * TILE + TILE / 2,
        duration: 200,
      });
      u.obj.setDepth(10 + ny);
      return;
    }
  }

  private attack(u: Unit, t: Unit): void {
    u.mana = Math.min(100, u.mana + 18);
    let dmg = Math.max(1, Math.round(u.atk - t.def / 2 + (Math.random() * 4 - 2)));
    let ult = false;
    if (u.mana >= 100) {
      u.mana = 0;
      dmg = Math.round(dmg * 2.4);
      ult = true;
    }
    t.hp -= dmg;
    this.drawHp(u);
    this.drawHp(t);

    // lunge + damage number
    const lx = Math.sign(t.obj.x - u.obj.x) * 6;
    this.tweens.add({ targets: u.obj, x: u.obj.x + lx, duration: 70, yoyo: true });
    const dt = this.add.text(t.obj.x, t.obj.y - 44, `${ult ? '✦' : ''}-${dmg}`, {
      fontSize: ult ? '15px' : '11px', color: ult ? '#ffd700' : '#ff6666', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({ targets: dt, y: dt.y - 20, alpha: 0, duration: 550, onComplete: () => dt.destroy() });

    if (t.hp <= 0) this.kill(t);
  }

  private kill(u: Unit): void {
    u.dead = true;
    if (u.side === 'player' && u.heroId) {
      // permadeath-within-run: out for the rest of this dungeon
      this.runRoster.delete(u.heroId);
    }
    this.tweens.add({
      targets: u.obj, alpha: 0, scaleX: 0.6, scaleY: 0.6, duration: 260,
      onComplete: () => u.obj.destroy(),
    });
  }

  private checkEnd(): void {
    const pAlive = this.units.some((u) => !u.dead && u.side === 'player');
    const eAlive = this.units.some((u) => !u.dead && u.side === 'enemy');
    if (pAlive && eAlive) return;
    this.phase = 'done';
    if (this.tickEvent) { this.tickEvent.remove(); this.tickEvent = null; }

    if (!pAlive) {
      this.endOverlay(false);
      return;
    }

    // survivors carry HP forward (heal 35% between floors, capped)
    for (const u of this.units) {
      if (u.side === 'player' && !u.dead && u.heroId) {
        const entry = this.runRoster.get(u.heroId);
        if (entry) entry.hp = Math.min(u.maxHp, Math.round(u.hp + u.maxHp * 0.35));
      }
    }

    // XP only to survivors of a WON fight (design doc s.2)
    const enemyLv = this.launch.enemyLevel + this.floor - 1;
    const enemyCount = this.units.filter((u) => u.side === 'enemy').length;
    const survivors = this.units.filter((u) => u.side === 'player' && !u.dead && u.heroId);
    const gains: string[] = [];
    for (const s of survivors) {
      const h = store.hero(s.heroId!);
      if (!h) continue;
      const xp = xpForWin(h.level, enemyLv, enemyCount);
      const { leveled } = grantXp(h, xp);
      gains.push(`${h.name} +${xp}xp${leveled ? ` → Lv${h.level}!` : ''}`);
    }

    if (this.floor < this.launch.floors) {
      store.save();
      this.floorInterstitial(gains);
    } else {
      this.finishRun(gains);
    }
  }

  private floorInterstitial(gains: string[]): void {
    const dim = this.add.graphics().setDepth(UI_DEPTH + 10);
    dim.fillStyle(0x000000, 0.75);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.add.text(GAME_WIDTH / 2, 210, `FLOOR ${this.floor} CLEARED`, {
      fontSize: '20px', color: '#66dd88', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
    this.add.text(GAME_WIDTH / 2, 260, gains.join('\n') || 'no survivors gained xp', {
      fontSize: '10px', color: '#cceeff', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 11);
    this.add.text(GAME_WIDTH / 2, 340, 'The wounded are bandaged. The dead stay dead.', {
      fontSize: '10px', color: '#8899aa', fontFamily: 'monospace', fontStyle: 'italic',
    }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
    makeButton(this, GAME_WIDTH / 2, 410, 170, 38, `DESCEND → floor ${this.floor + 1}`, () => {
      this.floor++;
      this.buildFloor();
    }, { color: 0x2a7a3a }).setDepth(UI_DEPTH + 11);
  }

  private finishRun(gains: string[]): void {
    const mode = this.launch.mode;
    const lv = this.launch.enemyLevel;
    const gold = mode === 'dungeon' ? 80 + lv * 22 : mode === 'boss' ? 60 + lv * 18 : 18 + lv * 7;
    const wood = mode === 'dungeon' ? 30 + lv * 4 : 8;
    const stone = mode === 'dungeon' ? 22 + lv * 3 : 6;
    store.state.gold += gold;
    store.state.wood += wood;
    store.state.stone += stone;
    store.state.consumed[this.launch.rewardKey] = dayKey();
    store.save();
    this.endOverlay(true, gains, { gold, wood, stone });
  }

  private endOverlay(victory: boolean, gains: string[] = [], loot?: { gold: number; wood: number; stone: number }): void {
    const dim = this.add.graphics().setDepth(UI_DEPTH + 10);
    dim.fillStyle(0x000000, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.add.text(GAME_WIDTH / 2, 190, victory ? 'VICTORY' : 'DEFEAT', {
      fontSize: '30px', color: victory ? '#66dd88' : '#dd5555', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(UI_DEPTH + 11);

    if (victory && loot) {
      this.add.text(GAME_WIDTH / 2, 240, `⛃ +${loot.gold}   🪵 +${loot.wood}   🪨 +${loot.stone}`, {
        fontSize: '13px', color: '#ffe080', fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
      this.add.text(GAME_WIDTH / 2, 270, gains.join('\n') || '', {
        fontSize: '10px', color: '#cceeff', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 11);
    } else if (!victory) {
      this.add.text(GAME_WIDTH / 2, 245, 'No XP for losses. Nothing lost but the walk —\nand you already took it. Re-place and retry.', {
        fontSize: '10px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5).setDepth(UI_DEPTH + 11);
      makeButton(this, GAME_WIDTH / 2, 400, 190, 40, '↻ RETRY (floor 1)', () => {
        this.init(this.launch);
        this.buildFloor();
      }, { color: 0x2a7a3a }).setDepth(UI_DEPTH + 11);
    }

    makeButton(this, GAME_WIDTH / 2, 452, 190, 38, 'RETURN TO WORLD', () => this.scene.start('WorldScene'), { color: 0x2a4a8a }).setDepth(UI_DEPTH + 11);
  }
}
