// The Kingdom Sim — the couch half. Empty island at first; the Town Hall is
// placed in onboarding. Buildings gate jobs and recruitment; dedication
// (JP-gated, permanent) raises stars; the Wall of Honor remembers everyone.

import Phaser from 'phaser';
import { ZOOM } from '../core/zoom';
import {
  GAME_WIDTH, GAME_HEIGHT, TILE, MAX_STARS, STAR_JP_GATES,
  TAVERN_SLOTS, TAVERN_COOLDOWN_MS, TAVERN_REROLL_COST, SUBCLASS_JP_REQ,
} from '../config/constants';
import { store, Hero, Building } from '../core/save';
import {
  effStats, canRecruit, rollTavern, createHero, canWearJob, wearJob,
  respecCost, respecJob, charXpToNext, jobXpToNext, newJobProgress,
} from '../game/heroes';
import { JOBS, JobKey, ALL_JOBS, jobTree, nodeAvailable, ULTIMATES } from '../game/jobs';
import { BUILDING_TYPES, buildable, lockedSubclassBuildings } from '../game/buildings';
import { bakeAllSprites } from '../game/sprites';
import { hud, bottomNav, toast, modal, makeButton, confirmDialog, UI_DEPTH } from '../game/ui';
import { hashStr } from '../core/rng';

const KCOLS = 11;
const KROWS = 16;
const OX = (GAME_WIDTH - KCOLS * TILE) / 2;
const OY = 64;

export class KingdomScene extends Phaser.Scene {
  private refreshHud: () => void = () => {};
  private mode: 'view' | 'build' | 'landscape' = 'view';
  private pendingBuild: string | null = null;
  private pendingDeco: 'path' | 'tree' | 'shrub' | 'erase' | null = null;
  private groundRT!: Phaser.GameObjects.RenderTexture;
  private buildingLayer!: Phaser.GameObjects.Container;
  private decoLayer!: Phaser.GameObjects.Container;
  private hintText: Phaser.GameObjects.Text | null = null;

  constructor() { super({ key: 'KingdomScene' }); }

