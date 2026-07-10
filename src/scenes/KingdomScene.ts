// Your floating kingdom: buildings, tavern recruiting (gated by kingdom
// level), hero management, and the heart of the game — permanent dedication
// and the Wall of Honor. A building's star level always equals the number of
// dedicated hero sprites you can SEE standing at it.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, TILE, MAX_STARS, starLevelRequirement, TAVERN_REFRESH_COST } from '../config/constants';
import { store, Hero, Building } from '../core/save';
import { effectiveStats, xpToNext, respec, respecCost, rollTavernOffers, createHero } from '../game/heroes';
import { bakeAllSprites } from '../game/sprites';
import { hud, bottomNav, toast, modal, makeButton, UI_DEPTH } from '../game/ui';
import { dayKey, hashStr, mulberry32 } from '../core/rng';

const KCOLS = 11;
const KROWS = 16;
const OX = (GAME_WIDTH - KCOLS * TILE) / 2;
const OY = 66;

const BUILDING_STYLE: Record<string, { wall: number; roof: number }> = {
  townhall: { wall: 0xe8e0c8, roof: 0x4a6acc },
  tavern: { wall: 0xd8c8a0, roof: 0xc07a30 },
  knightschool: { wall: 0xc8c8d0, roof: 0x8a3030 },
  storage: { wall: 0xb8a880, roof: 0x6a5a3a },
  house: { wall: 0xe0d0b0, roof: 0x3a8a4a },
};

