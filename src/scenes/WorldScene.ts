import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';

interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
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
  pathDark: 0x806040,
  path: 0xa08060,
  pathLight: 0xc0a080,

  // Mountain/Rock colors
  rockDark: 0x505050,
  rock: 0x808080,
  rockLight: 0xa0a0a0,
  rockSnow: 0xe0e0f0,

  // Town/Building colors
  roofRed: 0xc04040,
  roofBlue: 0x4040c0,
  wallLight: 0xe0d0c0,
  wallDark: 0xa09080,

  // Sand/Desert colors
  sand: 0xe0c080,
  sandDark: 0xc0a060,
};

// Tile size for the SNES-style map - larger tiles for zoomed in street view
const MAP_TILE_SIZE = 32;
const TILES_X = Math.ceil(GAME_WIDTH / MAP_TILE_SIZE);
const TILES_Y = Math.ceil(GAME_HEIGHT / MAP_TILE_SIZE);

// Zoom level - higher = more zoomed in (street level)
// Each tile represents roughly 5-10 meters at this scale
const COORD_SCALE = 50000;

type TerrainType = 'water' | 'grass' | 'forest' | 'path' | 'mountain' | 'town' | 'sand';

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
  private terrainGrid: TerrainType[][] = [];
  private animationTime: number = 0;
  private mapContainer!: Phaser.GameObjects.Container;
  private isRealMapView: boolean = false;
  private realMapElement: HTMLIFrameElement | null = null;
  private mapToggleBtn!: Phaser.GameObjects.Text;
  private mapToggleBg!: Phaser.GameObjects.Graphics;
  private resizeHandler: (() => void) | null = null;

  constructor() {
    super({ key: 'WorldScene' });
  }

  create(): void {
    // Create map container for all map elements
    this.mapContainer = this.add.container(0, 0);

    this.generateTerrainGrid();
    this.createWorldMap();
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

  private generateTerrainGrid(): void {
    this.terrainGrid = [];

    for (let y = 0; y < TILES_Y; y++) {
      this.terrainGrid[y] = [];
      for (let x = 0; x < TILES_X; x++) {
        this.terrainGrid[y][x] = this.getTerrainAt(x, y);
      }
    }
  }

  private getTerrainAt(tileX: number, tileY: number): TerrainType {
    // Use GPS position as seed - high scale for street-level detail
    const worldX = this.currentPosition.longitude * COORD_SCALE + tileX;
    const worldY = this.currentPosition.latitude * COORD_SCALE + tileY;

    // Multiple noise layers for varied terrain
    const noise = this.pseudoNoise(worldX, worldY);
    const noise2 = this.pseudoNoise(worldX * 3.7, worldY * 3.7);
    const roadNoise = this.pseudoNoise(worldX * 0.5, worldY * 0.5);

    // Distance from center (player position)
    const centerX = TILES_X / 2;
    const centerY = TILES_Y / 2;
    const distFromCenter = Math.sqrt(Math.pow(tileX - centerX, 2) + Math.pow(tileY - centerY, 2));

    // Player's immediate area is always walkable
    if (distFromCenter < 2) {
      return 'grass';
    }

    // Create street grid pattern - roads appear in a grid-like fashion
    const gridX = Math.abs(worldX % 8);
    const gridY = Math.abs(worldY % 8);
    const isRoadX = gridX < 1.5 || gridX > 6.5;
    const isRoadY = gridY < 1.5 || gridY > 6.5;

    // Main roads (more common at street level)
    if ((isRoadX || isRoadY) && roadNoise > 0.3) {
      return 'path';
    }

    // Intersections become town/buildings
    if (isRoadX && isRoadY && noise > 0.4) {
      return 'town';
    }

    // Buildings/houses along roads
    if ((gridX < 2.5 || gridX > 5.5 || gridY < 2.5 || gridY > 5.5) && noise > 0.6) {
      return 'town';
    }

    // Parks and green spaces
    if (noise < 0.25) {
      return noise2 > 0.5 ? 'forest' : 'grass';
    }

    // Water features (ponds, streams) - rare at street level
    if (noise > 0.92 && noise2 < 0.3) {
      return 'water';
    }

    // Default urban grass/yards
    if (noise < 0.5) {
      return 'grass';
    }

    // More buildings in urban areas
    if (noise > 0.7) {
      return 'town';
    }

    return 'grass';
  }

  private pseudoNoise(x: number, y: number): number {
    // Simple pseudo-random noise function
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  private createWorldMap(): void {
    this.mapGraphics = this.add.graphics();
    this.mapContainer.add(this.mapGraphics);

    this.drawMap();
  }

  private drawMap(): void {
    this.mapGraphics.clear();

    for (let y = 0; y < TILES_Y; y++) {
      for (let x = 0; x < TILES_X; x++) {
        this.drawTile(x, y, this.terrainGrid[y][x]);
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
        this.drawPathTile(x, y);
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
      this.mapGraphics.fillStyle(PALETTE.waterShore, 0.5);
      this.mapGraphics.fillRect(x + s * 0.2, y + s * 0.4, s * 0.6, 3);
    }
  }

  private drawGrassTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    const variation = this.pseudoNoise(tileX * 3, tileY * 3);
    this.mapGraphics.fillStyle(variation > 0.5 ? PALETTE.grass : PALETTE.grassLight, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    // Grass details
    if (variation > 0.6) {
      this.mapGraphics.fillStyle(PALETTE.grassDark, 1);
      this.mapGraphics.fillRect(x + s * 0.2, y + s * 0.6, 3, 5);
      this.mapGraphics.fillRect(x + s * 0.6, y + s * 0.5, 3, 5);
    }

    // Flowers
    if (variation > 0.85) {
      this.mapGraphics.fillStyle(0xff6080, 1);
      this.mapGraphics.fillCircle(x + s * 0.4, y + s * 0.3, 3);
      this.mapGraphics.fillStyle(0xffff60, 1);
      this.mapGraphics.fillCircle(x + s * 0.7, y + s * 0.7, 2);
    }
  }

  private drawForestTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    // Park/yard grass
    this.mapGraphics.fillStyle(PALETTE.grassDark, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    const variation = this.pseudoNoise(tileX * 5, tileY * 5);
    const treeColor = variation > 0.5 ? PALETTE.tree : PALETTE.treeDark;
    const cx = x + s / 2;
    const cy = y + s / 2;

    // Tree trunk
    this.mapGraphics.fillStyle(PALETTE.pathDark, 1);
    this.mapGraphics.fillRect(cx - 2, cy + 4, 4, s / 3);

    // Tree foliage - rounder for street-level trees
    this.mapGraphics.fillStyle(treeColor, 1);
    this.mapGraphics.fillCircle(cx, cy - 2, s / 3);
    this.mapGraphics.fillStyle(PALETTE.treeLight, 1);
    this.mapGraphics.fillCircle(cx - 3, cy - 5, s / 5);
  }

  private drawPathTile(x: number, y: number): void {
    const s = MAP_TILE_SIZE;
    // Dirt path / road
    this.mapGraphics.fillStyle(PALETTE.path, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    // Road markings / texture
    this.mapGraphics.fillStyle(PALETTE.pathDark, 1);
    this.mapGraphics.fillRect(x + s * 0.1, y + s * 0.2, s * 0.1, s * 0.1);
    this.mapGraphics.fillRect(x + s * 0.6, y + s * 0.6, s * 0.15, s * 0.1);

    this.mapGraphics.fillStyle(PALETTE.pathLight, 1);
    this.mapGraphics.fillRect(x + s * 0.35, y + s * 0.45, s * 0.3, s * 0.1);
  }

  private drawMountainTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    // Mountain base
    this.mapGraphics.fillStyle(PALETTE.grassDark, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    const height = this.pseudoNoise(tileX * 2, tileY * 2);

    // Mountain shape
    this.mapGraphics.fillStyle(PALETTE.rock, 1);
    this.mapGraphics.fillTriangle(x + s * 0.5, y + s * 0.06, x + s * 0.06, y + s * 0.88, x + s * 0.94, y + s * 0.88);

    // Shading on left side
    this.mapGraphics.fillStyle(PALETTE.rockDark, 1);
    this.mapGraphics.fillTriangle(x + s * 0.5, y + s * 0.06, x + s * 0.06, y + s * 0.88, x + s * 0.5, y + s * 0.88);

    // Snow cap on tall mountains
    if (height > 0.6) {
      this.mapGraphics.fillStyle(PALETTE.rockSnow, 1);
      this.mapGraphics.fillTriangle(x + s * 0.5, y + s * 0.06, x + s * 0.31, y + s * 0.38, x + s * 0.69, y + s * 0.38);
    }
  }

  private drawTownTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    // Town ground
    this.mapGraphics.fillStyle(PALETTE.path, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    const buildingType = this.pseudoNoise(tileX * 7, tileY * 7);

    // Building wall
    this.mapGraphics.fillStyle(PALETTE.wallLight, 1);
    this.mapGraphics.fillRect(x + s * 0.12, y + s * 0.38, s * 0.75, s * 0.56);

    // Roof
    const roofColor = buildingType > 0.5 ? PALETTE.roofRed : PALETTE.roofBlue;
    this.mapGraphics.fillStyle(roofColor, 1);
    this.mapGraphics.fillTriangle(x + s * 0.5, y + s * 0.06, x + s * 0.06, y + s * 0.44, x + s * 0.94, y + s * 0.44);

    // Door
    this.mapGraphics.fillStyle(PALETTE.pathDark, 1);
    this.mapGraphics.fillRect(x + s * 0.38, y + s * 0.56, s * 0.25, s * 0.38);

    // Window
    this.mapGraphics.fillStyle(0x80c0ff, 1);
    this.mapGraphics.fillRect(x + s * 0.18, y + s * 0.5, s * 0.15, s * 0.15);
    this.mapGraphics.fillRect(x + s * 0.68, y + s * 0.5, s * 0.15, s * 0.15);
  }

  private drawSandTile(x: number, y: number, tileX: number, tileY: number): void {
    const s = MAP_TILE_SIZE;
    // Sand base
    this.mapGraphics.fillStyle(PALETTE.sand, 1);
    this.mapGraphics.fillRect(x, y, s, s);

    // Sand texture
    const variation = this.pseudoNoise(tileX * 4, tileY * 4);
    if (variation > 0.6) {
      this.mapGraphics.fillStyle(PALETTE.sandDark, 1);
      this.mapGraphics.fillRect(x + s * 0.1, y + s * 0.3, s * 0.2, s * 0.05);
      this.mapGraphics.fillRect(x + s * 0.55, y + s * 0.7, s * 0.25, s * 0.05);
    }
  }

  private animateWater(): void {
    // Redraw only water tiles for animation
    for (let y = 0; y < TILES_Y; y++) {
      for (let x = 0; x < TILES_X; x++) {
        if (this.terrainGrid[y][x] === 'water') {
          this.drawWaterTile(x * MAP_TILE_SIZE, y * MAP_TILE_SIZE, x, y);
        }
      }
    }
  }

  private createPlayerMarker(): void {
    // Create SNES-style player sprite
    this.playerMarker = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);

    const playerGraphics = this.add.graphics();

    // Shadow
    playerGraphics.fillStyle(0x000000, 0.3);
    playerGraphics.fillEllipse(0, 6, 12, 4);

    // Body (blue tunic like classic JRPG hero)
    playerGraphics.fillStyle(0x4060c0, 1);
    playerGraphics.fillRect(-5, -2, 10, 10);

    // Head
    playerGraphics.fillStyle(0xffd0a0, 1);
    playerGraphics.fillCircle(0, -6, 5);

    // Hair
    playerGraphics.fillStyle(0x804020, 1);
    playerGraphics.fillRect(-4, -10, 8, 4);

    // Eyes
    playerGraphics.fillStyle(0x000000, 1);
    playerGraphics.fillRect(-3, -7, 2, 2);
    playerGraphics.fillRect(1, -7, 2, 2);

    this.playerMarker.add(playerGraphics);
    this.playerMarker.setDepth(100);

    // Bobbing animation
    this.tweens.add({
      targets: this.playerMarker,
      y: this.playerMarker.y - 2,
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private createResourceMarkers(): void {
    // Spawn resource points (treasure chests)
    for (let i = 0; i < 5; i++) {
      const x = Phaser.Math.Between(40, GAME_WIDTH - 40);
      const y = Phaser.Math.Between(100, GAME_HEIGHT - 200);

      const container = this.add.container(x, y);
      const graphics = this.add.graphics();

      // Treasure chest - SNES style
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

      // Sparkle effect
      this.tweens.add({
        targets: container,
        alpha: { from: 1, to: 0.7 },
        duration: 800,
        yoyo: true,
        repeat: -1,
      });

      this.resourceMarkers.push(container);
    }

    // Spawn dungeon markers (cave entrances)
    for (let i = 0; i < 2; i++) {
      const x = Phaser.Math.Between(40, GAME_WIDTH - 40);
      const y = Phaser.Math.Between(100, GAME_HEIGHT - 200);

      const container = this.add.container(x, y);
      const graphics = this.add.graphics();

      // Cave entrance - SNES style
      // Rock formation
      graphics.fillStyle(PALETTE.rockDark, 1);
      graphics.fillTriangle(0, -12, -14, 8, 14, 8);

      // Cave opening
      graphics.fillStyle(0x101020, 1);
      graphics.fillEllipse(0, 2, 12, 10);

      // Skull decoration
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
    // Header bar with SNES-style frame
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x202040, 1);
    headerBg.fillRect(0, 0, GAME_WIDTH, 60);
    // Border
    headerBg.lineStyle(2, 0x4060a0, 1);
    headerBg.strokeRect(2, 2, GAME_WIDTH - 4, 56);
    headerBg.setDepth(200);

    // Title with pixel font style
    const title = this.add.text(GAME_WIDTH / 2, 18, 'WORLD MAP', {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    title.setOrigin(0.5, 0);
    title.setDepth(201);

    // Position display
    this.positionText = this.add.text(10, 40, 'Lat: -- Lon: --', {
      fontSize: '10px',
      color: '#80a0c0',
      fontFamily: 'monospace',
    });
    this.positionText.setDepth(201);

    // Bottom navigation bar
    const navBg = this.add.graphics();
    navBg.fillStyle(0x202040, 1);
    navBg.fillRect(0, GAME_HEIGHT - 70, GAME_WIDTH, 70);
    navBg.lineStyle(2, 0x4060a0, 1);
    navBg.strokeRect(2, GAME_HEIGHT - 68, GAME_WIDTH - 4, 66);
    navBg.setDepth(200);

    // Navigation buttons
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
    // Button background
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
    // Map view toggle button (top right, below debug)
    this.mapToggleBg = this.add.graphics();
    this.mapToggleBg.fillStyle(0x206020, 1);
    this.mapToggleBg.fillRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
    this.mapToggleBg.lineStyle(1, 0x40a040, 1);
    this.mapToggleBg.strokeRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
    this.mapToggleBg.setDepth(250);

    this.mapToggleBtn = this.add.text(GAME_WIDTH - 52, 46, 'REAL MAP', {
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
  }

  private createRealMapOverlay(): void {
    // Create iframe for OpenStreetMap
    const iframe = document.createElement('iframe');
    iframe.id = 'real-map-overlay';
    iframe.style.position = 'fixed';
    iframe.style.border = 'none';
    iframe.style.display = 'none';
    iframe.style.zIndex = '50';
    iframe.style.pointerEvents = 'none';
    iframe.setAttribute('loading', 'lazy');

    // Position iframe over the game canvas
    this.positionRealMapOverlay(iframe);

    this.updateRealMapUrl(iframe);

    // Add to body for fixed positioning
    document.body.appendChild(iframe);
    this.realMapElement = iframe;

    // Reposition on window resize
    this.resizeHandler = () => this.positionRealMapOverlay();
    window.addEventListener('resize', this.resizeHandler);
  }

  private positionRealMapOverlay(iframe?: HTMLIFrameElement): void {
    const el = iframe || this.realMapElement;
    if (!el) return;

    // Get the canvas element's position
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();

    // Calculate scale factor (canvas may be scaled to fit)
    const scale = rect.height / GAME_HEIGHT;

    // Position iframe to match game area (below header, above nav)
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
    const zoom = 18; // Street level zoom

    // OpenStreetMap embed URL
    const bbox = this.calculateBbox(lat, lon, zoom);
    el.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
  }

  private calculateBbox(lat: number, lon: number, zoom: number): string {
    // Calculate bounding box for the map view
    // At zoom 18, roughly 0.002 degrees covers a small area
    const delta = 0.003 / Math.pow(2, zoom - 16);
    const west = lon - delta;
    const east = lon + delta;
    const south = lat - delta * 0.7; // Account for aspect ratio
    const north = lat + delta * 0.7;
    return `${west},${south},${east},${north}`;
  }

  private toggleMapView(): void {
    this.isRealMapView = !this.isRealMapView;

    if (this.isRealMapView) {
      // Show real map
      if (this.realMapElement) {
        this.positionRealMapOverlay();
        this.updateRealMapUrl();
        this.realMapElement.style.display = 'block';
      }
      this.mapContainer.setVisible(false);
      this.mapToggleBtn.setText('RPG MAP');
      this.mapToggleBg.clear();
      this.mapToggleBg.fillStyle(0x4060a0, 1);
      this.mapToggleBg.fillRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
      this.mapToggleBg.lineStyle(1, 0x80a0e0, 1);
      this.mapToggleBg.strokeRoundedRect(GAME_WIDTH - 95, 35, 85, 22, 4);
    } else {
      // Show RPG map
      if (this.realMapElement) {
        this.realMapElement.style.display = 'none';
      }
      this.mapContainer.setVisible(true);
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
      this.regenerateMap();
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
      this.regenerateMap();
    });

    const moveBtn = this.add.text(GAME_WIDTH / 2, 92, '[ SIMULATE WALK ]', {
      fontSize: '11px',
      color: '#80ff80',
      fontFamily: 'monospace',
    });
    moveBtn.setOrigin(0.5);
    moveBtn.setInteractive();
    moveBtn.on('pointerdown', () => this.simulateWalk());
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

  private regenerateMap(): void {
    this.generateTerrainGrid();
    this.drawMap();
    if (this.isRealMapView) {
      this.updateRealMapUrl();
    }
  }

  private toggleDebugMode(): void {
    this.isDebugMode = !this.isDebugMode;
    this.debugContainer.setVisible(this.isDebugMode);
  }

  private simulateWalk(): void {
    const latDelta = (Math.random() - 0.5) * 0.002;
    const lonDelta = (Math.random() - 0.5) * 0.002;

    this.currentPosition.latitude += latDelta;
    this.currentPosition.longitude += lonDelta;
    this.updatePositionDisplay();
    this.regenerateMap();

    // Walking animation
    this.tweens.add({
      targets: this.playerMarker,
      scaleX: 0.9,
      duration: 100,
      yoyo: true,
    });
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

    const oldLat = this.currentPosition.latitude;
    const oldLon = this.currentPosition.longitude;

    this.currentPosition = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };

    this.updatePositionDisplay();

    // Regenerate map if position changed significantly
    if (Math.abs(oldLat - this.currentPosition.latitude) > 0.0001 ||
        Math.abs(oldLon - this.currentPosition.longitude) > 0.0001) {
      this.regenerateMap();
      if (this.isRealMapView) {
        this.updateRealMapUrl();
      }
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
      // Chest opening animation
      this.tweens.add({
        targets: marker,
        scaleY: 1.3,
        duration: 150,
        yoyo: true,
        onComplete: () => {
          // Sparkle burst
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
      // Screen transition effect
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
    // Clean up resize listener
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    // Clean up real map iframe
    if (this.realMapElement) {
      this.realMapElement.remove();
      this.realMapElement = null;
    }
  }
}
