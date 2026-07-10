import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT, TILE, WORLD_TX, WORLD_TY, METERS_PER_TILE,
  INTERACT_RADIUS_M, BATTLE_COLS, BATTLE_ROWS, DUNGEON_FLOORS,
} from '../config/constants';
import { geo, GeoPos, haversineM, TELEPORT_PRESETS } from '../core/geo';
import { getMapData, OSMFeature } from '../core/osm';
import { store } from '../core/save';
import { createHero } from '../game/heroes';
import { bakeAllSprites, MONSTER_SPRITES } from '../game/sprites';
import { hud, bottomNav, toast, modal, makeButton, UI_DEPTH } from '../game/ui';
import { mulberry32, hashStr, dayKey, cellKey } from '../core/rng';

type Terrain = 'grass' | 'water' | 'forest' | 'path' | 'mountain' | 'town' | 'sand' | 'park';

const PRIORITY: Record<Terrain, number> = {
  grass: 0, park: 1, forest: 2, sand: 3, path: 4, town: 5, water: 6, mountain: 7,
};

const AUTOTILE_BLOCKS: Record<string, [number, number]> = {
  water: [0, 1], forest: [4, 1], mountain: [0, 5], road: [4, 5], sand: [0, 9],
};
const TERRAIN_BLOCK: Record<Terrain, string | null> = {
  water: 'water', forest: 'forest', mountain: 'mountain', path: 'road', sand: 'sand',
  grass: null, park: null, town: null,
};

interface Marker {
  key: string;
  kind: 'chest' | 'wood' | 'stone' | 'monster' | 'boss' | 'dungeon' | 'hero';
  tx: number;
  ty: number;
  level: number;
  label: string;
  obj: Phaser.GameObjects.Container;
}

export class WorldScene extends Phaser.Scene {
  private terrain: Terrain[][] = [];
  private features: OSMFeature[] = [];
  private pinned: GeoPos = { lat: 0, lon: 0 };
  private worldRoot!: Phaser.GameObjects.Container;
  private mapLayer!: Phaser.GameObjects.Container;
  private markerLayer!: Phaser.GameObjects.Container;
  private playerObj!: Phaser.GameObjects.Container;
  private ring!: Phaser.GameObjects.Graphics;
  private markers: Marker[] = [];
  private refreshHud: () => void = () => {};

  // pan state
  private maxPanX = 0;
  private maxPanY = 0;
  private panning = false;
  private panMoved = false;
  private panSX = 0; private panSY = 0; private panOX = 0; private panOY = 0;
  private recenterBtn!: Phaser.GameObjects.Container;