  create(): void {
    bakeAllSprites(this);
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    this.defineTiles();
    this.renderGround();
    this.decoLayer = this.add.container(0, 0);
    this.buildingLayer = this.add.container(0, 0);
    this.renderDecos();
    this.renderBuildings();
    this.spawnAmbient();

    const h = hud(this, 'YOUR KINGDOM');
    this.refreshHud = h.refresh;
    bottomNav(this, 'kingdom');

    makeButton(this, 40, GAME_HEIGHT - 84, 62, 28, 'HEROES', () => this.openRoster(), { color: 0x2a4a8a, fontSize: '10px' }).setDepth(UI_DEPTH);
    makeButton(this, 110, GAME_HEIGHT - 84, 62, 28, 'TAVERN', () => this.openTavern(), { color: 0x8a5a20, fontSize: '10px' }).setDepth(UI_DEPTH);
    makeButton(this, 180, GAME_HEIGHT - 84, 62, 28, 'WALL', () => this.openWall(), { color: 0x5a3a8a, fontSize: '10px' }).setDepth(UI_DEPTH);
    makeButton(this, 250, GAME_HEIGHT - 84, 62, 28, 'BUILD', () => this.openBuildMenu(), { color: 0x2a6a3a, fontSize: '10px' }).setDepth(UI_DEPTH);
    makeButton(this, 322, GAME_HEIGHT - 84, 74, 28, 'LANDSCAPE', () => this.openLandscapeMenu(), { color: 0x3a6a5a, fontSize: '9px' }).setDepth(UI_DEPTH);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.worldY < OY || p.worldY > OY + KROWS * TILE) return;
      const gx = Math.floor((p.worldX - OX) / TILE);
      const gy = Math.floor((p.worldY - OY) / TILE);
      if (gx < 0 || gy < 0 || gx >= KCOLS || gy >= KROWS) return;
      if (this.mode === 'build' && this.pendingBuild) this.tryPlaceBuilding(this.pendingBuild, gx, gy);
      else if (this.mode === 'landscape' && this.pendingDeco) this.placeDeco(gx, gy);
    });

    if (store.state.onboard === 'townhall') {
      this.mode = 'build';
      this.pendingBuild = 'townhall';
      this.setHint('Tap open ground to place your TOWN HALL (3x3).\nYour kingdom starts here.');
    }
  }

  private setHint(msg: string | null): void {
    this.hintText?.destroy();
    this.hintText = null;
    if (msg) {
      this.hintText = this.add.text(GAME_WIDTH / 2, 60, msg, {
        fontSize: '10px', color: '#ffee99', fontFamily: 'monospace', align: 'center',
        backgroundColor: '#332200dd', padding: { x: 8, y: 4 }, wordWrap: { width: GAME_WIDTH - 50 },
      }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 2);
    }
  }

  private defineTiles(): void {
    const tex = this.textures.get('world-tileset');
    const cell = (name: string, c: number, r: number) => {
      if (!tex.has(name)) tex.add(name, 0, c * 32, r * 32, 32, 32);
    };
    cell('t_grass', 0, 0);
    cell('clean_road', 3, 0);
  }

  private renderGround(): void {
    this.groundRT = this.add.renderTexture(OX, OY, KCOLS * TILE, KROWS * TILE).setOrigin(0, 0);
    for (let y = 0; y < KROWS; y++) {
      for (let x = 0; x < KCOLS; x++) {
        this.groundRT.drawFrame('world-tileset', 't_grass', x * TILE, y * TILE);
      }
    }
    const g = this.add.graphics();
    g.lineStyle(3, 0x2a3a5a, 1);
    g.strokeRect(OX - 2, OY - 2, KCOLS * TILE + 4, KROWS * TILE + 4);
  }

  private renderDecos(): void {
    this.decoLayer.removeAll(true);
    for (const d of store.state.decos) {
      const px = OX + d.gx * TILE, py = OY + d.gy * TILE;
      if (d.kind === 'path') {
        const img = this.add.image(px, py, 'world-tileset', 'clean_road').setOrigin(0, 0);
        this.decoLayer.add(img);
      } else if (d.kind === 'tree') {
        this.decoLayer.add(this.add.image(px + 16, py + 28, 'spr_tree').setOrigin(0.5, 1));
      } else {
        this.decoLayer.add(this.add.image(px + 16, py + 26, 'spr_shrub').setOrigin(0.5, 1));
      }
    }
  }

  private occupied(gx: number, gy: number): Building | null {
    for (const b of store.state.buildings) {
      if (gx >= b.gx && gx < b.gx + b.w && gy >= b.gy && gy < b.gy + b.h) return b;
    }
    return null;
  }

  private renderBuildings(): void {
    this.buildingLayer.removeAll(true);
    for (const b of store.state.buildings) {
      const bt = BUILDING_TYPES[b.type];
      const px = OX + b.gx * TILE, py = OY + b.gy * TILE;
      const w = b.w * TILE, hgt = b.h * TILE;
      const c = this.add.container(0, 0);
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.2);
      g.fillRect(px + 3, py + 6, w, hgt);
      g.fillStyle(bt.wall, 1);
      g.fillRect(px, py + hgt * 0.3, w, hgt * 0.7);
      g.fillStyle(bt.roof, 1);
      g.fillRect(px - 3, py, w + 6, hgt * 0.34);
      g.fillStyle(0xffffff, 0.18);
      g.fillRect(px - 3, py, w + 6, 4);
      g.fillStyle(0x5a3a1a, 1);
      g.fillRect(px + w / 2 - 7, py + hgt - 16, 14, 16);
      c.add(g);
      const stars = '★'.repeat(b.stars) + '☆'.repeat(Math.max(0, MAX_STARS - b.stars));
      c.add(this.add.text(px + w / 2, py - 3, `${b.name}\n${stars}`, {
        fontSize: '8px', color: '#ffe080', fontFamily: 'monospace', align: 'center',
        backgroundColor: '#000000aa', padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1));
      // HARD RULE 4: stars never exceed visible sprites — the dedicated stand here
      b.ledger.slice(0, b.stars).forEach((heroId, i) => {
        const hero = store.hero(heroId);
        if (!hero) return;
        const sx = px + 6 + (i % 3) * Math.max(14, (w - 12) / 2);
        const sy = py + hgt + 12 + Math.floor(i / 3) * 10;
        c.add(this.add.image(sx, sy, `spr_job_${hero.job}`).setOrigin(0.5, 1).setScale(0.5));
      });
      const hit = this.add.rectangle(px + w / 2, py + hgt / 2, w, hgt, 0, 0).setInteractive();
      hit.on('pointerdown', () => { if (this.mode === 'view') this.openBuilding(b); });
      c.add(hit);
      this.buildingLayer.add(c);
    }
  }

  private spawnAmbient(): void {
    // villagers (villagered heroes + a base pair) drift along the ground
    const vills = store.villagers().slice(0, 4);
    const count = 2 + vills.length;
    for (let i = 0; i < count; i++) {
      const hero = vills[i - 2];
      const key = hero ? `spr_job_${hero.job}` : 'spr_villager';
      const c = this.add.container(OX + 30 + ((i * 90) % (KCOLS * TILE - 60)), OY + 80 + ((i * 130) % (KROWS * TILE - 140)));
      c.add(this.add.image(0, 0, key).setOrigin(0.5, 0.9).setScale(0.6));
      if (hero) {
        c.add(this.add.text(0, -44, `${hero.name}\n(villager)`, {
          fontSize: '7px', color: '#c8c8a0', fontFamily: 'monospace', align: 'center',
          backgroundColor: '#00000088', padding: { x: 2, y: 1 },
        }).setOrigin(0.5, 1));
      }
      this.tweens.add({
        targets: c, x: c.x + 40 + Math.random() * 50, duration: 3000 + i * 700,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
  }

  // ---------------- build & landscape ----------------

  private openBuildMenu(): void {
    const { root, close } = modal(this, 'BUILD');
    let y = 118;
    const opts = buildable();
    if (store.state.onboard === 'townhall') {
      root.add(this.add.text(GAME_WIDTH / 2, y + 20, 'Place the Town Hall first.', {
        fontSize: '10px', color: '#e8a860', fontFamily: 'monospace',
      }).setOrigin(0.5, 0));
    }
    opts.slice(0, 7).forEach((bt) => {
      const afford = store.state.wood >= bt.cost.wood && store.state.stone >= bt.cost.stone && store.state.gold >= bt.cost.gold;
      root.add(this.add.text(26, y, `${bt.name} (${bt.w}x${bt.h})\n🪵${bt.cost.wood} 🪨${bt.cost.stone}${bt.cost.gold ? ` ⛃${bt.cost.gold}` : ''}`, {
        fontSize: '9px', color: afford ? '#cfe0f8' : '#667788', fontFamily: 'monospace',
      }));
      root.add(makeButton(this, GAME_WIDTH - 62, y + 12, 70, 26, 'PLACE', () => {
        if (!afford) { toast(this, 'Not enough materials', '#ff9090'); return; }
        close();
        this.mode = 'build';
        this.pendingBuild = bt.type;
        this.setHint(`Tap open ground to place the ${bt.name} (${bt.w}x${bt.h}). Tap BUILD again to cancel.`);
      }, { color: afford ? 0x2a7a3a : 0x2a3a4a, fontSize: '10px' }));
      y += 44;
    });
    // locked subclasses: seeing what you can't have is the mechanic
    const locked = lockedSubclassBuildings();
    if (locked.length) {
      root.add(this.add.text(26, y, '— LOCKED —', { fontSize: '9px', color: '#8899aa', fontFamily: 'monospace' }));
      y += 18;
      locked.slice(0, 4).forEach((L) => {
        root.add(this.add.text(26, y, `🔒 ${L.bt.name} — needs ${L.baseName} ★3 (now ${'★'.repeat(L.baseStars) || '0'})`, {
          fontSize: '9px', color: '#997755', fontFamily: 'monospace',
        }));
        y += 20;
      });
    }
  }

  private tryPlaceBuilding(type: string, gx: number, gy: number): void {
    const bt = BUILDING_TYPES[type];
    if (gx + bt.w > KCOLS || gy + bt.h > KROWS) { toast(this, 'Out of bounds', '#e8a860'); return; }
    for (let dy = 0; dy < bt.h; dy++) for (let dx = 0; dx < bt.w; dx++) {
      if (this.occupied(gx + dx, gy + dy)) { toast(this, 'Blocked — pick open ground', '#e8a860'); return; }
    }
    if (store.state.wood < bt.cost.wood || store.state.stone < bt.cost.stone || store.state.gold < bt.cost.gold) {
      toast(this, 'Not enough materials', '#ff9090');
      return;
    }
    store.state.wood -= bt.cost.wood;
    store.state.stone -= bt.cost.stone;
    store.state.gold -= bt.cost.gold;
    store.state.buildings.push({
      id: `${type}_${Date.now()}`, type, name: bt.name, gx, gy, w: bt.w, h: bt.h, stars: 0, ledger: [],
    });
    this.mode = 'view';
    this.pendingBuild = null;
    this.setHint(null);
    this.renderBuildings();
    this.refreshHud();
    toast(this, `${bt.name} raised`, '#a0e8a0');

    if (type === 'townhall' && store.state.onboard === 'townhall') {
      store.state.onboard = 'introDungeon';
      store.save();
      const { root, close } = modal(this, 'THE FIRST STONE');
      root.add(this.add.text(GAME_WIDTH / 2, 160,
        'The Town Hall stands. Your kingdom breathes.\n\nBelow, the blight stirs — a corrupted cellar\nhas opened beside your home.\n\nReturn to the WORLD and clear it.', {
          fontSize: '11px', color: '#cfe0f8', fontFamily: 'monospace', align: 'center', lineSpacing: 4,
        }).setOrigin(0.5, 0));
      root.add(makeButton(this, GAME_WIDTH / 2, 420, 200, 40, 'TO THE SURFACE →', () => {
        close();
        this.scene.start('WorldScene');
      }, { color: 0x2a4a8a }));
    } else {
      store.save();
    }
  }

  private openLandscapeMenu(): void {
    const { root, close } = modal(this, 'LANDSCAPING');
    root.add(this.add.text(GAME_WIDTH / 2, 122,
      'Shape the village. Paths, trees, shrubs.\n(One day your defense will be fought on this layout.)', {
        fontSize: '9px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0));
    const items: { kind: 'path' | 'tree' | 'shrub' | 'erase'; label: string; cost: string }[] = [
      { kind: 'path', label: 'Lay path', cost: '2🪨' },
      { kind: 'tree', label: 'Plant tree', cost: '4🪵' },
      { kind: 'shrub', label: 'Plant shrub', cost: '2🪵' },
      { kind: 'erase', label: 'Remove', cost: 'free' },
    ];
    items.forEach((it, i) => {
      root.add(makeButton(this, GAME_WIDTH / 2, 180 + i * 46, 240, 34, `${it.label} (${it.cost})`, () => {
        close();
        this.mode = 'landscape';
        this.pendingDeco = it.kind;
        this.setHint(`Landscaping: tap tiles to ${it.label.toLowerCase()}. Tap LANDSCAPE again to stop.`);
      }, { color: 0x3a6a5a }));
    });
  }

  private placeDeco(gx: number, gy: number): void {
    if (this.pendingDeco === 'erase') {
      store.state.decos = store.state.decos.filter((d) => !(d.gx === gx && d.gy === gy));
      store.save();
      this.renderDecos();
      return;
    }
    if (this.occupied(gx, gy)) { toast(this, 'A building stands there', '#e8a860'); return; }
    if (store.state.decos.some((d) => d.gx === gx && d.gy === gy)) return;
    const costs = { path: { wood: 0, stone: 2 }, tree: { wood: 4, stone: 0 }, shrub: { wood: 2, stone: 0 } };
    const cost = costs[this.pendingDeco!];
    if (store.state.wood < cost.wood || store.state.stone < cost.stone) { toast(this, 'Not enough materials', '#ff9090'); return; }
    store.state.wood -= cost.wood;
    store.state.stone -= cost.stone;
    store.state.decos.push({ kind: this.pendingDeco!, gx, gy });
    store.save();
    this.renderDecos();
    this.refreshHud();
  }

  // ---------------- building detail + ledger ----------------

  private openBuilding(b: Building): void {
    const bt = BUILDING_TYPES[b.type];
    const { root } = modal(this, `${b.name}  ${'★'.repeat(b.stars)}${'☆'.repeat(MAX_STARS - b.stars)}`);
    let y = 120;
    root.add(this.add.text(GAME_WIDTH / 2, y, bt.desc, {
      fontSize: '9px', color: '#aabbcc', fontFamily: 'monospace', align: 'center', wordWrap: { width: GAME_WIDTH - 70 },
    }).setOrigin(0.5, 0));
    y += 36;
    if (b.stars < MAX_STARS) {
      root.add(this.add.text(GAME_WIDTH / 2, y,
        `Next star: dedicate a hero with ${STAR_JP_GATES[b.stars]}+ total JP\n(dedication is PERMANENT — matching job grants a bonus)`, {
          fontSize: '9px', color: '#e8c860', fontFamily: 'monospace', align: 'center',
        }).setOrigin(0.5, 0));
      y += 34;
    }
    root.add(this.add.text(28, y, `SERVICE LEDGER — ${b.ledger.length} soul${b.ledger.length === 1 ? '' : 's'}`, {
      fontSize: '10px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }));
    y += 20;
    if (!b.ledger.length) {
      root.add(this.add.text(28, y, 'No hero has served here yet.', {
        fontSize: '9px', color: '#667788', fontFamily: 'monospace', fontStyle: 'italic',
      }));
    }
    b.ledger.slice(0, 7).forEach((heroId) => {
      const h = store.hero(heroId);
      if (!h) return;
      root.add(this.add.text(28, y,
        `${h.name} · ${h.job} · ${h.dedicated?.jpAtDedication ?? '?'} JP\n  found ${h.recruit.label}, ${h.recruit.date}\n  dedicated ${h.dedicated?.date ?? ''}`, {
          fontSize: '9px', color: '#cfe0f8', fontFamily: 'monospace', lineSpacing: 2,
        }));
      y += 46;
    });
  }

  // ---------------- tavern (doc 13: free, gated, 6h cooldown) ----------------

  private openTavern(): void {
    if (!store.hasBuilding('tavern')) {
      toast(this, 'Build the Waypoint Tavern first (BUILD menu)', '#e8a860');
      return;
    }
    const now = Date.now();
    if (now - store.state.tavern.rolledAt > TAVERN_COOLDOWN_MS || store.state.tavern.candidates.length === 0) {
      store.state.tavern = { rolledAt: now, candidates: rollTavern(hashStr(`tav|${now}`)) };
      store.save();
    }
    const { root, close } = modal(this, 'THE WAYPOINT TAVERN');
    const remaining = TAVERN_COOLDOWN_MS - (now - store.state.tavern.rolledAt);
    const hrs = Math.floor(remaining / 3600000), mins = Math.floor((remaining % 3600000) / 60000);
    let y = 116;
    root.add(this.add.text(GAME_WIDTH / 2, y, `Recruiting is free. New faces in ${hrs}h ${mins}m.\nA job's building must stand before its holder will join you.`, {
      fontSize: '9px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0));
    y += 38;

    store.state.tavern.candidates.slice(0, TAVERN_SLOTS).forEach((cand) => {
      const gate = canRecruit(cand);
      root.add(this.add.image(44, y + 18, `spr_job_${cand.job}`).setOrigin(0.5, 0.8).setScale(0.68));
      root.add(this.add.text(76, y, `${cand.name} the ${cand.job}\nLv${cand.charLevel} · Luck ${cand.luck}`, {
        fontSize: '9px', color: cand.taken ? '#556677' : gate.ok ? '#ffffff' : '#997755', fontFamily: 'monospace',
      }));
      if (cand.taken) {
        root.add(this.add.text(GAME_WIDTH - 70, y + 14, 'ENLISTED', { fontSize: '9px', color: '#557755', fontFamily: 'monospace' }).setOrigin(0.5));
      } else if (gate.ok) {
        root.add(makeButton(this, GAME_WIDTH - 70, y + 14, 88, 28, 'RECRUIT', () => {
          const h = createHero(cand.job, cand.charLevel, 'at the Waypoint Tavern');
          h.name = cand.name;
          h.luck = cand.luck;
          store.state.heroes.push(h);
          cand.taken = true;
          store.save();
          close();
          this.refreshHud();
          toast(this, `${h.name} the ${cand.job} enlists!`, '#a0d8ff');
        }, { color: 0x2a7a3a, fontSize: '10px' }));
      } else {
        // locked candidates name the exact building required [LOCKED]
        root.add(this.add.text(GAME_WIDTH - 70, y + 14, `🔒 ${gate.why}`, {
          fontSize: '8px', color: '#e8a860', fontFamily: 'monospace', align: 'center', wordWrap: { width: 110 },
        }).setOrigin(0.5));
      }
      y += 58;
    });

    root.add(makeButton(this, GAME_WIDTH / 2, y + 14, 230, 32, `↻ hurry new faces (${TAVERN_REROLL_COST} g)`, () => {
      if (store.state.gold < TAVERN_REROLL_COST) { toast(this, 'Not enough gold', '#ff9090'); return; }
      store.state.gold -= TAVERN_REROLL_COST;
      store.state.tavern = { rolledAt: Date.now(), candidates: rollTavern(hashStr(`tav|${Date.now()}`)) };
      store.save();
      this.refreshHud();
      close();
      this.openTavern();
    }, { color: 0x8a5a20, fontSize: '10px' }));
  }

  // ---------------- roster / hero detail / jobs / tree ----------------

  private openRoster(): void {
    const { root, close } = modal(this, `ROSTER · ${store.activeHeroes().length} active · ${store.villagers().length} villagers`);
    let y = 118;
    const list = [...store.activeHeroes(), ...store.villagers()];
    if (!list.length) {
      root.add(this.add.text(GAME_WIDTH / 2, y + 40, 'No heroes yet.\nThe tavern and the wild await.', {
        fontSize: '10px', color: '#8899aa', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0));
    }
    list.slice(0, 7).forEach((h) => {
      const jp = store.totalJpEarned(h);
      root.add(this.add.image(40, y + 15, `spr_job_${h.job}`).setOrigin(0.5, 0.8).setScale(0.58));
      root.add(this.add.text(68, y, `${h.name} · ${h.job} · Lv${h.charLevel}${h.villager ? ' · VILLAGER' : ''}\n${jp} JP earned · found ${h.recruit.label}`, {
        fontSize: '8px', color: h.villager ? '#c8c8a0' : '#cfe0f8', fontFamily: 'monospace',
      }));
      root.add(makeButton(this, GAME_WIDTH - 58, y + 12, 58, 24, 'VIEW', () => { close(); this.openHero(h); }, { color: 0x2a4a8a, fontSize: '9px' }));
      y += 48;
    });
  }

  private openHero(h: Hero): void {
    const { root, close } = modal(this, `${h.name} · ${h.job} · Lv ${h.charLevel}`);
    const st = effStats(h);
    const jp = h.jobs[h.job] ?? newJobProgress();
    let y = 114;
    root.add(this.add.image(46, y + 38, `spr_job_${h.job}`).setOrigin(0.5, 0.8).setScale(0.9));
    root.add(this.add.text(86, y,
      `HP ${st.hp}  ATK ${st.atk}  DEF ${st.def}\nspeed ${st.attackInterval}t · range ${st.range} · luck ${h.luck}\nult: ${ULTIMATES[JOBS[h.job].ultimates[h.equippedUlt]].name} (${st.ultCost} mana)`, {
        fontSize: '9px', color: '#cfe0f8', fontFamily: 'monospace', lineSpacing: 3,
      }));
    y += 50;
    root.add(this.add.text(86, y,
      `job Lv${jp.level} · ${jp.jpUnspent} JP unspent · ${store.totalJpEarned(h)} total\nchar xp ${h.charXp}/${charXpToNext(h.charLevel)} · job xp ${jp.xp}/${jobXpToNext(jp.level)}`, {
        fontSize: '8px', color: '#8899bb', fontFamily: 'monospace', lineSpacing: 2,
      }));
    y += 36;

    // stat allocation (STR/DEX/INT; HP not distributable; Luck innate)
    (['str', 'dex', 'int'] as const).forEach((s, i) => {
      root.add(makeButton(this, 62 + i * 84, y, 76, 26, `+${s.toUpperCase()} (${h.alloc[s]})`, () => {
        if (h.statPoints <= 0) { toast(this, 'No stat points'); return; }
        h.statPoints--;
        h.alloc[s]++;
        store.save();
        close(); this.openHero(h);
      }, { color: h.statPoints > 0 ? 0x2a6a3a : 0x2a3a4a, fontSize: '9px' }));
    });
    root.add(this.add.text(GAME_WIDTH - 40, y, `${h.statPoints} pts`, { fontSize: '9px', color: '#ffe080', fontFamily: 'monospace' }).setOrigin(0.5));
    y += 38;

    root.add(makeButton(this, 76, y, 120, 28, 'JOB TREE', () => { close(); this.openTree(h); }, { color: 0x5a3a8a, fontSize: '10px' }));
    root.add(makeButton(this, 206, y, 120, 28, 'CHANGE JOB', () => { close(); this.openJobs(h); }, { color: 0x3a5a8a, fontSize: '10px' }));
    y += 36;
    root.add(makeButton(this, 76, y, 120, 28, h.villager ? 'UN-VILLAGER' : 'MAKE VILLAGER', () => {
      h.villager = !h.villager;
      store.save();
      close();
      toast(this, h.villager ? `${h.name} takes up village work (reversible)` : `${h.name} returns to the roster`, '#c8c8a0');
      this.scene.restart();
    }, { color: 0x6a6a4a, fontSize: '9px' }));
    root.add(makeButton(this, 206, y, 120, 28, `RESPEC (${respecCost(h)}g)`, () => {
      if (respecJob(h)) { close(); this.openHero(h); this.refreshHud(); }
      else toast(this, 'Not enough gold', '#ff9090');
    }, { color: 0x555577, fontSize: '9px' }));
    y += 42;

    // dedication — gated behind a hero crossing the JP threshold (doc s.2)
    if (!store.dedicationUnlocked()) {
      root.add(this.add.text(GAME_WIDTH / 2, y, '— DEDICATION —\n(unlocks when a hero has earned 8+ JP —\na life must mean something before it can be given)', {
        fontSize: '8px', color: '#667788', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0));
    } else if (!h.villager && !h.dedicated) {
      root.add(this.add.text(GAME_WIDTH / 2, y, `— DEDICATION — permanent. the wall remembers.\n${h.name}: ${store.totalJpEarned(h)} JP earned → can grant star ${Math.min(MAX_STARS, store.maxStarReachable(h)) || '—'}`, {
        fontSize: '8px', color: '#e8c860', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0));
      y += 30;
      const options = store.state.buildings.filter((b) => b.stars < MAX_STARS && store.maxStarReachable(h) > b.stars).slice(0, 3);
      options.forEach((b) => {
        const jobMatch = BUILDING_TYPES[b.type].type === JOBS[h.job].building;
        root.add(makeButton(this, GAME_WIDTH / 2, y, 300, 26,
          `${b.name} ${'★'.repeat(b.stars)}→${'★'.repeat(b.stars + 1)}${jobMatch ? ' (job match: bonus!)' : ''}`, () => {
            confirmDialog(this, 'ARE YOU CERTAIN?',
              `Dedicate ${h.name} to the ${b.name}?\n\nThey will serve for the rest of their days.\nThis CANNOT be undone.\n\n(Villagering is reversible. This is not.\nThat difference is the game.)`,
              'DO IT', () => {
                h.dedicated = { buildingId: b.id, date: new Date().toLocaleDateString(), jpAtDedication: store.totalJpEarned(h) };
                b.stars++;
                b.ledger.push(h.id);
                store.save();
                close();
                this.scene.restart();
                toast(this, `${h.name} takes their post at the ${b.name}.\nTheir name is carved on the wall.`, '#e8c860');
              });
          }, { color: jobMatch ? 0x7a5a2a : 0x5a3a8a, fontSize: '8px' }));
        y += 32;
      });
      if (!options.length) {
        root.add(this.add.text(GAME_WIDTH / 2, y, `(no building can accept a star from ${store.totalJpEarned(h)} JP yet)`, {
          fontSize: '8px', color: '#667788', fontFamily: 'monospace',
        }).setOrigin(0.5, 0));
      }
    }
  }

  private openJobs(h: Hero): void {
    const { root, close } = modal(this, `${h.name} — CHANGE JOB`);
    let y = 118;
    root.add(this.add.text(GAME_WIDTH / 2, y, 'JP banks only into the worn job. Tree progress is permanent.\nSubclasses need their building + 15 JP in the parent.', {
      fontSize: '8px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0));
    y += 34;
    ALL_JOBS.forEach((job) => {
      const gate = canWearJob(h, job);
      const cur = h.job === job;
      const prog = h.jobs[job];
      const label = `${job}${prog ? ` (Lv${prog.level})` : ''}${cur ? ' — worn' : ''}`;
      root.add(makeButton(this, GAME_WIDTH / 2, y, 300, 28,
        cur ? label : gate.ok ? label : `🔒 ${label} — ${gate.why}`, () => {
          if (cur) return;
          if (!gate.ok) { toast(this, gate.why, '#e8a860'); return; }
          wearJob(h, job);
          store.save();
          close();
          toast(this, `${h.name} now walks as a ${job}`, '#a0d8ff');
          this.openHero(h);
        }, { color: cur ? 0x3a6acc : gate.ok ? 0x2a4a6a : 0x22293a, fontSize: '9px' }));
      y += 33;
    });
  }

  private openTree(h: Hero): void {
    const jp = h.jobs[h.job] ?? (h.jobs[h.job] = newJobProgress());
    const def = JOBS[h.job];
    const tree = jobTree(h.job);
    const { root, close } = modal(this, `${h.job} TREE · ${jp.jpUnspent} JP unspent`);
    let y = 112;

    // ultimate selection: trunk + unlocked branch tips
    root.add(this.add.text(24, y, 'ULTIMATE (one equipped):', { fontSize: '9px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }));
    y += 16;
    def.ultimates.forEach((uk, i) => {
      const u = ULTIMATES[uk];
      const branchPts = i === 0 ? 0 : tree.filter((n) => n.branch === i - 1 && jp.jpSpent.includes(n.id)).length;
      const unlocked = i === 0 || branchPts >= 5;
      const equipped = h.equippedUlt === i;
      root.add(makeButton(this, GAME_WIDTH / 2, y + 2, 314, 24,
        `${equipped ? '● ' : ''}${u.name} (${u.cost}m) ${i === 0 ? '· signature' : unlocked ? '' : `· 🔒 5 pts in ${def.branches[i - 1]}`}`, () => {
          if (!unlocked) { toast(this, `Invest 5 points in ${def.branches[i - 1]} first`, '#e8a860'); return; }
          h.equippedUlt = i;
          store.save();
          close(); this.openTree(h);
        }, { color: equipped ? 0x3a6acc : unlocked ? 0x2a4a6a : 0x22293a, fontSize: '8px' }));
      y += 27;
    });
    y += 8;

    // three branches of five nodes
    for (let b = 0; b < 3; b++) {
      const pts = tree.filter((n) => n.branch === b && jp.jpSpent.includes(n.id)).length;
      root.add(this.add.text(24, y, `${def.branches[b].toUpperCase()} (${pts}/5)`, {
        fontSize: '9px', color: '#e8c860', fontFamily: 'monospace', fontStyle: 'bold',
      }));
      y += 15;
      const rowNodes = tree.filter((n) => n.branch === b);
      rowNodes.forEach((n, i) => {
        const bought = jp.jpSpent.includes(n.id);
        const avail = nodeAvailable(n.slot, pts) && jp.jpUnspent > 0 && !bought;
        const e = n.effect;
        const fx = e.t === 'atk' ? `+${e.v}%atk` : e.t === 'hp' ? `+${e.v}%hp` : e.t === 'def' ? `+${e.v}def` : e.t === 'speed' ? 'faster' : e.t === 'ultcost' ? `-${e.v}ult` : `+${e.v}%crit`;
        root.add(makeButton(this, 52 + i * 58, y + 8, 52, 24, bought ? '●' : fx, () => {
          if (bought) return;
          if (!nodeAvailable(n.slot, pts)) { toast(this, 'Climb the branch in order', '#e8a860'); return; }
          if (jp.jpUnspent <= 0) { toast(this, 'No JP — win battles wearing this job', '#e8a860'); return; }
          jp.jpUnspent--;
          jp.jpSpent.push(n.id);
          store.save();
          close(); this.openTree(h);
        }, { color: bought ? 0x2a7a3a : avail ? 0x3a5a8a : 0x22293a, fontSize: '8px' }));
      });
      y += 38;
    }
  }

  // ---------------- the wall of honor ----------------

  private openWall(): void {
    const { root } = modal(this, 'THE WALL OF HONOR');
    const dedicated = store.state.heroes.filter((h) => h.dedicated);
    let y = 120;
    if (!dedicated.length) {
      root.add(this.add.text(GAME_WIDTH / 2, y + 40,
        'The wall stands empty.\n\nWhen a hero gives their life to a building,\ntheir name is carved here forever —\nname · job · JP · where they were found · date.', {
          fontSize: '10px', color: '#8899aa', fontFamily: 'monospace', align: 'center', lineSpacing: 3,
        }).setOrigin(0.5, 0));
      return;
    }
    dedicated.slice(0, 7).forEach((h) => {
      const b = store.state.buildings.find((x) => x.id === h.dedicated!.buildingId);
      root.add(this.add.text(26, y,
        `✦ ${h.name} · ${h.job} · ${h.dedicated!.jpAtDedication} JP\n  found ${h.recruit.label}, ${h.recruit.date}\n  gave their life to the ${b?.name ?? '?'}, ${h.dedicated!.date}`, {
          fontSize: '9px', color: '#ffe8b0', fontFamily: 'monospace', lineSpacing: 3,
        }));
      y += 52;
    });
  }
}
