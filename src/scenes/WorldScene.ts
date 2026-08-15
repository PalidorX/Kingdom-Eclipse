import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT, TILE, WORLD_TX, WORLD_TY, METERS_PER_TILE,
  INTERACT_RADIUS_M, BATTLE_COLS, BATTLE_ROWS, DENSITY_MIN,
  DUNGEON_TIERS, DungeonTier,
} from '../config/constants';
import { geo, GeoPos, haversineM, TELEPORT_PRESETS } from '../core/geo';
import { getMapData, OSMFeature } from '../core/osm';
import { store } from '../core/save';
import { createHero, canRecruit } from '../game/heroes';
import { JOBS, JobKey, ALL_JOBS, BASE_JOBS } from '../game/jobs';
import { bakeAllSprites, MONSTER_SPRITES } from '../game/sprites';
import { hud, bottomNav, toast, modal, makeButton, UI_DEPTH } from '../game/ui';
import { mulberry32, hashStr, dayKey, cellKey } from '../core/rng';
import { TOWN_FRAMES, computeTownRegions, townFrame } from '../game/towntiles';

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
  kind: 'chest' | 'rarechest' | 'wood' | 'stone' | 'monster' | 'boss' | 'dungeon' | 'hero';
  tx: number; ty: number;
  level: number;
  label: string;
  tier?: DungeonTier;
  job?: JobKey;
  obj: Phaser.GameObjects.Container;
}

export class WorldScene extends Phaser.Scene {
  private terrain: Terrain[][] = [];
  private townRegions: number[][] = [];
  private features: OSMFeature[] = [];
  private pinned: GeoPos = { lat: 0, lon: 0 };
  private worldRoot!: Phaser.GameObjects.Container;
  private mapLayer!: Phaser.GameObjects.Container;
  private markerLayer!: Phaser.GameObjects.Container;
  private playerObj!: Phaser.GameObjects.Container;
  private ring!: Phaser.GameObjects.Graphics;
  private markers: Marker[] = [];
  private refreshHud: () => void = () => {};
  private maxPanX = 0; private maxPanY = 0;
  private panning = false; private panMoved = false;
  private panSX = 0; private panSY = 0; private panOX = 0; private panOY = 0;
  private teleportTapMode = false;
  private admBanner: Phaser.GameObjects.Text | null = null;
  private hintText: Phaser.GameObjects.Text | null = null;

  constructor() { super({ key: 'WorldScene' }); }

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

    this.ring = this.add.graphics();
    this.markerLayer.add(this.ring);
    this.playerObj = this.makePlayer();
    this.markerLayer.add(this.playerObj);

    const mapData = this.registry.get('mapData') as { features: OSMFeature[]; pinned: GeoPos } | null;
    this.registry.remove('mapData');
    this.buildWorld(mapData ?? null);

    this.setupPanning();
    makeButton(this, 44, GAME_HEIGHT - 84, 64, 30, '⌖ center', () => {
      this.tweens.add({ targets: this.worldRoot, x: 0, y: 0, duration: 280, ease: 'Cubic.easeOut' });
    }, { color: 0x1c2c4c }).setDepth(UI_DEPTH);

    // battle outcome → onboarding advances (BEFORE nav renders, so lock state is fresh)
    const outcome = this.registry.get('battleOutcome') as { victory: boolean; intro?: string } | undefined;
    let showUnlockModal = false;
    if (outcome) {
      this.registry.remove('battleOutcome');
      if (outcome.victory && outcome.intro === 'firstBattle' && store.state.onboard === 'firstBattle') {
        store.state.onboard = 'townhall';
        store.save();
        showUnlockModal = true;
      }
      if (outcome.victory && outcome.intro === 'introDungeon' && store.state.onboard === 'introDungeon') {
        store.state.onboard = 'done';
        store.save();
        toast(this, 'The waypoint hums. The surface is yours to reclaim — dungeon by dungeon.', '#a0d8ff');
      }
    }

