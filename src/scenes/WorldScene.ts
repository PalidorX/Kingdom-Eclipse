import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';

interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface OSMFeature {
  type: 'building' | 'road' | 'water' | 'forest' | 'park' | 'parking';
  geometry: { lat: number; lon: number }[];
}

// SNES-style color palette (limited colors like classic JRPGs)
const PALETTE = {
  // Water colors
  waterDeep: 0x2038a0,
  waterShallow: 0x3060c0,
  waterShore: 0x4080d0,

  // Grass/Land colors
  grassDark: 0x206020,
  grass: 0x40a040,
  grassLight: 0x60c060,

  // Forest colors
  treeDark: 0x184018,
  tree: 0x306030,
  treeLight: 0x408040,

  // Path/Road colors
  pathDark: 0x606060,
  path: 0x909090,
  pathLight: 0xb0b0b0,

  // Mountain/Rock colors
  rockDark: 0x505050,
  rock: 0x808080,
  rockLight: 0xa0a0a0,
  rockSnow: 0xe0e0f0,

  // Town/Building colors
  roofRed: 0xc04040,
  roofBlue: 0x4040c0,
  roofBrown: 0x806040,
  wallLight: 0xe0d0c0,
  wallDark: 0xa09080,

  // Sand/Desert colors
  sand: 0xe0c080,
  sandDark: 0xc0a060,
};

// Tile size for the RPG map (32x32 tileset)
const MAP_TILE_SIZE = 32;
const TILES_X = Math.ceil(GAME_WIDTH / MAP_TILE_SIZE);
const TILES_Y = Math.ceil(GAME_HEIGHT / MAP_TILE_SIZE);

// How many meters each tile represents (smaller = more zoomed in)
const METERS_PER_TILE = 5;

type TerrainType = 'water' | 'grass' | 'forest' | 'path' | 'mountain' | 'town' | 'sand' | 'park';

// Solid fill tile (col,row) in the 8x23 world tileset for each terrain type.
// Frames are registered on the 'world-tileset' texture in defineTilesetFrames().
const TERRAIN_FRAME: Record<TerrainType, string> = {
  grass: 't_grass',
  park: 't_grass',
  water: 't_water',
  forest: 't_forest',
  path: 't_road',
  mountain: 't_mountain',
  sand: 't_sand',
  town: 't_grass',
};