export class KingdomScene extends Phaser.Scene {
  private refreshHud: () => void = () => {};
  private buildMode = false;
  private buildingLayer!: Phaser.GameObjects.Container;
  private wandererObj: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: 'KingdomScene' });
  }

  create(): void {
    bakeAllSprites(this);
    this.defineTiles();
    this.renderGround();
    this.buildingLayer = this.add.container(0, 0);
    this.renderBuildings();
    this.spawnVillagers();
    this.spawnWanderer();

    const h = hud(this, 'KINGDOM  ·  above the clouds');
    this.refreshHud = h.refresh;
    bottomNav(this, 'kingdom');

    makeButton(this, 46, GAME_HEIGHT - 84, 74, 30, 'HEROES', () => this.openRoster(), { color: 0x2a4a8a }).setDepth(UI_DEPTH);
    makeButton(this, 132, GAME_HEIGHT - 84, 74, 30, 'TAVERN', () => this.openTavern(), { color: 0x8a5a20 }).setDepth(UI_DEPTH);
    makeButton(this, 224, GAME_HEIGHT - 84, 88, 30, 'THE WALL', () => this.openWall(), { color: 0x5a3a8a }).setDepth(UI_DEPTH);
    makeButton(this, GAME_WIDTH - 40, GAME_HEIGHT - 84, 58, 30, 'BUILD', () => {
      this.buildMode = !this.buildMode;
      toast(this, this.buildMode ? 'Tap an open 2x2 area to raise a cottage (60🪵 40🪨)' : 'Build mode off');
    }, { color: 0x2a6a3a }).setDepth(UI_DEPTH);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.buildMode) return;
      if (p.y < OY || p.y > OY + KROWS * TILE) return;
      const gx = Math.floor((p.x - OX) / TILE);
      const gy = Math.floor((p.y - OY) / TILE);
      this.tryBuild(gx, gy);
    });
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
    const rt = this.add.renderTexture(OX, OY, KCOLS * TILE, KROWS * TILE).setOrigin(0, 0);
    for (let y = 0; y < KROWS; y++) {
      for (let x = 0; x < KCOLS; x++) {
        const road = (y === 6 || y === 7) || (x === 5 && y > 3);
        rt.drawFrame('world-tileset', road ? 'clean_road' : 't_grass', x * TILE, y * TILE);
      }
    }
    // island edge
    const g = this.add.graphics();
    g.lineStyle(3, 0x2a3a5a, 1);
    g.strokeRect(OX - 2, OY - 2, KCOLS * TILE + 4, KROWS * TILE + 4);
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
      const px = OX + b.gx * TILE;
      const py = OY + b.gy * TILE;
      const w = b.w * TILE, hgt = b.h * TILE;
      const style = BUILDING_STYLE[b.type] ?? BUILDING_STYLE.house;

      const c = this.add.container(0, 0);
      const g = this.add.graphics();
      // shadow, walls, roof
      g.fillStyle(0x000000, 0.2);
      g.fillRect(px + 3, py + 6, w, hgt);
      g.fillStyle(style.wall, 1);
      g.fillRect(px, py + hgt * 0.3, w, hgt * 0.7);
      g.fillStyle(style.roof, 1);
      g.fillRect(px - 3, py, w + 6, hgt * 0.34);
      g.fillStyle(0xffffff, 0.18);
      g.fillRect(px - 3, py, w + 6, 5);
      // door
      g.fillStyle(0x5a3a1a, 1);
      g.fillRect(px + w / 2 - 7, py + hgt - 18, 14, 18);
      c.add(g);

      // name + stars
      const stars = '★'.repeat(b.stars) + '☆'.repeat(Math.max(0, MAX_STARS - b.stars));
      c.add(this.add.text(px + w / 2, py - 4, `${b.name}\n${stars}`, {
        fontSize: '8px', color: '#ffe080', fontFamily: 'monospace', align: 'center',
        backgroundColor: '#000000aa', padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1));

      // THE RULE: one visible sprite per star — the dedicated stand at their post
      b.ledger.slice(0, b.stars).forEach((heroId, i) => {
        const hero = store.hero(heroId);
        if (!hero) return;
        const sx = px + 8 + (i % 3) * ((w - 16) / 2);
        const sy = py + hgt + 12 + Math.floor(i / 3) * 10;
        const img = this.add.image(sx, sy, `spr_hero_${hero.cls}`).setOrigin(0.5, 1).setScale(0.55);
        c.add(img);
      });

      const hit = this.add.rectangle(px + w / 2, py + hgt / 2, w, hgt, 0, 0).setInteractive();
      hit.on('pointerdown', () => { if (!this.buildMode) this.openBuilding(b); });
      c.add(hit);

      this.buildingLayer.add(c);
    }
  }

  private spawnVillagers(): void {
    for (let i = 0; i < 3; i++) {
      const c = this.add.container(OX + (2 + i * 3) * TILE + 16, OY + 7 * TILE + 16);
      const img = this.add.image(0, 0, 'spr_villager').setOrigin(0.5, 0.9).setScale(0.6);
      c.add(img);
      this.tweens.add({
        targets: c,
        x: c.x + (Math.random() * 80 - 40),
        duration: 2600 + i * 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  // A hero wanders through daily — recruit on sight (design doc s.2 source 2)
  private spawnWanderer(): void {
    const key = `wanderer|${dayKey()}`;
    if (store.state.consumed[key] === dayKey()) return;
    const r = mulberry32(hashStr(key));
    const classes = ['Knight', 'Archer', 'Rogue', 'Mage', 'Cleric'] as const;
    const cls = classes[Math.floor(r() * classes.length)];
    const level = Math.max(1, store.kingdomLevel() + Math.floor(r() * 2));
    const cost = 80 + level * 30;

    const c = this.add.container(OX + 16, OY + 6 * TILE + 16);
    c.add(this.add.image(0, 0, `spr_hero_${cls}`).setOrigin(0.5, 0.85).setScale(0.7));
    const tag = this.add.text(0, -46, `traveller\nLv${level} ${cls}`, {
      fontSize: '8px', color: '#a0d8ff', fontFamily: 'monospace', align: 'center',
      backgroundColor: '#000000aa', padding: { x: 3, y: 1 },
    }).setOrigin(0.5, 1);
    c.add(tag);
    this.tweens.add({ targets: c, x: OX + (KCOLS - 1) * TILE, duration: 26000, repeat: -1, yoyo: true });

    const hit = this.add.rectangle(0, -14, 36, 52, 0, 0).setInteractive();
    hit.on('pointerdown', () => {
      const { close } = this.confirm(
        `Recruit this traveller?\n\nLv${level} ${cls} — ${cost} gold`,
        () => {
          if (store.state.gold < cost) { toast(this, 'Not enough gold', '#ff9090'); return; }
          store.state.gold -= cost;
          const h = createHero(cls, level, 'wandering through your kingdom', 0, 0);
          store.state.heroes.push(h);
          store.state.consumed[key] = dayKey();
          store.save();
          this.refreshHud();
          c.destroy();
          toast(this, `${h.name} the ${cls} joins you!`, '#a0d8ff');
          close();
        }
      );
    });
    c.add(hit);
    this.wandererObj = c;
  }

  private tryBuild(gx: number, gy: number): void {
    if (gx < 0 || gy < 0 || gx + 2 > KCOLS || gy + 2 > KROWS) return;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      if (this.occupied(gx + dx, gy + dy)) { toast(this, 'Blocked — pick open ground', '#e8a860'); return; }
    }
    if (store.state.wood < 60 || store.state.stone < 40) {
      toast(this, 'Need 60 wood and 40 stone', '#ff9090');
      return;
    }
    store.state.wood -= 60;
    store.state.stone -= 40;
    store.state.buildings.push({
      id: `house_${Date.now()}`, type: 'house', name: 'Cottage', gx, gy, w: 2, h: 2, stars: 0, ledger: [],
    });
    store.save();
    this.buildMode = false;
    this.renderBuildings();
    this.refreshHud();
    toast(this, 'Cottage raised — villagers will produce more while you roam', '#a0e8a0');
  }

  // ---------------- building panel: stars + THE LEDGER ----------------

  private openBuilding(b: Building): void {
    const { root } = modal(this, `${b.name}  ${'★'.repeat(b.stars)}${'☆'.repeat(MAX_STARS - b.stars)}`);
    let y = 122;

    const desc: Record<string, string> = {
      townhall: 'Seat of your kingdom. Total stars raise your Kingdom Level,\nwhich gates who appears at the tavern.',
      tavern: 'Recruits wait here. Kingdom Level decides their quality.',
      knightschool: 'Dedicated instructors train the next generation.',
      storage: 'Each star extends offline production cap by 2h.',
      house: 'Villagers live here and produce materials while you roam.',
    };
    root.add(this.add.text(GAME_WIDTH / 2, y, desc[b.type] ?? '', {
      fontSize: '9px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0));
    y += 40;

    if (b.stars < MAX_STARS) {
      const req = starLevelRequirement(b.stars + 1);
      root.add(this.add.text(GAME_WIDTH / 2, y,
        `Next star: dedicate a hero of Lv ${req}+\n(dedication is PERMANENT — the wall remembers)`, {
          fontSize: '9px', color: '#e8c860', fontFamily: 'monospace', align: 'center',
        }).setOrigin(0.5, 0));
      y += 36;
    }

    root.add(this.add.text(30, y, `SERVICE LEDGER — ${b.ledger.length} soul${b.ledger.length === 1 ? '' : 's'}`, {
      fontSize: '10px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }));
    y += 20;

    if (b.ledger.length === 0) {
      root.add(this.add.text(30, y, 'No hero has served here yet.', {
        fontSize: '9px', color: '#667788', fontFamily: 'monospace', fontStyle: 'italic',
      }));
    }
    b.ledger.slice(0, 8).forEach((heroId) => {
      const h = store.hero(heroId);
      if (!h) return;
      root.add(this.add.text(30, y,
        `${h.name} — ${h.cls} — Lv ${h.level}\n  Recruited ${h.recruit.label}, ${h.recruit.date}\n  Dedicated ${h.dedicated?.date ?? ''}`, {
          fontSize: '9px', color: '#cfe0f8', fontFamily: 'monospace', lineSpacing: 2,
        }));
      y += 46;
    });
  }

  // ---------------- tavern ----------------

  private openTavern(): void {
    const today = dayKey();
    if (store.state.tavern.day !== today) {
      store.state.tavern = {
        day: today,
        offers: rollTavernOffers(store.kingdomLevel(), hashStr(`tavern|${today}`)),
      };
      store.save();
    }

    const { root, close } = modal(this, `THE WAYPOINT TAVERN  ·  Kingdom Lv ${store.kingdomLevel()}`);
    let y = 128;
    root.add(this.add.text(GAME_WIDTH / 2, y,
      'Higher Kingdom Level → stronger classes, higher levels.\nStars from dedication raise Kingdom Level.', {
        fontSize: '9px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0));
    y += 42;

    store.state.tavern.offers.forEach((o, i) => {
      const taken = o.cost < 0;
      root.add(this.add.image(46, y + 20, `spr_hero_${o.cls}`).setOrigin(0.5, 0.8).setScale(0.7));
      root.add(this.add.text(80, y, `${o.name} the ${o.cls}\nLv ${o.level}`, {
        fontSize: '10px', color: taken ? '#556677' : '#ffffff', fontFamily: 'monospace',
      }));
      if (!taken) {
        root.add(makeButton(this, GAME_WIDTH - 74, y + 16, 96, 30, `${o.cost} g`, () => {
          if (store.state.gold < o.cost) { toast(this, 'Not enough gold', '#ff9090'); return; }
          store.state.gold -= o.cost;
          const h = createHero(o.cls, o.level, 'at the Waypoint Tavern', 0, 0);
          h.name = o.name;
          store.state.heroes.push(h);
          o.cost = -1;
          store.save();
          this.refreshHud();
          close();
          toast(this, `${h.name} the ${h.cls} enlists!`, '#a0d8ff');
        }, { color: 0x2a7a3a }));
      } else {
        root.add(this.add.text(GAME_WIDTH - 74, y + 16, 'ENLISTED', {
          fontSize: '10px', color: '#557755', fontFamily: 'monospace',
        }).setOrigin(0.5));
      }
      y += 62;
    });

    root.add(makeButton(this, GAME_WIDTH / 2, y + 16, 220, 32, `↻ new faces (${TAVERN_REFRESH_COST} g)`, () => {
      if (store.state.gold < TAVERN_REFRESH_COST) { toast(this, 'Not enough gold', '#ff9090'); return; }
      store.state.gold -= TAVERN_REFRESH_COST;
      store.state.tavern.offers = rollTavernOffers(store.kingdomLevel(), hashStr(`tavern|${Date.now()}`));
      store.save();
      this.refreshHud();
      close();
      this.openTavern();
    }, { color: 0x8a5a20 }));
  }

  // ---------------- roster / hero detail / dedication ----------------

  private openRoster(): void {
    const { root, close } = modal(this, `YOUR KNIGHTS  ·  ${store.livingHeroes().length} active`);
    let y = 126;
    const living = store.livingHeroes();
    if (living.length === 0) {
      root.add(this.add.text(GAME_WIDTH / 2, y + 30,
        'No active heroes.\nFind them in the wild, or recruit at the tavern.', {
          fontSize: '10px', color: '#8899aa', fontFamily: 'monospace', align: 'center',
        }).setOrigin(0.5, 0));
    }
    living.slice(0, 7).forEach((h) => {
      root.add(this.add.image(44, y + 16, `spr_hero_${h.cls}`).setOrigin(0.5, 0.8).setScale(0.62));
      root.add(this.add.text(74, y, `${h.name} — ${h.cls} Lv${h.level}${h.statPoints > 0 ? `  (+${h.statPoints} pts)` : ''}\nxp ${h.xp}/${xpToNext(h.level)}  ·  ${h.recruit.label}`, {
        fontSize: '9px', color: '#cfe0f8', fontFamily: 'monospace',
      }));
      root.add(makeButton(this, GAME_WIDTH - 62, y + 14, 66, 26, 'VIEW', () => {
        close();
        this.openHero(h);
      }, { color: 0x2a4a8a }));
      y += 52;
    });
  }

  private openHero(h: Hero): void {
    const { root, close } = modal(this, `${h.name} the ${h.cls} — Lv ${h.level}`);
    const st = effectiveStats(h);
    let y = 124;

    root.add(this.add.image(52, y + 40, `spr_hero_${h.cls}`).setOrigin(0.5, 0.8));
    root.add(this.add.text(96, y,
      `HP  ${st.hp}\nATK ${st.atk}\nDEF ${st.def}\nSPD ${st.spd}\nrange ${st.range}`, {
        fontSize: '10px', color: '#cfe0f8', fontFamily: 'monospace', lineSpacing: 3,
      }));
    root.add(this.add.text(200, y,
      `xp ${h.xp}/${xpToNext(h.level)}\npoints: ${h.statPoints}\n\n${h.recruit.label}\n${h.recruit.date}`, {
        fontSize: '9px', color: '#8899bb', fontFamily: 'monospace', lineSpacing: 2,
      }));
    y += 92;

    // stat allocation
    const stats: ('hp' | 'atk' | 'def' | 'spd')[] = ['hp', 'atk', 'def', 'spd'];
    stats.forEach((s, i) => {
      root.add(makeButton(this, 56 + i * 66, y, 58, 26, `+${s.toUpperCase()}`, () => {
        if (h.statPoints <= 0) { toast(this, 'No points to spend'); return; }
        h.statPoints--;
        h.alloc[s]++;
        store.save();
        close();
        this.openHero(h);
      }, { color: h.statPoints > 0 ? 0x2a6a3a : 0x334455 }));
    });
    y += 40;

    root.add(makeButton(this, GAME_WIDTH / 2, y, 240, 28, `respec (${respecCost(h)} g — inconvenient, not costly)`, () => {
      if (respec(h)) { close(); this.openHero(h); this.refreshHud(); }
      else toast(this, 'Not enough gold', '#ff9090');
    }, { color: 0x555577, fontSize: '9px' }));
    y += 46;

    root.add(this.add.text(GAME_WIDTH / 2, y, '— DEDICATION —\npermanent. no recall. the wall remembers.', {
      fontSize: '9px', color: '#e8c860', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0));
    y += 34;

    store.state.buildings.filter((b) => b.stars < MAX_STARS).slice(0, 4).forEach((b) => {
      const req = starLevelRequirement(b.stars + 1);
      const ok = h.level >= req;
      root.add(makeButton(this, GAME_WIDTH / 2, y, 300, 28,
        `${b.name}  ${'★'.repeat(b.stars)} → ${'★'.repeat(b.stars + 1)}   (needs Lv${req})`, () => {
          if (!ok) { toast(this, `${h.name} must reach Lv${req} first`, '#e8a860'); return; }
          this.confirmDedication(h, b, close);
        }, { color: ok ? 0x5a3a8a : 0x2a2a3a, fontSize: '9px' }));
      y += 34;
    });
  }

  private confirmDedication(h: Hero, b: Building, closeParent: () => void): void {
    this.confirm(
      `Dedicate ${h.name} to the ${b.name}?\n\n` +
      `He will serve for the rest of his days.\n` +
      `This CANNOT be undone.\n\n` +
      `${b.name}: ${'★'.repeat(b.stars)} → ${'★'.repeat(b.stars + 1)}`,
      () => {
        h.dedicated = { buildingId: b.id, date: new Date().toLocaleDateString() };
        b.stars++;
        b.ledger.push(h.id);
        store.save();
        closeParent();
        this.renderBuildings();
        this.refreshHud();
        toast(this, `${h.name} takes his post at the ${b.name}.\nHis name is written on the wall.`, '#e8c860');
      }
    );
  }

  private confirm(message: string, onYes: () => void): { close: () => void } {
    const { root, close } = modal(this, 'ARE YOU CERTAIN?');
    root.add(this.add.text(GAME_WIDTH / 2, 150, message, {
      fontSize: '10px', color: '#ffdddd', fontFamily: 'monospace', align: 'center', lineSpacing: 3,
    }).setOrigin(0.5, 0));
    root.add(makeButton(this, GAME_WIDTH / 2 - 70, 400, 110, 36, 'DO IT', () => { close(); onYes(); }, { color: 0x8a3333 }));
    root.add(makeButton(this, GAME_WIDTH / 2 + 70, 400, 110, 36, 'not yet', close, { color: 0x334455 }));
    return { close };
  }

  // ---------------- the wall of honor ----------------

  private openWall(): void {
    const { root } = modal(this, 'THE WALL OF HONOR');
    const dedicated = store.state.heroes.filter((h) => h.dedicated);
    let y = 126;
    if (dedicated.length === 0) {
      root.add(this.add.text(GAME_WIDTH / 2, y + 40,
        'The wall stands empty.\n\nWhen a hero gives their life to a building,\ntheir name is carved here forever.', {
          fontSize: '10px', color: '#8899aa', fontFamily: 'monospace', align: 'center', lineSpacing: 3,
        }).setOrigin(0.5, 0));
      return;
    }
    dedicated.slice(0, 7).forEach((h) => {
      const b = store.building(h.dedicated!.buildingId);
      root.add(this.add.text(30, y,
        `✦ ${h.name} — ${h.cls} — Lv ${h.level}\n  Recruited ${h.recruit.label}, ${h.recruit.date}\n  Dedicated to the ${b?.name ?? '?'}, ${h.dedicated!.date}`, {
          fontSize: '9px', color: '#ffe8b0', fontFamily: 'monospace', lineSpacing: 3,
        }));
      y += 52;
    });
  }
}