    const h = hud(this, 'THE SURFACE');
    this.refreshHud = h.refresh;
    bottomNav(this, 'world');

    makeButton(this, GAME_WIDTH - 40, GAME_HEIGHT - 84, 56, 30, 'ADMIN', () => this.openAdmin(), {
      color: store.state.admin.enabled ? 0x8a5a20 : 0x1c2c4c,
    }).setDepth(UI_DEPTH);
    this.updateAdmBanner();

    if (showUnlockModal) {
      const { root, close } = modal(this, 'THE KINGDOM AWAKENS');
      root.add(this.add.text(GAME_WIDTH / 2, 160,
        'Your victory stirred an old waypoint above the clouds.\n\nA floating island answers — barren, waiting.\n\nThe KINGDOM tab is now open.\nGo there and place your Town Hall.', {
          fontSize: '11px', color: '#cfe0f8', fontFamily: 'monospace', align: 'center', lineSpacing: 4,
          wordWrap: { width: GAME_WIDTH - 80 },
        }).setOrigin(0.5, 0));
      root.add(makeButton(this, GAME_WIDTH / 2, 430, 190, 40, 'TO THE KINGDOM →', () => {
        close();
        this.scene.start('KingdomScene');
      }, { color: 0x3a6acc }));
    }

    const offline = this.registry.get('offlineReport') as { wood: number; stone: number; gold: number } | undefined;
    if (offline) {
      this.registry.remove('offlineReport');
      if (offline.wood + offline.stone + offline.gold > 0) {
        toast(this, `While you were away: 🪵${offline.wood} 🪨${offline.stone} ⛃${offline.gold}`, '#a0e8a0');
      }
    }