export class WorldScene extends Phaser.Scene {
  private playerMarker!: Phaser.GameObjects.Container;
  private currentPosition: GeoPosition = {
    latitude: 37.7749,
    longitude: -122.4194,
    accuracy: 0,
  };
  private watchId: number | null = null;
  private isDebugMode: boolean = false;
  private debugContainer!: Phaser.GameObjects.Container;
  private positionText!: Phaser.GameObjects.Text;
  private resourceMarkers: Phaser.GameObjects.Container[] = [];
  private dungeonMarkers: Phaser.GameObjects.Container[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private terrainRT: Phaser.GameObjects.RenderTexture | null = null;
  private townSprites: Phaser.GameObjects.Image[] = [];
  private useTileset = false;
  private terrainGrid: TerrainType[][] = [];
  private animationTime: number = 0;
  private mapContainer!: Phaser.GameObjects.Container;
  private isRealMapView: boolean = true; // Start with real map view
  private realMapElement: HTMLIFrameElement | null = null;
  private mapToggleBtn!: Phaser.GameObjects.Text;
  private mapToggleBg!: Phaser.GameObjects.Graphics;
  private resizeHandler: (() => void) | null = null;
  private osmFeatures: OSMFeature[] = [];
  private isLoadingOSM: boolean = false;
  private lastFetchPosition: { lat: number; lon: number } | null = null;
  private lastMapPosition: { lat: number; lon: number } | null = null;
  private loadingText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'WorldScene' });
  }

  preload(): void {
    // Load the world-map tileset (served from public/assets via Vite base)
    this.load.image('world-tileset', `${import.meta.env.BASE_URL}assets/world-tileset.png`);
  }

  create(): void {
    // Get pre-loaded data from BootScene
    const initialPosition = this.registry.get('initialPosition');
    const initialOSMData = this.registry.get('initialOSMData');

    // Use pre-loaded position if available
    if (initialPosition) {
      this.currentPosition = initialPosition;
      this.lastFetchPosition = {
        lat: initialPosition.latitude,
        lon: initialPosition.longitude,
      };
    }

    // Create map container for all map elements
    this.mapContainer = this.add.container(0, 0);

    // Initialize terrain grid
    this.initializeTerrainGrid();
    this.createWorldMap();
    this.createLoadingIndicator();

    // Use pre-loaded OSM data if available
    if (initialOSMData) {
      this.parseOSMData(initialOSMData);
      this.generateTerrainFromOSM();
      this.drawMap();
    }

    this.createPlayerMarker();
    this.createResourceMarkers();
    this.createUI();
    this.createMapToggle();
    this.createRealMapOverlay();
    this.createDebugUI();
    this.initGeolocation();

    // Start UIScene in parallel
    this.scene.launch('UIScene');
  }

  update(_time: number, delta: number): void {
    this.animationTime += delta;

    // Animate water tiles every 500ms
    if (Math.floor(this.animationTime / 500) !== Math.floor((this.animationTime - delta) / 500)) {
      this.animateWater();
    }
  }

  private createLoadingIndicator(): void {
    this.loadingText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 50, 'Loading map...', {
      fontSize: '12px',
      color: '#ffff80',
      fontFamily: 'monospace',
    });
    this.loadingText.setOrigin(0.5);
    this.loadingText.setDepth(150);
    this.loadingText.setVisible(false);
  }

  private initializeTerrainGrid(): void {
    this.terrainGrid = [];
    for (let y = 0; y < TILES_Y; y++) {
      this.terrainGrid[y] = [];
      for (let x = 0; x < TILES_X; x++) {
        this.terrainGrid[y][x] = 'grass';
      }
    }
  }

  private async fetchOSMData(): Promise<void> {
    if (this.isLoadingOSM) return;

    // Check if we've moved enough to warrant a new fetch
    if (this.lastFetchPosition) {
      const dist = this.haversineDistance(
        this.lastFetchPosition.lat,
        this.lastFetchPosition.lon,
        this.currentPosition.latitude,
        this.currentPosition.longitude
      );
      if (dist < 50) return; // Don't refetch if moved less than 50m
    }

    this.isLoadingOSM = true;
    this.loadingText.setVisible(true);

    try {
      // Calculate bounding box (roughly 200m x 200m area)
      const latDelta = (TILES_Y * METERS_PER_TILE) / 111000; // 111km per degree latitude
      const lonDelta = (TILES_X * METERS_PER_TILE) / (111000 * Math.cos(this.currentPosition.latitude * Math.PI / 180));

      const south = this.currentPosition.latitude - latDelta / 2;
      const north = this.currentPosition.latitude + latDelta / 2;
      const west = this.currentPosition.longitude - lonDelta / 2;
      const east = this.currentPosition.longitude + lonDelta / 2;

      // Overpass API query for buildings, roads, water, parks, forests
      const query = `
        [out:json][timeout:10];
        (
          way["building"](${south},${west},${north},${east});
          way["highway"](${south},${west},${north},${east});
          way["natural"="water"](${south},${west},${north},${east});
          way["waterway"](${south},${west},${north},${east});
          way["landuse"="forest"](${south},${west},${north},${east});
          way["natural"="wood"](${south},${west},${north},${east});
          way["leisure"="park"](${south},${west},${north},${east});
          way["landuse"="grass"](${south},${west},${north},${east});
          way["amenity"="parking"](${south},${west},${north},${east});
          relation["natural"="water"](${south},${west},${north},${east});
        );
        out geom;
      `;

      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
      });

      if (!response.ok) {
        throw new Error('Overpass API request failed');
      }

      const data = await response.json();
      console.log('OSM API response:', data.elements?.length || 0, 'elements');
      this.parseOSMData(data);
      console.log('Parsed features:', this.osmFeatures.length);
      this.lastFetchPosition = {
        lat: this.currentPosition.latitude,
        lon: this.currentPosition.longitude,
      };

      // Regenerate terrain from OSM data
      this.generateTerrainFromOSM();
      this.drawMap();
    } catch (error) {
      console.error('Failed to fetch OSM data:', error);
      // Fall back to procedural generation
      this.generateProceduralTerrain();
      this.drawMap();
    } finally {
      this.isLoadingOSM = false;
      this.loadingText.setVisible(false);
    }
  }

  private parseOSMData(data: { elements: Array<{ type: string; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> }> }): void {
    this.osmFeatures = [];

    for (const element of data.elements) {
      if (!element.geometry) continue;

      const tags = element.tags || {};
      let featureType: OSMFeature['type'] | null = null;

      if (tags.building) {
        featureType = 'building';
      } else if (tags.highway) {
        featureType = 'road';
      } else if (tags.natural === 'water' || tags.waterway) {
        featureType = 'water';
      } else if (tags.landuse === 'forest' || tags.natural === 'wood') {
        featureType = 'forest';
      } else if (tags.leisure === 'park' || tags.landuse === 'grass') {
        featureType = 'park';
      } else if (tags.amenity === 'parking') {
        featureType = 'parking';
      }

      if (featureType) {
        this.osmFeatures.push({
          type: featureType,
          geometry: element.geometry,
        });
      }
    }
  }

  private generateTerrainFromOSM(): void {
    // Reset to grass
    this.initializeTerrainGrid();

    // Convert GPS to tile coordinates
    const centerLat = this.currentPosition.latitude;
    const centerLon = this.currentPosition.longitude;

    // Calculate degrees per tile
    const latPerTile = METERS_PER_TILE / 111000;
    const lonPerTile = METERS_PER_TILE / (111000 * Math.cos(centerLat * Math.PI / 180));

    // Process each OSM feature
    for (const feature of this.osmFeatures) {
      const terrainType = this.osmTypeToTerrain(feature.type);

      if (feature.type === 'road') {
        // Roads are lines - draw thick lines between consecutive points
        this.drawRoadLine(feature.geometry, centerLat, centerLon, latPerTile, lonPerTile);
      } else {
        // Fill polygon interiors for buildings, water, parks, forests
        this.fillPolygon(feature.geometry, terrainType, centerLat, centerLon, latPerTile, lonPerTile);
      }
    }

    console.log(`Rendered ${this.osmFeatures.length} OSM features`);
  }

  private drawRoadLine(
    geometry: { lat: number; lon: number }[],
    centerLat: number,
    centerLon: number,
    latPerTile: number,
    lonPerTile: number
  ): void {
    // Convert to tile coordinates
    const points = geometry.map(p => ({
      x: Math.floor((p.lon - centerLon) / lonPerTile + TILES_X / 2),
      y: Math.floor((centerLat - p.lat) / latPerTile + TILES_Y / 2),
    }));

    // Draw lines between consecutive points using Bresenham's algorithm
    for (let i = 0; i < points.length - 1; i++) {
      this.drawThickLine(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, 'path');
    }
  }

  private drawThickLine(x0: number, y0: number, x1: number, y1: number, terrain: TerrainType): void {
    // Bresenham's line algorithm with thickness
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      // Draw a 2x2 block for thickness
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const tx = x + ox;
          const ty = y + oy;
          if (tx >= 0 && tx < TILES_X && ty >= 0 && ty < TILES_Y) {
            const currentTerrain = this.terrainGrid[ty][tx];
            if (this.getTerrainPriority(terrain) >= this.getTerrainPriority(currentTerrain)) {
              this.terrainGrid[ty][tx] = terrain;
            }
          }
        }
      }

      if (x === x1 && y === y1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  private fillPolygon(
    geometry: { lat: number; lon: number }[],
    terrainType: TerrainType,
    centerLat: number,
    centerLon: number,
    latPerTile: number,
    lonPerTile: number
  ): void {
    // Convert to tile coordinates
    const points = geometry.map(p => ({
      x: Math.floor((p.lon - centerLon) / lonPerTile + TILES_X / 2),
      y: Math.floor((centerLat - p.lat) / latPerTile + TILES_Y / 2),
    }));

    // Find bounding box
    let minX = TILES_X, maxX = 0, minY = TILES_Y, maxY = 0;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    // Scanline fill
    for (let y = Math.max(0, minY); y <= Math.min(TILES_Y - 1, maxY); y++) {
      for (let x = Math.max(0, minX); x <= Math.min(TILES_X - 1, maxX); x++) {
        if (this.pointInPolygon(x, y, points)) {
          const currentTerrain = this.terrainGrid[y][x];
          if (this.getTerrainPriority(terrainType) >= this.getTerrainPriority(currentTerrain)) {
            this.terrainGrid[y][x] = terrainType;
          }
        }
      }
    }
  }

  private pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  private osmTypeToTerrain(type: OSMFeature['type']): TerrainType {
    switch (type) {
      case 'building': return 'town';
      case 'road': return 'path';
      case 'water': return 'water';
      case 'forest': return 'forest';
      case 'park': return 'park';
      case 'parking': return 'sand'; // Use sand color for parking lots
      default: return 'grass';
    }
  }

  private getTerrainPriority(terrain: TerrainType): number {
    // Priority determines what draws over what
    // Higher priority = draws on top
    const priorities: Record<TerrainType, number> = {
      grass: 0,
      park: 1,
      forest: 2,
      sand: 3,
      path: 4,      // Roads draw over grass/parks/forest
      town: 5,      // Buildings draw over roads
      water: 6,     // Water draws over everything
      mountain: 7,
    };
    return priorities[terrain];
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private generateProceduralTerrain(): void {
    for (let y = 0; y < TILES_Y; y++) {
      for (let x = 0; x < TILES_X; x++) {
        this.terrainGrid[y][x] = this.getProceduralTerrainAt(x, y);
      }
    }
  }

  private getProceduralTerrainAt(tileX: number, tileY: number): TerrainType {
    const worldX = this.currentPosition.longitude * 10000 + tileX;
    const worldY = this.currentPosition.latitude * 10000 + tileY;

    const noise = this.pseudoNoise(worldX, worldY);
    const noise2 = this.pseudoNoise(worldX * 3.7, worldY * 3.7);

    // Simple procedural fallback
    if (noise > 0.85) return 'water';
    if (noise > 0.7) return 'forest';
    if (noise > 0.5 && noise2 > 0.5) return 'town';
    if (noise < 0.3) return 'path';
    return 'grass';
  }

  private pseudoNoise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  // Register named frames on the tileset texture: 32px terrain tiles plus
  // free-form building sprites (bounding boxes measured from the sheet).
  private defineTilesetFrames(): void {
    if (!this.textures.exists('world-tileset')) {
      this.useTileset = false;
      return;
    }
    const tex = this.textures.get('world-tileset');
    const cell = (name: string, col: number, row: number) => {
      if (!tex.has(name)) tex.add(name, 0, col * 32, row * 32, 32, 32);
    };
    cell('t_grass', 0, 0);
    cell('t_water', 3, 4);
    cell('t_forest', 4, 1);
    cell('t_mountain', 3, 8);
    cell('t_road', 7, 8);
    cell('t_sand', 3, 12);

    const rect = (name: string, x: number, y: number, w: number, h: number) => {
      if (!tex.has(name)) tex.add(name, 0, x, y, w, h);
    };
    rect('s_cottage', 6, 535, 76, 68);
    rect('s_manor', 82, 538, 96, 69);
    rect('s_tower', 176, 526, 33, 84);

    this.useTileset = true;
  }

  private createWorldMap(): void {
    this.defineTilesetFrames();

    if (this.useTileset) {
      this.terrainRT = this.add
        .renderTexture(0, 0, TILES_X * MAP_TILE_SIZE, TILES_Y * MAP_TILE_SIZE)
        .setOrigin(0, 0);
      this.mapContainer.add(this.terrainRT);
    } else {
      // Fallback to the original procedural renderer if the tileset is missing
      this.mapGraphics = this.add.graphics();
      this.mapContainer.add(this.mapGraphics);
    }

    this.drawMap();
  }

  private drawMap(): void {
    if (this.useTileset && this.terrainRT) {
      this.terrainRT.clear();
      const S = MAP_TILE_SIZE;
      for (let y = 0; y < TILES_Y; y++) {
        for (let x = 0; x < TILES_X; x++) {
          const frame = TERRAIN_FRAME[this.terrainGrid[y][x]] || 't_grass';
          this.terrainRT.drawFrame('world-tileset', frame, x * S, y * S);
        }
      }
      this.placeTownStructures();
      return;
    }

    this.mapGraphics.clear();
    for (let y = 0; y < TILES_Y; y++) {
      for (let x = 0; x < TILES_X; x++) {
        this.drawTile(x, y, this.terrainGrid[y][x]);
      }
    }
  }

  // Scatter buildings on 'town' terrain across a coarse lattice so they read
  // as villages rather than a solid wall of houses.
  private placeTownStructures(): void {
    this.townSprites.forEach(s => s.destroy());
    this.townSprites = [];

    const S = MAP_TILE_SIZE;
    const houses = ['s_cottage', 's_manor', 's_tower'];
    for (let y = 0; y < TILES_Y; y++) {
      for (let x = 0; x < TILES_X; x++) {
        if (this.terrainGrid[y][x] !== 'town') continue;
        if (x % 3 !== 0 || y % 3 !== 0) continue;

        const key = houses[(x * 7 + y * 13) % houses.length];
        const img = this.add.image(x * S + S / 2, y * S + S, 'world-tileset', key);
        img.setOrigin(0.5, 1); // anchor building base at the tile's bottom edge
        img.setScale((S * 2) / img.width); // ~2 tiles wide
        this.mapContainer.add(img);
        this.townSprites.push(img);
      }
    }
  }

  private drawTile(tileX: number, tileY: number, terrain: TerrainType): void {
    const x = tileX * MAP_TILE_SIZE;
    const y = tileY * MAP_TILE_SIZE;

    switch (terrain) {
      case 'water':
        this.drawWaterTile(x, y, tileX, tileY);
        break;
      case 'grass':
        this.drawGrassTile(x, y, tileX, tileY);
        break;
      case 'forest':
        this.drawForestTile(x, y, tileX, tileY);
        break;
      case 'path':
        this.drawPathTile(x, y, tileX, tileY);
        break;
      case 'mountain':
        this.drawMountainTile(x, y, tileX, tileY);
        break;
      case 'town':
        this.drawTownTile(x, y, tileX, tileY);
        break;
      case 'sand':
        this.drawSandTile(x, y, tileX, tileY);
        break;
      case 'park':
        this.drawParkTile(x, y, tileX, tileY);
        break;
    }
  }

  private drawWaterTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    const waveOffset = Math.floor(this.animationTime / 500) % 2;
    const isWave = ((tileX + tileY + waveOffset) % 2) === 0;

    this.mapGraphics.fillStyle(isWave ? PALETTE.waterDeep : PALETTE.waterShallow, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    // Wave highlights
    if (isWave) {
      this.mapGraphics.fillStyle(PALETTE.waterShore, 0.6);
      this.mapGraphics.fillRect(x + 2, y + s / 2 - 1, s - 4, 2);
    }
  }

  private drawGrassTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    const variation = this.pseudoNoise(tileX * 3, tileY * 3);
    this.mapGraphics.fillStyle(variation > 0.5 ? PALETTE.grass : PALETTE.grassLight, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    // Grass details
    if (variation > 0.7) {
      this.mapGraphics.fillStyle(PALETTE.grassDark, 1);
      this.mapGraphics.fillRect(x + 3, y + 10, 2, 4);
      this.mapGraphics.fillRect(x + 10, y + 5, 2, 4);
    }
  }

  private drawParkTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    // Lighter green for parks
    this.mapGraphics.fillStyle(PALETTE.grassLight, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    const variation = this.pseudoNoise(tileX * 5, tileY * 5);

    // Occasional flowers
    if (variation > 0.7) {
      this.mapGraphics.fillStyle(0xff6080, 1);
      this.mapGraphics.fillCircle(x + 5, y + 5, 2);
      this.mapGraphics.fillStyle(0xffff60, 1);
      this.mapGraphics.fillCircle(x + 11, y + 10, 2);
    }

    // Occasional small tree
    if (variation > 0.85) {
      this.mapGraphics.fillStyle(PALETTE.tree, 1);
      this.mapGraphics.fillCircle(x + s / 2, y + s / 2, 4);
    }
  }

  private drawForestTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    // Dark grass background
    this.mapGraphics.fillStyle(PALETTE.grassDark, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    const variation = this.pseudoNoise(tileX * 5, tileY * 5);
    const treeColor = variation > 0.5 ? PALETTE.tree : PALETTE.treeDark;

    // Tree top (circular)
    this.mapGraphics.fillStyle(treeColor, 1);
    this.mapGraphics.fillCircle(x + s / 2, y + s / 2 - 2, s / 2 - 2);

    // Highlight
    this.mapGraphics.fillStyle(PALETTE.treeLight, 1);
    this.mapGraphics.fillCircle(x + s / 2 - 2, y + s / 2 - 4, 3);
  }

  private drawPathTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;

    // Check neighbors to determine road connections
    const hasN = tileY > 0 && this.terrainGrid[tileY - 1]?.[tileX] === 'path';
    const hasS = tileY < TILES_Y - 1 && this.terrainGrid[tileY + 1]?.[tileX] === 'path';
    const hasE = tileX < TILES_X - 1 && this.terrainGrid[tileY]?.[tileX + 1] === 'path';
    const hasW = tileX > 0 && this.terrainGrid[tileY]?.[tileX - 1] === 'path';

    // Base road color
    this.mapGraphics.fillStyle(PALETTE.path, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    // Road edges (darker)
    this.mapGraphics.fillStyle(PALETTE.pathDark, 1);

    if (!hasN) this.mapGraphics.fillRect(x, y, s, 2);
    if (!hasS) this.mapGraphics.fillRect(x, y + s - 2, s, 2);
    if (!hasE) this.mapGraphics.fillRect(x + s - 2, y, 2, s);
    if (!hasW) this.mapGraphics.fillRect(x, y, 2, s);

    // Center line for straight roads
    if ((hasN && hasS && !hasE && !hasW) || (!hasN && !hasS && hasE && hasW)) {
      this.mapGraphics.fillStyle(PALETTE.pathLight, 1);
      if (hasN && hasS) {
        this.mapGraphics.fillRect(x + s / 2 - 1, y + 2, 2, s - 4);
      } else {
        this.mapGraphics.fillRect(x + 2, y + s / 2 - 1, s - 4, 2);
      }
    }
  }

  private drawMountainTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    this.mapGraphics.fillStyle(PALETTE.grassDark, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    const height = this.pseudoNoise(tileX * 2, tileY * 2);

    // Mountain shape
    this.mapGraphics.fillStyle(PALETTE.rock, 1);
    this.mapGraphics.fillTriangle(x + s / 2, y + 1, x + 1, y + s - 2, x + s - 1, y + s - 2);

    // Shading
    this.mapGraphics.fillStyle(PALETTE.rockDark, 1);
    this.mapGraphics.fillTriangle(x + s / 2, y + 1, x + 1, y + s - 2, x + s / 2, y + s - 2);

    // Snow cap
    if (height > 0.6) {
      this.mapGraphics.fillStyle(PALETTE.rockSnow, 1);
      this.mapGraphics.fillTriangle(x + s / 2, y + 1, x + s / 2 - 3, y + 5, x + s / 2 + 3, y + 5);
    }
  }

  private drawTownTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;

    // Ground
    this.mapGraphics.fillStyle(PALETTE.sand, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    const buildingType = this.pseudoNoise(tileX * 7, tileY * 7);

    // Building wall
    this.mapGraphics.fillStyle(PALETTE.wallLight, 1);
    this.mapGraphics.fillRect(x + 2, y + 5, s - 4, s - 6);

    // Roof
    const roofColor = buildingType > 0.66 ? PALETTE.roofRed :
                      buildingType > 0.33 ? PALETTE.roofBlue : PALETTE.roofBrown;
    this.mapGraphics.fillStyle(roofColor, 1);
    this.mapGraphics.fillTriangle(x + s / 2, y + 1, x + 1, y + 6, x + s - 1, y + 6);

    // Door
    this.mapGraphics.fillStyle(PALETTE.pathDark, 1);
    this.mapGraphics.fillRect(x + s / 2 - 2, y + s - 5, 4, 4);

    // Window
    this.mapGraphics.fillStyle(0x80c0ff, 1);
    this.mapGraphics.fillRect(x + 4, y + 7, 3, 3);
    if (s > 14) {
      this.mapGraphics.fillRect(x + s - 7, y + 7, 3, 3);
    }
  }

  private drawSandTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    this.mapGraphics.fillStyle(PALETTE.sand, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    // Parking lot lines
    const variation = this.pseudoNoise(tileX * 4, tileY * 4);
    if (variation > 0.5) {
      this.mapGraphics.fillStyle(PALETTE.pathLight, 1);
      this.mapGraphics.fillRect(x + s - 2, y + 2, 1, s - 4);
    }
  }

  private animateWater(): void {
    // Tileset water is static pixel art; skip the procedural wave redraw
    if (this.useTileset) return;
    for (let y = 0; y < TILES_Y; y++) {
      for (let x = 0; x < TILES_X; x++) {
        if (this.terrainGrid[y][x] === 'water') {
          this.drawWaterTile(x * MAP_TILE_SIZE, y * MAP_TILE_SIZE, x, y);
        }
      }
    }
  }

  private createPlayerMarker(): void {
    this.playerMarker = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);

    const playerGraphics = this.add.graphics();

    // Shadow
    playerGraphics.fillStyle(0x000000, 0.3);
    playerGraphics.fillEllipse(0, 8, 14, 6);

    // Body (blue tunic)
    playerGraphics.fillStyle(0x4060c0, 1);
    playerGraphics.fillRect(-6, -2, 12, 12);

    // Head
    playerGraphics.fillStyle(0xffd0a0, 1);
    playerGraphics.fillCircle(0, -7, 6);

    // Hair
    playerGraphics.fillStyle(0x804020, 1);
    playerGraphics.fillRect(-5, -12, 10, 5);

    // Eyes
    playerGraphics.fillStyle(0x000000, 1);
    playerGraphics.fillRect(-3, -8, 2, 2);
    playerGraphics.fillRect(1, -8, 2, 2);

    this.playerMarker.add(playerGraphics);
    this.playerMarker.setDepth(100);

    // Bobbing animation
    this.tweens.add({
      targets: this.playerMarker,
      y: this.playerMarker.y - 3,
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private createResourceMarkers(): void {
    // Spawn treasure chests
    for (let i = 0; i < 5; i++) {
      const x = Phaser.Math.Between(40, GAME_WIDTH - 40);
      const y = Phaser.Math.Between(100, GAME_HEIGHT - 200);

      const container = this.add.container(x, y);
      const graphics = this.add.graphics();

      // Chest body
      graphics.fillStyle(0x804020, 1);
      graphics.fillRect(-8, -4, 16, 10);

      // Chest lid
      graphics.fillStyle(0xa06030, 1);
      graphics.fillRect(-8, -8, 16, 5);

      // Metal bands
      graphics.fillStyle(0xc0a000, 1);
      graphics.fillRect(-8, -4, 16, 2);
      graphics.fillRect(-2, -8, 4, 14);

      // Keyhole
      graphics.fillStyle(0x000000, 1);
      graphics.fillCircle(0, 0, 2);

      container.add(graphics);
      container.setDepth(50);
      container.setInteractive(new Phaser.Geom.Rectangle(-10, -10, 20, 20), Phaser.Geom.Rectangle.Contains);
      container.on('pointerdown', () => this.onResourceTap(container));

      this.tweens.add({
        targets: container,
        alpha: { from: 1, to: 0.7 },
        duration: 800,
        yoyo: true,
        repeat: -1,
      });

      this.resourceMarkers.push(container);
    }

    // Spawn dungeon markers
    for (let i = 0; i < 2; i++) {
      const x = Phaser.Math.Between(40, GAME_WIDTH - 40);
      const y = Phaser.Math.Between(100, GAME_HEIGHT - 200);

      const container = this.add.container(x, y);
      const graphics = this.add.graphics();

      // Cave entrance
      graphics.fillStyle(PALETTE.rockDark, 1);
      graphics.fillTriangle(0, -12, -14, 8, 14, 8);

      graphics.fillStyle(0x101020, 1);
      graphics.fillEllipse(0, 2, 12, 10);

      // Skull
      graphics.fillStyle(0xe0e0e0, 1);
      graphics.fillCircle(0, -2, 4);
      graphics.fillStyle(0x000000, 1);
      graphics.fillRect(-3, -3, 2, 2);
      graphics.fillRect(1, -3, 2, 2);

      container.add(graphics);
      container.setDepth(50);
      container.setInteractive(new Phaser.Geom.Rectangle(-15, -15, 30, 30), Phaser.Geom.Rectangle.Contains);
      container.on('pointerdown', () => this.onDungeonTap(container));

      this.dungeonMarkers.push(container);
    }
  }

  private createUI(): void {
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x202040, 1);
    headerBg.fillRect(0, 0, GAME_WIDTH, 60);
    headerBg.lineStyle(2, 0x4060a0, 1);
    headerBg.strokeRect(2, 2, GAME_WIDTH - 4, 56);
    headerBg.setDepth(200);

    const title = this.add.text(GAME_WIDTH / 2, 18, 'WORLD MAP', {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    title.setOrigin(0.5, 0);
    title.setDepth(201);

    this.positionText = this.add.text(10, 40, 'Lat: -- Lon: --', {
      fontSize: '10px',
      color: '#80a0c0',
      fontFamily: 'monospace',
    });
    this.positionText.setDepth(201);

    const navBg = this.add.graphics();
    navBg.fillStyle(0x202040, 1);
    navBg.fillRect(0, GAME_HEIGHT - 70, GAME_WIDTH, 70);
    navBg.lineStyle(2, 0x4060a0, 1);
    navBg.strokeRect(2, GAME_HEIGHT - 68, GAME_WIDTH - 4, 66);
    navBg.setDepth(200);

    this.createNavButton(GAME_WIDTH / 4, GAME_HEIGHT - 35, 'WORLD', true);
    this.createNavButton((GAME_WIDTH / 4) * 2, GAME_HEIGHT - 35, 'KINGDOM', false, () => {
      this.scene.start('KingdomScene');
    });
    this.createNavButton((GAME_WIDTH / 4) * 3, GAME_HEIGHT - 35, 'BATTLE', false, () => {
      this.scene.start('BattleScene');
    });
  }

  private createNavButton(
    x: number,
    y: number,
    label: string,
    active: boolean,
    callback?: () => void
  ): void {
    const bg = this.add.graphics();
    bg.fillStyle(active ? 0x4060a0 : 0x303050, 1);
    bg.fillRoundedRect(x - 40, y - 12, 80, 24, 4);
    bg.lineStyle(1, active ? 0x80a0e0 : 0x505070, 1);
    bg.strokeRoundedRect(x - 40, y - 12, 80, 24, 4);
    bg.setDepth(201);

    const btn = this.add.text(x, y, label, {
      fontSize: '11px',
      color: active ? '#ffffff' : '#808090',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    btn.setOrigin(0.5);
    btn.setDepth(202);

    if (callback) {
      bg.setInteractive(new Phaser.Geom.Rectangle(x - 40, y - 12, 80, 24), Phaser.Geom.Rectangle.Contains);
      bg.on('pointerdown', callback);
      bg.on('pointerover', () => btn.setColor('#ffff80'));
      bg.on('pointerout', () => btn.setColor(active ? '#ffffff' : '#808090'));
    }
  }

  private createMapToggle(): void {
    this.mapToggleBg = this.add.graphics();
    // Start with real map style (blue) since isRealMapView defaults to true
    this.mapToggleBg.fillStyle(0x4060a0, 1);
    this.mapToggleBg.fillRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
    this.mapToggleBg.lineStyle(1, 0x80a0e0, 1);
    this.mapToggleBg.strokeRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
    this.mapToggleBg.setDepth(250);

    // Button says "RPG MAP" since we're showing real map by default
    this.mapToggleBtn = this.add.text(GAME_WIDTH - 52, 46, 'RPG MAP', {
      fontSize: '10px',
      color: '#80ff80',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    this.mapToggleBtn.setOrigin(0.5);
    this.mapToggleBtn.setDepth(251);

    this.mapToggleBg.setInteractive(
      new Phaser.Geom.Rectangle(GAME_WIDTH - 95, 35, 85, 22),
      Phaser.Geom.Rectangle.Contains
    );
    this.mapToggleBg.on('pointerdown', () => this.toggleMapView());
    this.mapToggleBg.on('pointerover', () => this.mapToggleBtn.setColor('#ffff80'));
    this.mapToggleBg.on('pointerout', () => this.mapToggleBtn.setColor('#80ff80'));

    // Hide RPG map container since we start with real map
    this.mapContainer.setVisible(false);
  }

  private createRealMapOverlay(): void {
    const iframe = document.createElement('iframe');
    iframe.id = 'real-map-overlay';
    iframe.style.position = 'fixed';
    iframe.style.border = 'none';
    // Show by default since isRealMapView is true
    iframe.style.display = this.isRealMapView ? 'block' : 'none';
    iframe.style.zIndex = '50';
    iframe.style.pointerEvents = 'none';
    iframe.setAttribute('loading', 'lazy');

    this.positionRealMapOverlay(iframe);
    this.updateRealMapUrl(iframe);

    // Track initial position to prevent unnecessary reloads
    this.lastMapPosition = {
      lat: this.currentPosition.latitude,
      lon: this.currentPosition.longitude,
    };

    document.body.appendChild(iframe);
    this.realMapElement = iframe;

    this.resizeHandler = () => this.positionRealMapOverlay();
    window.addEventListener('resize', this.resizeHandler);
  }

  private positionRealMapOverlay(iframe?: HTMLIFrameElement): void {
    const el = iframe || this.realMapElement;
    if (!el) return;

    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.height / GAME_HEIGHT;

    const headerHeight = 60 * scale;
    const navHeight = 70 * scale;

    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top + headerHeight}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height - headerHeight - navHeight}px`;
  }

  private updateRealMapUrl(iframe?: HTMLIFrameElement): void {
    const el = iframe || this.realMapElement;
    if (!el) return;

    const lat = this.currentPosition.latitude;
    const lon = this.currentPosition.longitude;
    const zoom = 18;

    const bbox = this.calculateBbox(lat, lon, zoom);
    el.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
  }

  private calculateBbox(lat: number, lon: number, zoom: number): string {
    const delta = 0.003 / Math.pow(2, zoom - 16);
    const west = lon - delta;
    const east = lon + delta;
    const south = lat - delta * 0.7;
    const north = lat + delta * 0.7;
    return `${west},${south},${east},${north}`;
  }

  private toggleMapView(): void {
    this.isRealMapView = !this.isRealMapView;

    if (this.isRealMapView) {
      if (this.realMapElement) {
        this.positionRealMapOverlay();
        this.updateRealMapUrl();
        this.realMapElement.style.display = 'block';
      }
      this.mapContainer.setVisible(false);
      this.playerMarker.setVisible(false);
      this.resourceMarkers.forEach(m => m.setVisible(false));
      this.dungeonMarkers.forEach(m => m.setVisible(false));
      this.mapToggleBtn.setText('RPG MAP');
      this.mapToggleBg.clear();
      this.mapToggleBg.fillStyle(0x4060a0, 1);
      this.mapToggleBg.fillRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
      this.mapToggleBg.lineStyle(1, 0x80a0e0, 1);
      this.mapToggleBg.strokeRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
    } else {
      if (this.realMapElement) {
        this.realMapElement.style.display = 'none';
      }
      // Regenerate terrain from OSM data before showing
      if (this.osmFeatures.length > 0) {
        this.generateTerrainFromOSM();
        this.drawMap();
      } else {
        // Fetch if we don't have data
        this.fetchOSMData();
      }
      this.mapContainer.setVisible(true);
      this.playerMarker.setVisible(true);
      this.resourceMarkers.forEach(m => m.setVisible(true));
      this.dungeonMarkers.forEach(m => m.setVisible(true));
      this.mapToggleBtn.setText('REAL MAP');
      this.mapToggleBg.clear();
      this.mapToggleBg.fillStyle(0x206020, 1);
      this.mapToggleBg.fillRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
      this.mapToggleBg.lineStyle(1, 0x40a040, 1);
      this.mapToggleBg.strokeRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
    }
  }

  private createDebugUI(): void {
    const debugToggle = this.add.text(GAME_WIDTH - 10, 10, '[DBG]', {
      fontSize: '10px',
      color: '#606080',
      fontFamily: 'monospace',
    });
    debugToggle.setOrigin(1, 0);
    debugToggle.setDepth(300);
    debugToggle.setInteractive();
    debugToggle.on('pointerdown', () => this.toggleDebugMode());

    this.debugContainer = this.add.container(0, 65);
    this.debugContainer.setDepth(300);
    this.debugContainer.setVisible(false);

    const panelBg = this.add.graphics();
    panelBg.fillStyle(0x202040, 0.95);
    panelBg.fillRect(5, 0, GAME_WIDTH - 10, 110);
    panelBg.lineStyle(2, 0x4060a0, 1);
    panelBg.strokeRect(5, 0, GAME_WIDTH - 10, 110);
    this.debugContainer.add(panelBg);

    const latLabel = this.add.text(15, 8, 'LAT:', {
      fontSize: '11px',
      color: '#80a0c0',
      fontFamily: 'monospace',
    });
    this.debugContainer.add(latLabel);

    const latValue = this.add.text(120, 8, this.currentPosition.latitude.toFixed(4), {
      fontSize: '11px',
      color: '#ffffff',
      fontFamily: 'monospace',
    });
    this.debugContainer.add(latValue);

    this.createDebugSlider(15, 25, 'lat', -90, 90, this.currentPosition.latitude, (value) => {
      this.currentPosition.latitude = value;
      latValue.setText(value.toFixed(4));
      this.updatePositionDisplay();
      this.fetchOSMData();
    });

    const lonLabel = this.add.text(15, 48, 'LON:', {
      fontSize: '11px',
      color: '#80a0c0',
      fontFamily: 'monospace',
    });
    this.debugContainer.add(lonLabel);

    const lonValue = this.add.text(120, 48, this.currentPosition.longitude.toFixed(4), {
      fontSize: '11px',
      color: '#ffffff',
      fontFamily: 'monospace',
    });
    this.debugContainer.add(lonValue);

    this.createDebugSlider(15, 65, 'lon', -180, 180, this.currentPosition.longitude, (value) => {
      this.currentPosition.longitude = value;
      lonValue.setText(value.toFixed(4));
      this.updatePositionDisplay();
      this.fetchOSMData();
    });

    const moveBtn = this.add.text(GAME_WIDTH / 2, 92, '[ RELOAD MAP ]', {
      fontSize: '11px',
      color: '#80ff80',
      fontFamily: 'monospace',
    });
    moveBtn.setOrigin(0.5);
    moveBtn.setInteractive();
    moveBtn.on('pointerdown', () => {
      this.lastFetchPosition = null;
      this.fetchOSMData();
    });
    moveBtn.on('pointerover', () => moveBtn.setColor('#ffff80'));
    moveBtn.on('pointerout', () => moveBtn.setColor('#80ff80'));
    this.debugContainer.add(moveBtn);
  }

  private createDebugSlider(
    x: number,
    y: number,
    _id: string,
    min: number,
    max: number,
    initial: number,
    onChange: (value: number) => void
  ): void {
    const width = GAME_WIDTH - 50;

    const track = this.add.graphics();
    track.fillStyle(0x404060, 1);
    track.fillRoundedRect(x, y, width, 8, 4);
    this.debugContainer.add(track);

    const normalizedInitial = (initial - min) / (max - min);
    const handleX = x + normalizedInitial * width;

    const handle = this.add.circle(handleX, y + 4, 8, 0x80a0e0);
    handle.setInteractive({ draggable: true });
    this.debugContainer.add(handle);

    handle.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number) => {
      const clampedX = Phaser.Math.Clamp(dragX, x, x + width);
      handle.x = clampedX;

      const normalized = (clampedX - x) / width;
      const value = min + normalized * (max - min);
      onChange(value);
    });
  }

  private toggleDebugMode(): void {
    this.isDebugMode = !this.isDebugMode;
    this.debugContainer.setVisible(this.isDebugMode);
  }

  private initGeolocation(): void {
    if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.onGeolocationUpdate(position),
        (error) => this.onGeolocationError(error),
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 5000,
        }
      );
    } else {
      console.warn('Geolocation not available, using debug mode');
      this.isDebugMode = true;
      this.debugContainer.setVisible(true);
    }
  }

  private onGeolocationUpdate(position: GeolocationPosition): void {
    if (this.isDebugMode) return;

    const newLat = position.coords.latitude;
    const newLon = position.coords.longitude;

    // Check if position changed significantly (more than ~20 meters)
    const MIN_DISTANCE = 20;
    if (this.lastMapPosition) {
      const dist = this.haversineDistance(
        this.lastMapPosition.lat,
        this.lastMapPosition.lon,
        newLat,
        newLon
      );
      if (dist < MIN_DISTANCE) {
        return; // Position hasn't changed enough, skip update
      }
    }

    this.currentPosition = {
      latitude: newLat,
      longitude: newLon,
      accuracy: position.coords.accuracy,
    };

    this.updatePositionDisplay();
    this.fetchOSMData();

    if (this.isRealMapView) {
      this.updateRealMapUrl();
      this.lastMapPosition = { lat: newLat, lon: newLon };
    }
  }

  private onGeolocationError(error: GeolocationPositionError): void {
    console.error('Geolocation error:', error.message);
    if (!this.isDebugMode) {
      this.isDebugMode = true;
      this.debugContainer.setVisible(true);
    }
  }

  private updatePositionDisplay(): void {
    this.positionText.setText(
      `Lat: ${this.currentPosition.latitude.toFixed(4)} Lon: ${this.currentPosition.longitude.toFixed(4)}`
    );
  }

  private onResourceTap(marker: Phaser.GameObjects.Container): void {
    const distance = Phaser.Math.Distance.Between(
      this.playerMarker.x,
      this.playerMarker.y,
      marker.x,
      marker.y
    );

    if (distance < 80) {
      this.tweens.add({
        targets: marker,
        scaleY: 1.3,
        duration: 150,
        yoyo: true,
        onComplete: () => {
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const sparkle = this.add.circle(
              marker.x + Math.cos(angle) * 5,
              marker.y + Math.sin(angle) * 5,
              3,
              0xffff00
            );
            this.tweens.add({
              targets: sparkle,
              x: marker.x + Math.cos(angle) * 30,
              y: marker.y + Math.sin(angle) * 30,
              alpha: 0,
              duration: 400,
              onComplete: () => sparkle.destroy(),
            });
          }

          marker.destroy();
          const index = this.resourceMarkers.indexOf(marker);
          if (index > -1) this.resourceMarkers.splice(index, 1);
        },
      });

      this.events.emit('resource-collected', { type: 'gold', amount: 50 });
    } else {
      this.cameras.main.shake(100, 0.005);
    }
  }

  private onDungeonTap(marker: Phaser.GameObjects.Container): void {
    const distance = Phaser.Math.Distance.Between(
      this.playerMarker.x,
      this.playerMarker.y,
      marker.x,
      marker.y
    );

    if (distance < 80) {
      this.cameras.main.fadeOut(500, 0, 0, 0, (_camera: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress === 1) {
          this.scene.start('BattleScene');
        }
      });
    } else {
      this.cameras.main.shake(100, 0.005);
    }
  }

  shutdown(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.realMapElement) {
      this.realMapElement.remove();
      this.realMapElement = null;
    }
  }
}