  // admin
  private teleportTapMode = false;
  private admBanner: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: 'WorldScene' });
  }

  create(): void {
    bakeAllSprites(this);
    this.defineTilesetFrames();

    const baseX = (GAME_WIDTH - WORLD_TX * TILE) / 2;
    const baseY = (GAME_HEIGHT - WORLD_TY * TILE) / 2;
    this.maxPanX = (WORLD_TX * TILE - GAME_WIDTH) / 2;
    this.maxPanY = (WORLD_TY * TILE - GAME_HEIGHT) / 2;

    this.worldRoot = this.add.container(0, 0);
    this.mapLayer = this.add.container(baseX, baseY);
    this.markerLayer = this.add.container(baseX, baseY);
    this.worldRoot.add([this.mapLayer, this.markerLayer]);

    // interaction ring + player
    this.ring = this.add.graphics();
    this.markerLayer.add(this.ring);
    this.playerObj = this.makePlayer();
    this.markerLayer.add(this.playerObj);

    const mapData = this.registry.get('mapData') as { features: OSMFeature[]; pinned: GeoPos } | null;
    this.registry.remove('mapData');
    this.buildWorld(mapData);

    this.setupPanning();
    this.recenterBtn = makeButton(this, 44, GAME_HEIGHT - 84, 64, 30, '⌖ center', () => this.recenter(), { color: 0x1c2c4c });
    this.recenterBtn.setDepth(UI_DEPTH);

    const h = hud(this, 'WORLD  ·  the surface');
    this.refreshHud = h.refresh;
    bottomNav(this, 'world');

    // admin button
    const adm = makeButton(this, GAME_WIDTH - 40, GAME_HEIGHT - 84, 56, 30, 'ADMIN', () => this.openAdmin(), {
      color: store.state.admin.enabled ? 0x8a5a20 : 0x1c2c4c,
    });
    adm.setDepth(UI_DEPTH);
    this.updateAdmBanner();

    const offline = this.registry.get('offlineReport') as { wood: number; stone: number } | undefined;
    if (offline) {
      this.registry.remove('offlineReport');
      toast(this, `Your villagers produced 🪵${offline.wood} 🪨${offline.stone} while you were away`, '#a0e8a0');
    }

    geo.onChange(() => this.onPositionChanged());
    this.time.addEvent({ delay: 2500, loop: true, callback: () => this.onPositionChanged() });
  }

  // ---------------- world build ----------------

  private async buildWorld(mapData: { features: OSMFeature[]; pinned: GeoPos } | null): Promise<void> {
    if (mapData) {
      this.features = mapData.features;
      this.pinned = mapData.pinned;
      this.genTerrainFromOSM();
    } else {
      this.features = [];
      this.pinned = { ...geo.pos };
      this.genProceduralTerrain();
      toast(this, 'Map data unavailable — the mists shroud this land (fallback terrain)', '#e8a860');
    }
    this.renderTerrain();
    this.spawnMarkers();
    this.updatePlayer();
  }

  private async reloadWorld(): Promise<void> {
    const data = await getMapData(geo.pos);
    this.markers.forEach((m) => m.obj.destroy());
    this.markers = [];
    this.buildWorld(data);
  }

  private genProceduralTerrain(): void {
    this.terrain = [];
    const r = mulberry32(hashStr(cellKey(this.pinned.lat, this.pinned.lon)));
    const blobs: { t: Terrain; cx: number; cy: number; rad: number }[] = [];
    const kinds: Terrain[] = ['water', 'forest', 'forest', 'mountain', 'town', 'sand'];
    for (let i = 0; i < 8; i++) {
      blobs.push({
        t: kinds[Math.floor(r() * kinds.length)],
        cx: r() * WORLD_TX, cy: r() * WORLD_TY, rad: 2 + r() * 4,
      });
    }
    for (let y = 0; y < WORLD_TY; y++) {
      this.terrain[y] = [];
      for (let x = 0; x < WORLD_TX; x++) {
        let t: Terrain = 'grass';
        for (const b of blobs) {
          if ((x - b.cx) ** 2 + (y - b.cy) ** 2 < b.rad ** 2) t = b.t;
        }
        this.terrain[y][x] = t;
      }
    }
    // a road through the middle
    const ry = Math.floor(WORLD_TY / 2) + Math.floor(r() * 4) - 2;
    for (let x = 0; x < WORLD_TX; x++) for (let dy = 0; dy < 2; dy++) this.terrain[ry + dy][x] = 'path';
  }

  private genTerrainFromOSM(): void {
    this.terrain = [];
    for (let y = 0; y < WORLD_TY; y++) {
      this.terrain[y] = [];
      for (let x = 0; x < WORLD_TX; x++) this.terrain[y][x] = 'grass';
    }
    const typeToTerrain: Record<string, Terrain> = {
      building: 'town', road: 'path', water: 'water', forest: 'forest', park: 'park', parking: 'sand',
    };
    for (const f of this.features) {
      const terr = typeToTerrain[f.type];
      if (!terr) continue;
      const pts = f.geometry.map((p) => this.latLonToTileF(p.lat, p.lon));
      if (f.type === 'road') {
        for (let i = 0; i < pts.length - 1; i++) {
          this.stampLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, terr);
        }
      } else {
        this.fillPoly(pts, terr);
      }
    }
  }

  private stampLine(x0f: number, y0f: number, x1f: number, y1f: number, terr: Terrain): void {
    let x0 = Math.round(x0f), y0 = Math.round(y0f);
    const x1 = Math.round(x1f), y1 = Math.round(y1f);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      for (let ox = 0; ox <= 1; ox++) for (let oy = 0; oy <= 1; oy++) {
        const tx = x0 + ox, ty = y0 + oy;
        if (tx >= 0 && tx < WORLD_TX && ty >= 0 && ty < WORLD_TY) {
          if (PRIORITY[terr] >= PRIORITY[this.terrain[ty][tx]]) this.terrain[ty][tx] = terr;
        }
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  private fillPoly(pts: { x: number; y: number }[], terr: Terrain): void {
    let minX = WORLD_TX, maxX = 0, minY = WORLD_TY, maxY = 0;
    for (const p of pts) {
      minX = Math.min(minX, Math.floor(p.x)); maxX = Math.max(maxX, Math.ceil(p.x));
      minY = Math.min(minY, Math.floor(p.y)); maxY = Math.max(maxY, Math.ceil(p.y));
    }
    for (let y = Math.max(0, minY); y <= Math.min(WORLD_TY - 1, maxY); y++) {
      for (let x = Math.max(0, minX); x <= Math.min(WORLD_TX - 1, maxX); x++) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside && PRIORITY[terr] >= PRIORITY[this.terrain[y][x]]) this.terrain[y][x] = terr;
      }
    }
  }

  // ---------------- tileset rendering ----------------

  private defineTilesetFrames(): void {
    const tex = this.textures.get('world-tileset');
    const cell = (name: string, c: number, r: number) => {
      if (!tex.has(name)) tex.add(name, 0, c * 32, r * 32, 32, 32);
    };
    cell('t_grass', 0, 0);
    const clean: Record<string, number> = { water: 1, forest: 2, road: 3, sand: 4, mountain: 5 };
    Object.entries(clean).forEach(([k, c]) => cell(`clean_${k}`, c, 0));
    cell('t_town_blue', 6, 0);
    cell('t_town_red', 7, 0);
    Object.entries(AUTOTILE_BLOCKS).forEach(([k, [bc, br]]) => {
      for (let m = 0; m < 16; m++) cell(`at_${k}_${m}`, bc + (m & 3), br + (m >> 2));
    });
  }

  private noise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  private frameFor(x: number, y: number): string {
    const terr = this.terrain[y][x];
    if (terr === 'town') {
      const v = this.noise(Math.floor(x / 2) * 2.3 + 1, Math.floor(y / 2) * 2.3 + 1);
      return v > 0.5 ? 't_town_blue' : 't_town_red';
    }
    const key = TERRAIN_BLOCK[terr];
    if (!key) return 't_grass';
    const same = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= WORLD_TX || ny >= WORLD_TY) return true;
      return TERRAIN_BLOCK[this.terrain[ny][nx]] === key;
    };
    const n = same(x, y - 1), s = same(x, y + 1), e = same(x + 1, y), w = same(x - 1, y);
    let m = 0;
    if (n && w) m |= 1;
    if (n && e) m |= 2;
    if (s && e) m |= 4;
    if (s && w) m |= 8;
    return m === 15 ? `clean_${key}` : `at_${key}_${m}`;
  }

  private renderTerrain(): void {
    this.mapLayer.removeAll(true);
    const rt = this.add.renderTexture(0, 0, WORLD_TX * TILE, WORLD_TY * TILE).setOrigin(0, 0);
    for (let y = 0; y < WORLD_TY; y++) {
      for (let x = 0; x < WORLD_TX; x++) {
        rt.drawFrame('world-tileset', this.frameFor(x, y), x * TILE, y * TILE);
      }
    }
    this.mapLayer.add(rt);
  }

  // ---------------- coordinates ----------------

  private latPerTile(): number { return METERS_PER_TILE / 111000; }
  private lonPerTile(): number {
    return METERS_PER_TILE / (111000 * Math.cos((this.pinned.lat * Math.PI) / 180));
  }
  private latLonToTileF(lat: number, lon: number): { x: number; y: number } {
    return {
      x: (lon - this.pinned.lon) / this.lonPerTile() + WORLD_TX / 2,
      y: (this.pinned.lat - lat) / this.latPerTile() + WORLD_TY / 2,
    };
  }
  private tileToLatLon(tx: number, ty: number): GeoPos {
    return {
      lat: this.pinned.lat - (ty - WORLD_TY / 2) * this.latPerTile(),
      lon: this.pinned.lon + (tx - WORLD_TX / 2) * this.lonPerTile(),
    };
  }

  // ---------------- markers / daily spawns ----------------

  private walkableTile(x: number, y: number): boolean {
    const t = this.terrain[y]?.[x];
    return t !== undefined && t !== 'water' && t !== 'town' && t !== 'mountain';
  }

  private spawnMarkers(): void {
    const day = dayKey();
    const seed = hashStr(`${day}|${cellKey(this.pinned.lat, this.pinned.lon)}`);
    const r = mulberry32(seed);
    const avgLv = this.avgHeroLevel();

    const randTile = (): { x: number; y: number } => {
      for (let i = 0; i < 60; i++) {
        const x = 2 + Math.floor(r() * (WORLD_TX - 4));
        const y = 2 + Math.floor(r() * (WORLD_TY - 4));
        if (this.walkableTile(x, y)) return { x, y };
      }
      return { x: Math.floor(WORLD_TX / 2) + 2, y: Math.floor(WORLD_TY / 2) + 2 };
    };

    // Dungeons: real POIs first, synthesized fallback second (launch requirement)
    const pois = this.features.filter((f) => f.poi);
    const dungeonSpots: { tx: number; ty: number; name: string; id: string }[] = [];
    for (const p of pois) {
      const c = this.polyCenter(p.geometry);
      const t = this.latLonToTileF(c.lat, c.lon);
      const tx = Math.round(t.x), ty = Math.round(t.y);
      if (tx < 1 || ty < 1 || tx >= WORLD_TX - 1 || ty >= WORLD_TY - 1) continue;
      dungeonSpots.push({ tx, ty, name: p.name || 'Forgotten Ruin', id: `dg_${p.id}` });
      if (dungeonSpots.length >= 3) break;
    }
    while (dungeonSpots.length < 2) {
      const t = randTile();
      dungeonSpots.push({ tx: t.x, ty: t.y, name: 'Corrupted Hollow', id: `dgp_${dungeonSpots.length}_${cellKey(this.pinned.lat, this.pinned.lon)}` });
    }
    dungeonSpots.forEach((d) => {
      this.addMarker(`${d.id}`, 'dungeon', d.tx, d.ty, avgLv + 1, d.name);
    });

    for (let i = 0; i < 5; i++) {
      const t = randTile();
      this.addMarker(`chest_${i}`, 'chest', t.x, t.y, 1, 'Supply Cache');
    }
    for (let i = 0; i < 3; i++) {
      const t = randTile();
      this.addMarker(`wood_${i}`, 'wood', t.x, t.y, 1, 'Timber Stand');
    }
    for (let i = 0; i < 3; i++) {
      const t = randTile();
      this.addMarker(`stone_${i}`, 'stone', t.x, t.y, 1, 'Stone Outcrop');
    }
    for (let i = 0; i < 4; i++) {
      const t = randTile();
      const lv = Math.max(1, avgLv - 1 + Math.floor(r() * 4) - 1);
      this.addMarker(`mon_${i}`, 'monster', t.x, t.y, lv, 'Blight Spawn');
    }
    {
      const t = randTile();
      this.addMarker('boss', 'boss', t.x, t.y, avgLv + 3, 'Blight Tyrant');
    }
    if (r() < 0.65) {
      const t = randTile();
      const lv = Math.max(1, avgLv - 1 + Math.floor(r() * 3));
      this.addMarker('wildhero', 'hero', t.x, t.y, lv, 'Stranded Knight');
    }
  }

  private polyCenter(g: { lat: number; lon: number }[]): { lat: number; lon: number } {
    let lat = 0, lon = 0;
    g.forEach((p) => { lat += p.lat; lon += p.lon; });
    return { lat: lat / g.length, lon: lon / g.length };
  }

  private consumedKey(key: string): string {
    return `${cellKey(this.pinned.lat, this.pinned.lon)}|${key}`;
  }

  private addMarker(key: string, kind: Marker['kind'], tx: number, ty: number, level: number, label: string): void {
    if (store.state.consumed[this.consumedKey(key)] === dayKey()) return;

    const px = tx * TILE + TILE / 2;
    const py = ty * TILE + TILE / 2;
    const c = this.add.container(px, py);

    const sprKey =
      kind === 'chest' ? 'spr_chest' :
      kind === 'wood' ? 'spr_node_wood' :
      kind === 'stone' ? 'spr_node_stone' :
      kind === 'dungeon' ? 'spr_dungeon' :
      kind === 'boss' ? 'spr_boss' :
      kind === 'hero' ? 'spr_hero_Knight' :
      MONSTER_SPRITES[hashStr(key) % MONSTER_SPRITES.length];

    const img = this.add.image(0, 0, sprKey);
    img.setOrigin(0.5, kind === 'hero' ? 0.85 : 0.8);
    c.add(img);

    if (kind === 'monster' || kind === 'boss' || kind === 'dungeon') {
      const lt = this.add.text(0, -30, `Lv${level}`, {
        fontSize: '9px', color: '#ffdd88', fontFamily: 'monospace', backgroundColor: '#000000aa', padding: { x: 2, y: 1 },
      }).setOrigin(0.5, 1);
      c.add(lt);
    }
    if (kind === 'hero') {
      const lt = this.add.text(0, -36, '!', {
        fontSize: '14px', color: '#ffee44', fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5, 1);
      c.add(lt);
      this.tweens.add({ targets: lt, y: lt.y - 5, yoyo: true, repeat: -1, duration: 500 });
    }

    const hit = this.add.rectangle(0, -10, 40, 44, 0, 0).setInteractive();
    hit.on('pointerdown', () => { if (!this.panMoved) this.tapMarker(m); });
    c.add(hit);

    this.markerLayer.add(c);
    const m: Marker = { key, kind, tx, ty, level, label, obj: c };
    this.markers.push(m);
  }

  private avgHeroLevel(): number {
    const hs = store.livingHeroes();
    if (hs.length === 0) return 1;
    return Math.max(1, Math.round(hs.reduce((a, h) => a + h.level, 0) / hs.length));
  }

  // ---------------- interactions ----------------

  private tapMarker(m: Marker): void {
    const pos = this.tileToLatLon(m.tx, m.ty);
    const dist = haversineM(geo.pos, pos);
    if (dist > INTERACT_RADIUS_M) {
      toast(this, `${m.label} is ${Math.round(dist)}m away — walk within ${INTERACT_RADIUS_M}m`, '#e8a860');
      return;
    }

    switch (m.kind) {
      case 'chest': {
        const r = mulberry32(hashStr(m.key + dayKey()));
        const gold = 30 + Math.floor(r() * 50);
        store.state.gold += gold;
        this.consume(m);
        toast(this, `Supply cache: +${gold} gold`, '#ffe080');
        break;
      }
      case 'wood': {
        store.state.wood += 25;
        this.consume(m);
        toast(this, 'Gathered 25 wood', '#a0e8a0');
        break;
      }
      case 'stone': {
        store.state.stone += 18;
        this.consume(m);
        toast(this, 'Quarried 18 stone', '#c0c0d0');
        break;
      }
      case 'hero': {
        this.recruitWildHero(m);
        break;
      }
      case 'monster':
      case 'boss':
      case 'dungeon': {
        this.launchBattle(m);
        break;
      }
    }
    this.refreshHud();
    store.save();
  }

  private consume(m: Marker): void {
    store.state.consumed[this.consumedKey(m.key)] = dayKey();
    m.obj.destroy();
    this.markers = this.markers.filter((x) => x !== m);
    store.save();
  }

  private recruitWildHero(m: Marker): void {
    const pos = this.tileToLatLon(m.tx, m.ty);
    const label = this.nearestRoadLabel(m.tx, m.ty);
    const classes = ['Knight', 'Archer', 'Rogue', 'Mage', 'Cleric'] as const;
    const cls = classes[hashStr(m.key + dayKey()) % classes.length];
    const h = createHero(cls, m.level, label, pos.lat, pos.lon);
    store.state.heroes.push(h);
    this.consume(m);
    toast(this, `${h.name} the ${h.cls} (Lv${h.level}) joins you!\nRecruited ${label}`, '#a0d8ff');
    this.refreshHud();
  }

  private nearestRoadLabel(tx: number, ty: number): string {
    let best: { name: string; d: number } | null = null;
    for (const f of this.features) {
      if (f.type !== 'road' || !f.name) continue;
      for (const p of f.geometry) {
        const t = this.latLonToTileF(p.lat, p.lon);
        const d = (t.x - tx) ** 2 + (t.y - ty) ** 2;
        if (!best || d < best.d) best = { name: f.name, d };
      }
    }
    return best ? `near ${best.name}` : 'in the wilds';
  }

  // Sample the real terrain around a marker -> battle grid patch.
  // This is the moat: the fight happens on the ground you're standing on.
  private terrainPatch(cx: number, cy: number): string[][] {
    const patch: string[][] = [];
    const x0 = Phaser.Math.Clamp(cx - Math.floor(BATTLE_COLS / 2), 0, WORLD_TX - BATTLE_COLS);
    const y0 = Phaser.Math.Clamp(cy - Math.floor(BATTLE_ROWS / 2), 0, WORLD_TY - BATTLE_ROWS);
    for (let y = 0; y < BATTLE_ROWS; y++) {
      patch[y] = [];
      for (let x = 0; x < BATTLE_COLS; x++) {
        patch[y][x] = this.terrain[y0 + y][x0 + x];
      }
    }
    return patch;
  }

  private launchBattle(m: Marker): void {
    if (store.livingHeroes().length === 0) {
      toast(this, 'You have no heroes! Recruit at the tavern in your Kingdom.', '#ff9090');
      return;
    }
    this.scene.start('BattleScene', {
      mode: m.kind,
      enemyLevel: m.level,
      floors: m.kind === 'dungeon' ? DUNGEON_FLOORS : 1,
      terrain: this.terrainPatch(m.tx, m.ty),
      rewardKey: this.consumedKey(m.key),
      label: m.label,
    });
  }

  // ---------------- player / GPS ----------------

  private makePlayer(): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const img = this.add.image(0, 0, 'spr_hero_Knight').setOrigin(0.5, 0.9).setScale(0.8);
    c.add(img);
    const nm = this.add.text(0, -52, 'YOU', {
      fontSize: '8px', color: '#ffffff', fontFamily: 'monospace', backgroundColor: '#2244aacc', padding: { x: 3, y: 1 },
    }).setOrigin(0.5, 1);
    c.add(nm);
    c.setDepth(500);
    return c;
  }

  private updatePlayer(): void {
    const t = this.latLonToTileF(geo.pos.lat, geo.pos.lon);
    this.playerObj.setPosition(t.x * TILE, t.y * TILE);
    const radiusPx = (INTERACT_RADIUS_M / METERS_PER_TILE) * TILE;
    this.ring.clear();
    this.ring.lineStyle(2, 0x66ccff, 0.4);
    this.ring.strokeCircle(t.x * TILE, t.y * TILE, radiusPx);
    this.ring.fillStyle(0x66ccff, 0.05);
    this.ring.fillCircle(t.x * TILE, t.y * TILE, radiusPx);
  }

  private onPositionChanged(): void {
    if (!this.scene.isActive()) return;
    this.updatePlayer();
    if (haversineM(geo.pos, this.pinned) > 80) {
      this.reloadWorld();
    }
  }

  // ---------------- panning ----------------

  private setupPanning(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.panning = true; this.panMoved = false;
      this.panSX = p.x; this.panSY = p.y;
      this.panOX = this.worldRoot.x; this.panOY = this.worldRoot.y;

      if (this.teleportTapMode && p.y > 60 && p.y < GAME_HEIGHT - 60) {
        const wx = p.x - this.worldRoot.x - this.mapLayer.x;
        const wy = p.y - this.worldRoot.y - this.mapLayer.y;
        const pos = this.tileToLatLon(wx / TILE, wy / TILE);
        this.teleportTapMode = false;
        this.adminTeleport(pos);
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.panning || !p.isDown) return;
      const dx = p.x - this.panSX, dy = p.y - this.panSY;
      if (Math.abs(dx) + Math.abs(dy) > 10) this.panMoved = true;
      this.worldRoot.x = Phaser.Math.Clamp(this.panOX + dx, -this.maxPanX, this.maxPanX);
      this.worldRoot.y = Phaser.Math.Clamp(this.panOY + dy, -this.maxPanY, this.maxPanY);
    });
    this.input.on('pointerup', () => {
      this.panning = false;
      this.time.delayedCall(50, () => { this.panMoved = false; });
    });
  }

  private recenter(): void {
    this.tweens.add({ targets: this.worldRoot, x: 0, y: 0, duration: 280, ease: 'Cubic.easeOut' });
  }

  // ---------------- admin ----------------

  private updateAdmBanner(): void {
    if (store.state.admin.enabled && geo.adminOverride) {
      if (!this.admBanner) {
        this.admBanner = this.add.text(GAME_WIDTH / 2, 62, '', {
          fontSize: '9px', color: '#ffcc66', fontFamily: 'monospace', backgroundColor: '#442200cc', padding: { x: 6, y: 2 },
        }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 2);
      }
      this.admBanner.setText(`ADMIN TELEPORT: ${geo.pos.lat.toFixed(4)}, ${geo.pos.lon.toFixed(4)}`);
      this.admBanner.setVisible(true);
    } else {
      this.admBanner?.setVisible(false);
    }
  }

  private adminTeleport(pos: GeoPos): void {
    store.state.admin = { enabled: true, pos: { ...pos } };
    geo.setAdmin(pos);
    store.save();
    this.updateAdmBanner();
    toast(this, `Teleported to ${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}`, '#ffcc66');
    this.reloadWorld();
  }

  private openAdmin(): void {
    const { root, close } = modal(this, 'ADMIN · WAYPOINT NETWORK');
    let y = 130;
    root.add(this.add.text(GAME_WIDTH / 2, y, 'Teleport anywhere on the GPS world.\nDev tool — a live build would be server-checked.', {
      fontSize: '10px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0));
    y += 44;

    TELEPORT_PRESETS.forEach((p, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const b = makeButton(this, GAME_WIDTH / 2 + (col === 0 ? -80 : 80), y + row * 42, 150, 32, p.name, () => {
        close();
        this.adminTeleport(p.pos);
      }, { color: 0x5a3a8a });
      root.add(b);
    });
    y += Math.ceil(TELEPORT_PRESETS.length / 2) * 42 + 12;

    root.add(makeButton(this, GAME_WIDTH / 2, y, 310, 32, '⌖ Tap the map to teleport there', () => {
      close();
      this.teleportTapMode = true;
      toast(this, 'Teleport armed — tap anywhere on the map', '#ffcc66');
    }, { color: 0x8a5a20 }));
    y += 42;

    root.add(makeButton(this, GAME_WIDTH / 2, y, 310, 32, 'Nudge +200m north (walk sim)', () => {
      close();
      const p = geo.pos;
      this.adminTeleport({ lat: p.lat + 0.0018, lon: p.lon });
    }, { color: 0x8a5a20 }));
    y += 42;

    root.add(makeButton(this, GAME_WIDTH / 2, y, 310, 32, 'Return to real GPS', () => {
      close();
      store.state.admin = { enabled: false, pos: null };
      geo.setAdmin(null);
      store.save();
      this.updateAdmBanner();
      toast(this, 'Admin override off — using device GPS', '#a0e8a0');
      this.reloadWorld();
    }, { color: 0x2a6a3a }));
  }
}