    geo.onChange(() => this.onPositionChanged());
    this.time.addEvent({ delay: 2500, loop: true, callback: () => this.onPositionChanged() });
    this.runOnboardingBeat();
  }

  // ---------------- onboarding (doc s.2: session one from the couch) ----------------

  private setHint(msg: string | null): void {
    this.hintText?.destroy();
    this.hintText = null;
    if (msg) {
      this.hintText = this.add.text(GAME_WIDTH / 2, 62, msg, {
        fontSize: '10px', color: '#ffee99', fontFamily: 'monospace', align: 'center',
        backgroundColor: '#332200dd', padding: { x: 8, y: 4 }, wordWrap: { width: GAME_WIDTH - 60 },
      }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 2);
    }
  }

  private runOnboardingBeat(): void {
    const ob = store.state.onboard;
    if (ob === 'chest') {
      this.setHint('This is YOUR street, redrawn.\nThere is a supply cache at your feet — tap it.');
    } else if (ob === 'freeHero') {
      this.grantFreeHero();
    } else if (ob === 'firstBattle') {
      this.setHint('A blight spawn stalks nearby. Tap it to fight.');
    } else if (ob === 'townhall') {
      this.setHint('Your kingdom waits above — open the KINGDOM tab and place the Town Hall.');
    } else if (ob === 'introDungeon') {
      this.setHint('A corrupted cellar has opened beside your home. Clear it.');
    } else {
      this.setHint(null);
    }
  }

  private grantFreeHero(): void {
    const h = createHero('Knight', 1, 'outside your front door');
    store.state.heroes.push(h);
    store.state.onboard = 'firstBattle';
    store.save();
    const { root, close } = modal(this, 'A SURVIVOR');
    root.add(this.add.image(GAME_WIDTH / 2, 210, 'spr_job_Knight').setScale(1.4));
    root.add(this.add.text(GAME_WIDTH / 2, 260,
      `${h.name} crawls out of a ruined shelter.\n\n"A living soul! I thought the blight took everyone.\nMy sword is yours."\n\n${h.name} the Knight joined you.`, {
        fontSize: '11px', color: '#cfe0f8', fontFamily: 'monospace', align: 'center', lineSpacing: 4,
        wordWrap: { width: GAME_WIDTH - 80 },
      }).setOrigin(0.5, 0));
    root.add(makeButton(this, GAME_WIDTH / 2, 430, 170, 40, 'WELCOME', () => {
      close();
      this.runOnboardingBeat();
      this.respawnMarkers();
    }, { color: 0x2a7a3a }));
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
    }
    this.townRegions = computeTownRegions(this.terrain);
    this.renderTerrain();
    this.respawnMarkers();
    this.updatePlayer();
  }

  private async reloadWorld(): Promise<void> {
    const data = await getMapData(geo.pos);
    this.buildWorld(data);
  }

  private genProceduralTerrain(): void {
    this.terrain = [];
    const r = mulberry32(hashStr(cellKey(this.pinned.lat, this.pinned.lon)));
    const blobs: { t: Terrain; cx: number; cy: number; rad: number }[] = [];
    const kinds: Terrain[] = ['water', 'forest', 'forest', 'mountain', 'town', 'sand'];
    for (let i = 0; i < 8; i++) {
      blobs.push({ t: kinds[Math.floor(r() * kinds.length)], cx: r() * WORLD_TX, cy: r() * WORLD_TY, rad: 2 + r() * 4 });
    }
    for (let y = 0; y < WORLD_TY; y++) {
      this.terrain[y] = [];
      for (let x = 0; x < WORLD_TX; x++) {
        let t: Terrain = 'grass';
        for (const b of blobs) if ((x - b.cx) ** 2 + (y - b.cy) ** 2 < b.rad ** 2) t = b.t;
        this.terrain[y][x] = t;
      }
    }
    const ry = Math.floor(WORLD_TY / 2) + Math.floor(r() * 4) - 2;
    for (let x = 0; x < WORLD_TX; x++) for (let dy = 0; dy < 2; dy++) this.terrain[ry + dy][x] = 'path';
  }

  private genTerrainFromOSM(): void {
    this.terrain = [];
    for (let y = 0; y < WORLD_TY; y++) {
      this.terrain[y] = [];
      for (let x = 0; x < WORLD_TX; x++) this.terrain[y][x] = 'grass';
    }
    const map: Record<string, Terrain> = {
      building: 'town', road: 'path', water: 'water', forest: 'forest', park: 'park', parking: 'sand',
    };
    for (const f of this.features) {
      const terr = map[f.type];
      if (!terr) continue;
      const pts = f.geometry.map((p) => this.latLonToTileF(p.lat, p.lon));
      if (f.type === 'road') {
        for (let i = 0; i < pts.length - 1; i++) this.stampLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, terr);
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
    Object.entries(TOWN_FRAMES).forEach(([k, [c, r]]) => cell(k, c, r));
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
      return townFrame(this.terrain, this.townRegions, x, y);
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
  private lonPerTile(): number { return METERS_PER_TILE / (111000 * Math.cos((this.pinned.lat * Math.PI) / 180)); }
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
  private playerTile(): { x: number; y: number } {
    return this.latLonToTileF(geo.pos.lat, geo.pos.lon);
  }

  // ---------------- spawns: feature-anchored + density floor (doc 8.1) ----------------

  private walkableTile(x: number, y: number): boolean {
    const t = this.terrain[y]?.[x];
    return t !== undefined && t !== 'water' && t !== 'town' && t !== 'mountain';
  }

  private respawnMarkers(): void {
    this.markers.forEach((m) => m.obj.destroy());
    this.markers = [];
    const day = dayKey();
    const areaKey = cellKey(this.pinned.lat, this.pinned.lon);
    const r = mulberry32(hashStr(`${day}|${areaKey}`));
    const avgLv = store.avgCharLevel();
    const ob = store.state.onboard;

    const randTile = (rr: () => number): { x: number; y: number } => {
      for (let i = 0; i < 60; i++) {
        const x = 2 + Math.floor(rr() * (WORLD_TX - 4));
        const y = 2 + Math.floor(rr() * (WORLD_TY - 4));
        if (this.walkableTile(x, y)) return { x, y };
      }
      return { x: Math.floor(WORLD_TX / 2) + 2, y: Math.floor(WORLD_TY / 2) + 2 };
    };

    // ---- onboarding-specific spawns ----
    const pt = this.playerTile();
    const ptx = Math.round(pt.x), pty = Math.round(pt.y);
    if (ob === 'chest') {
      this.addMarker('intro_chest', 'chest', ptx, pty + 1, 1, 'Supply Cache');
    }
    if (ob === 'firstBattle') {
      this.addMarker('intro_mon', 'monster', ptx + 2, pty + 1, 1, 'Blight Spawn');
    }
    if (ob === 'introDungeon') {
      this.addMarker('intro_dg', 'dungeon', ptx - 2, pty - 1, 1, 'Corrupted Cellar', 'short');
    }
    if (ob === 'chest' || ob === 'freeHero' || ob === 'firstBattle') {
      return; // keep the world clean until the player has a footing
    }

    // ---- dungeons: real POIs, tier from footprint [LOCKED] ----
    const pois = this.features.filter((f) => f.poi);
    let placed = 0;
    for (const p of pois) {
      if (placed >= 3) break;
      const c = this.polyCenter(p.geometry);
      const t = this.latLonToTileF(c.lat, c.lon);
      const tx = Math.round(t.x), ty = Math.round(t.y);
      if (tx < 1 || ty < 1 || tx >= WORLD_TX - 1 || ty >= WORLD_TY - 1) continue;
      const area = this.polyAreaTiles(p.geometry);
      const tier: DungeonTier = area >= 22 ? 'epic' : area >= 7 ? 'medium' : 'short';
      this.addMarker(`dg_${p.id}`, 'dungeon', tx, ty, avgLv + 1, p.name || 'Forgotten Ruin', tier);
      placed++;
    }
    while (placed < 2) {
      const t = randTile(r);
      this.addMarker(`dgp_${placed}_${areaKey}`, 'dungeon', t.x, t.y, avgLv + 1, 'Corrupted Hollow', placed === 0 ? 'short' : 'medium');
      placed++;
    }

    // ---- feature-anchored world objects ----
    for (let i = 0; i < 4; i++) {
      const t = randTile(r);
      const rare = r() < 0.15;
      this.addMarker(`chest_${i}`, rare ? 'rarechest' : 'chest', t.x, t.y, 1, rare ? 'Gleaming Cache' : 'Supply Cache');
    }
    for (let i = 0; i < 2; i++) {
      const t = randTile(r);
      // terrain sets resource type [LOCKED]
      const kind = this.terrain[t.y][t.x] === 'forest' || this.terrain[t.y][t.x] === 'park' ? 'wood' : r() < 0.5 ? 'wood' : 'stone';
      this.addMarker(`node_${i}`, kind, t.x, t.y, 1, kind === 'wood' ? 'Timber Stand' : 'Stone Outcrop');
    }
    for (let i = 0; i < 3; i++) {
      const t = randTile(r);
      this.addMarker(`mon_${i}`, 'monster', t.x, t.y, Math.max(1, avgLv - 1 + Math.floor(r() * 3)), 'Blight Spawn');
    }
    { // daily minor named boss (doc 11 — solo prototype)
      const t = randTile(r);
      this.addMarker('boss', 'boss', t.x, t.y, avgLv + 2, ['Gravemaw', 'Ashwing', 'The Hollow King'][hashStr(day) % 3]);
    }
    if (r() < 0.6) {
      const t = randTile(r);
      const job = (r() < 0.6 ? BASE_JOBS : ALL_JOBS)[Math.floor(r() * (r() < 0.6 ? BASE_JOBS.length : ALL_JOBS.length))] ?? 'Knight';
      this.addMarker('wildhero', 'hero', t.x, t.y, Math.max(1, avgLv), 'Stranded Traveller', undefined, job);
    }

    // ---- DENSITY FLOOR: top up to a guaranteed minimum inside the ring ----
    const ringTiles = INTERACT_RADIUS_M / METERS_PER_TILE;
    const inRing = () => this.markers.filter((m) => Math.hypot(m.tx - pt.x, m.ty - pt.y) <= ringTiles).length;
    let syn = 0;
    const rSyn = mulberry32(hashStr(`${day}|${areaKey}|syn`));
    while (inRing() < DENSITY_MIN && syn < 8) {
      const ang = rSyn() * Math.PI * 2;
      const rad = 3 + rSyn() * (ringTiles - 4);
      const x = Math.round(pt.x + Math.cos(ang) * rad);
      const y = Math.round(pt.y + Math.sin(ang) * rad);
      if (x > 1 && y > 1 && x < WORLD_TX - 2 && y < WORLD_TY - 2 && this.walkableTile(x, y)) {
        const kind = rSyn() < 0.5 ? 'chest' : rSyn() < 0.5 ? 'wood' : 'stone';
        this.addMarker(`syn_${syn}`, kind as Marker['kind'], x, y, 1, kind === 'chest' ? 'Supply Cache' : 'Cache');
      }
      syn++;
    }
  }

  private polyCenter(g: { lat: number; lon: number }[]): { lat: number; lon: number } {
    let lat = 0, lon = 0;
    g.forEach((p) => { lat += p.lat; lon += p.lon; });
    return { lat: lat / g.length, lon: lon / g.length };
  }

  private polyAreaTiles(g: { lat: number; lon: number }[]): number {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of g) {
      const t = this.latLonToTileF(p.lat, p.lon);
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    return (maxX - minX) * (maxY - minY);
  }

  private consumedKey(key: string): string {
    return `${cellKey(this.pinned.lat, this.pinned.lon)}|${key}`;
  }

  private addMarker(key: string, kind: Marker['kind'], tx: number, ty: number, level: number, label: string, tier?: DungeonTier, job?: JobKey): void {
    if (store.state.consumed[this.consumedKey(key)] === dayKey()) return;
    const px = tx * TILE + TILE / 2;
    const py = ty * TILE + TILE / 2;
    const c = this.add.container(px, py);
    const sprKey =
      kind === 'chest' ? 'spr_chest' :
      kind === 'rarechest' ? 'spr_chest_rare' :
      kind === 'wood' ? 'spr_node_wood' :
      kind === 'stone' ? 'spr_node_stone' :
      kind === 'dungeon' ? 'spr_dungeon' :
      kind === 'boss' ? 'spr_boss' :
      kind === 'hero' ? `spr_job_${job ?? 'Knight'}` :
      MONSTER_SPRITES[hashStr(key) % MONSTER_SPRITES.length];
    const img = this.add.image(0, 0, sprKey).setOrigin(0.5, kind === 'hero' ? 0.85 : 0.8);
    c.add(img);
    if (kind === 'monster' || kind === 'boss' || kind === 'dungeon') {
      const tierTxt = tier ? ` ${DUNGEON_TIERS[tier].label}` : '';
      c.add(this.add.text(0, -30, `Lv${level}${tierTxt}`, {
        fontSize: '9px', color: '#ffdd88', fontFamily: 'monospace', backgroundColor: '#000000aa', padding: { x: 2, y: 1 },
      }).setOrigin(0.5, 1));
    }
    if (kind === 'hero' || kind === 'rarechest') {
      const lt = this.add.text(0, -36, '!', { fontSize: '14px', color: '#ffee44', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5, 1);
      c.add(lt);
      this.tweens.add({ targets: lt, y: lt.y - 5, yoyo: true, repeat: -1, duration: 500 });
    }
    const hit = this.add.rectangle(0, -10, 40, 44, 0, 0).setInteractive();
    const m: Marker = { key, kind, tx, ty, level, label, tier, job, obj: c };
    hit.on('pointerdown', () => { if (!this.panMoved) this.tapMarker(m); });
    c.add(hit);
    this.markerLayer.add(c);
    this.markers.push(m);
  }

  // ---------------- interactions ----------------

  private tapMarker(m: Marker): void {
    const pos = this.tileToLatLon(m.tx, m.ty);
    const dist = haversineM(geo.pos, pos);
    // HARD RULE 5
    if (dist > INTERACT_RADIUS_M) {
      toast(this, `${m.label}: ${Math.round(dist)}m away — walk within ${INTERACT_RADIUS_M}m`, '#e8a860');
      return;
    }
    switch (m.kind) {
      case 'chest':
      case 'rarechest': {
        const r = mulberry32(hashStr(m.key + dayKey()));
        const mult = m.kind === 'rarechest' ? 3 : 1;
        const gold = (25 + Math.floor(r() * 40)) * mult;
        const wood = Math.floor(r() * 12) * mult;
        store.state.gold += gold;
        store.state.wood += wood;
        this.consume(m);
        toast(this, `${m.label}: +${gold} gold${wood ? ` +${wood} wood` : ''}`, '#ffe080');
        if (store.state.onboard === 'chest' && m.key === 'intro_chest') {
          store.state.onboard = 'freeHero';
          store.save();
          this.time.delayedCall(500, () => this.runOnboardingBeat());
        }
        break;
      }
      case 'wood':
        store.state.wood += 22;
        this.consume(m);
        toast(this, 'Gathered 22 wood', '#a0e8a0');
        break;
      case 'stone':
        store.state.stone += 16;
        this.consume(m);
        toast(this, 'Quarried 16 stone', '#c0c0d0');
        break;
      case 'hero':
        this.wildHeroEncounter(m);
        break;
      case 'monster':
      case 'boss':
      case 'dungeon':
        this.launchBattle(m);
        break;
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

  // Wild heroes are building-gated exactly like the tavern (doc 13) [LOCKED]
  private wildHeroEncounter(m: Marker): void {
    const job = m.job ?? 'Knight';
    const def = JOBS[job];
    const gate = canRecruit({ name: '', job, charLevel: m.level, luck: 0, taken: false });
    const { root, close } = modal(this, 'A STRANDED TRAVELLER');
    root.add(this.add.image(GAME_WIDTH / 2, 200, `spr_job_${job}`).setScale(1.3));
    const label = this.nearestRoadLabel(m.tx, m.ty);
    root.add(this.add.text(GAME_WIDTH / 2, 250,
      `A ${job} — Lv ${m.level}\nfound ${label}`, {
        fontSize: '11px', color: '#cfe0f8', fontFamily: 'monospace', align: 'center', lineSpacing: 3,
      }).setOrigin(0.5, 0));
    if (gate.ok) {
      root.add(makeButton(this, GAME_WIDTH / 2, 380, 190, 40, 'RECRUIT', () => {
        const h = createHero(job, m.level, label);
        store.state.heroes.push(h);
        this.consume(m);
        close();
        toast(this, `${h.name} the ${job} joins you!`, '#a0d8ff');
        this.refreshHud();
      }, { color: 0x2a7a3a }));
    } else {
      // Seeing what you can't have is the mechanic. Name the building.
      root.add(this.add.text(GAME_WIDTH / 2, 330,
        `"I only follow those who honour my order."\n\n🔒 ${gate.why}`, {
          fontSize: '10px', color: '#e8a860', fontFamily: 'monospace', align: 'center', lineSpacing: 3,
        }).setOrigin(0.5, 0));
      root.add(makeButton(this, GAME_WIDTH / 2, 420, 190, 36, 'LEAVE THEM (for now)', close, { color: 0x334455 }));
    }
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

  // Terrain drives the grid — never cosmetic (HARD RULE 7)
  private terrainPatch(cx: number, cy: number): string[][] {
    const patch: string[][] = [];
    const x0 = Phaser.Math.Clamp(cx - Math.floor(BATTLE_COLS / 2), 0, WORLD_TX - BATTLE_COLS);
    const y0 = Phaser.Math.Clamp(cy - Math.floor(BATTLE_ROWS / 2), 0, WORLD_TY - BATTLE_ROWS);
    for (let y = 0; y < BATTLE_ROWS; y++) {
      patch[y] = [];
      for (let x = 0; x < BATTLE_COLS; x++) patch[y][x] = this.terrain[y0 + y][x0 + x];
    }
    return patch;
  }

  private launchBattle(m: Marker): void {
    if (store.activeHeroes().length === 0) {
      toast(this, 'You have no active heroes!', '#ff9090');
      return;
    }
    const floors = m.kind === 'dungeon' ? DUNGEON_TIERS[m.tier ?? 'short'].floors : 1;
    const intro =
      m.key === 'intro_mon' ? 'firstBattle' :
      m.key === 'intro_dg' ? 'introDungeon' : undefined;
    this.scene.start('BattleScene', {
      mode: m.kind,
      enemyLevel: m.level,
      floors,
      tier: m.tier,
      terrain: this.terrainPatch(m.tx, m.ty),
      rewardKey: this.consumedKey(m.key),
      label: m.label,
      intro,
    });
  }

  // ---------------- player / GPS ----------------

  private makePlayer(): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    c.add(this.add.image(0, 0, 'spr_job_Knight').setOrigin(0.5, 0.9).setScale(0.8));
    c.add(this.add.text(0, -52, 'YOU', {
      fontSize: '8px', color: '#ffffff', fontFamily: 'monospace', backgroundColor: '#2244aacc', padding: { x: 3, y: 1 },
    }).setOrigin(0.5, 1));
    c.setDepth(500);
    return c;
  }

  private updatePlayer(): void {
    const t = this.playerTile();
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
    // spawns regenerate as the player walks (new area = new seed cell)
    if (haversineM(geo.pos, this.pinned) > 80) this.reloadWorld();
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

  // ---------------- admin ----------------

  private updateAdmBanner(): void {
    if (store.state.admin.enabled && geo.adminOverride) {
      if (!this.admBanner) {
        this.admBanner = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 110, '', {
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
    let y = 124;
    root.add(this.add.text(GAME_WIDTH / 2, y, 'Dev teleport. A live build is server-checked (doc s.18).', {
      fontSize: '9px', color: '#aabbcc', fontFamily: 'monospace', align: 'center',
    }).setOrigin(0.5, 0));
    y += 30;
    TELEPORT_PRESETS.forEach((p, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      root.add(makeButton(this, GAME_WIDTH / 2 + (col === 0 ? -80 : 80), y + row * 40, 150, 30, p.name, () => {
        close(); this.adminTeleport(p.pos);
      }, { color: 0x5a3a8a }));
    });
    y += Math.ceil(TELEPORT_PRESETS.length / 2) * 40 + 8;
    root.add(makeButton(this, GAME_WIDTH / 2, y, 300, 30, '⌖ Tap the map to teleport there', () => {
      close(); this.teleportTapMode = true;
      toast(this, 'Teleport armed — tap anywhere on the map', '#ffcc66');
    }, { color: 0x8a5a20 }));
    y += 38;
    root.add(makeButton(this, GAME_WIDTH / 2, y, 300, 30, 'Nudge +200m north (walk sim)', () => {
      close(); const p = geo.pos;
      this.adminTeleport({ lat: p.lat + 0.0018, lon: p.lon });
    }, { color: 0x8a5a20 }));
    y += 38;
    root.add(makeButton(this, GAME_WIDTH / 2, y, 300, 30, 'Return to real GPS', () => {
      close();
      store.state.admin = { enabled: false, pos: null };
      geo.setAdmin(null);
      store.save();
      this.updateAdmBanner();
      this.reloadWorld();
    }, { color: 0x2a6a3a }));
    y += 38;
    root.add(makeButton(this, GAME_WIDTH / 2, y, 300, 30, '⚠ RESET SAVE (wipe everything)', () => {
      close();
      store.reset();
      this.scene.start('BootScene');
    }, { color: 0x663333 }));
  }
}
