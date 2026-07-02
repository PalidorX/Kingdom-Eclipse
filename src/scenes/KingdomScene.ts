import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';

// Isometric tile dimensions
const TILE_WIDTH = 32;
const TILE_HEIGHT = 16;
const GRID_SIZE = 24; // 24x24 grid for the village

// Color palette matching the reference
const PALETTE = {
  // Ground
  grass: 0x5a8f3c,
  grassDark: 0x4a7f2c,
  grassLight: 0x6a9f4c,
  cobblestone: 0x8a8a7a,
  cobblestoneLight: 0x9a9a8a,
  cobblestoneDark: 0x6a6a5a,
  dirt: 0x9a7a5a,

  // Water
  water: 0x4a7ab5,
  waterLight: 0x5a8ac5,
  waterDark: 0x3a6aa5,

  // Buildings
  roofRed: 0xc04040,
  roofBlue: 0x4060c0,
  roofBrown: 0x8a6040,
  roofPurple: 0x8040a0,
  wallTan: 0xe0d0b0,
  wallWhite: 0xf0e8e0,
  wallBrown: 0xa08060,
  wood: 0x6a4a30,
  woodDark: 0x4a3020,

  // Foliage
  treeDark: 0x2a5a20,
  tree: 0x3a7a30,
  treeLight: 0x4a9a40,

  // Characters
  skinTone: 0xffd8b0,
  hair: 0x5a3a20,
};

interface GridTile {
  x: number;
  y: number;
  type: 'grass' | 'path' | 'water' | 'building';
  walkable: boolean;
  buildingId: string | null;
}

interface Building {
  id: string;
  type: string;
  name: string;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  container: Phaser.GameObjects.Container;
}

interface Character {
  id: string;
  name: string;
  type: 'hero' | 'visitor' | 'villager';
  gridX: number;
  gridY: number;
  container: Phaser.GameObjects.Container;
  path: { x: number; y: number }[];
  pathIndex: number;
  isMoving: boolean;
}

export class KingdomScene extends Phaser.Scene {
  private grid: GridTile[][] = [];
  private buildings: Building[] = [];
  private characters: Character[] = [];
  private pathfinder!: EasyStar.js;
  private mapContainer!: Phaser.GameObjects.Container;

  // Camera/pan
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private cameraOffsetX = 0;
  private cameraOffsetY = 0;

  constructor() {
    super({ key: 'KingdomScene' });
  }

  create(): void {
    // Center the isometric map
    this.cameraOffsetX = GAME_WIDTH / 2;
    this.cameraOffsetY = 100;

    this.mapContainer = this.add.container(this.cameraOffsetX, this.cameraOffsetY);

    this.initializeGrid();
    this.initializePathfinder();
    this.drawMap();
    this.createBuildings();
    this.createCharacters();
    this.setupInput();
    this.createUI();

    // Spawn visitors periodically
    this.time.addEvent({
      delay: 8000,
      callback: () => this.spawnVisitor(),
      loop: true,
    });

    // Initial visitor
    this.time.delayedCall(1000, () => this.spawnVisitor());
  }

  private initializeGrid(): void {
    this.grid = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      this.grid[y] = [];
      for (let x = 0; x < GRID_SIZE; x++) {
        this.grid[y][x] = {
          x, y,
          type: 'grass',
          walkable: true,
          buildingId: null,
        };
      }
    }

    // Create cobblestone paths
    this.createPaths();

    // Create water features
    this.createWater();
  }

  private createPaths(): void {
    // Main vertical path through center
    for (let y = 2; y < GRID_SIZE - 2; y++) {
      for (let x = 10; x <= 13; x++) {
        this.grid[y][x].type = 'path';
      }
    }

    // Horizontal path
    for (let x = 4; x < GRID_SIZE - 4; x++) {
      for (let y = 10; y <= 12; y++) {
        this.grid[y][x].type = 'path';
      }
    }

    // Side paths to buildings
    for (let y = 6; y <= 9; y++) {
      this.grid[y][6].type = 'path';
      this.grid[y][7].type = 'path';
      this.grid[y][16].type = 'path';
      this.grid[y][17].type = 'path';
    }
  }

  private createWater(): void {
    // Small pond
    for (let y = 16; y <= 18; y++) {
      for (let x = 4; x <= 7; x++) {
        this.grid[y][x].type = 'water';
        this.grid[y][x].walkable = false;
      }
    }
  }

  private initializePathfinder(): void {
    this.pathfinder = new EasyStar.js();
    this.updatePathfinderGrid();
  }

  private updatePathfinderGrid(): void {
    const walkableGrid: number[][] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      walkableGrid[y] = [];
      for (let x = 0; x < GRID_SIZE; x++) {
        walkableGrid[y][x] = this.grid[y][x].walkable ? 0 : 1;
      }
    }
    this.pathfinder.setGrid(walkableGrid);
    this.pathfinder.setAcceptableTiles([0]);
    this.pathfinder.enableDiagonals();
  }

  // Convert grid coords to isometric screen coords
  private gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: (gridX - gridY) * (TILE_WIDTH / 2),
      y: (gridX + gridY) * (TILE_HEIGHT / 2),
    };
  }

  private drawMap(): void {
    const graphics = this.add.graphics();
    this.mapContainer.add(graphics);

    // Draw tiles from back to front (isometric sorting)
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = this.grid[y][x];
        const screen = this.gridToScreen(x, y);
        this.drawIsometricTile(graphics, screen.x, screen.y, tile.type, x, y);
      }
    }

    // Draw trees on grass tiles
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = this.grid[y][x];
        if (tile.type === 'grass' && tile.buildingId === null) {
          // Random trees
          const noise = this.pseudoNoise(x * 7, y * 11);
          if (noise > 0.75) {
            this.drawTree(x, y);
          }
        }
      }
    }
  }

  private drawIsometricTile(
    graphics: Phaser.GameObjects.Graphics,
    x: number, y: number,
    type: string,
    gridX: number, gridY: number
  ): void {
    const hw = TILE_WIDTH / 2;
    const hh = TILE_HEIGHT / 2;

    // Tile diamond shape
    const points = [
      { x: x, y: y - hh },      // top
      { x: x + hw, y: y },       // right
      { x: x, y: y + hh },       // bottom
      { x: x - hw, y: y },       // left
    ];

    let fillColor: number;
    let variation = this.pseudoNoise(gridX * 3, gridY * 5);

    switch (type) {
      case 'path':
        fillColor = variation > 0.5 ? PALETTE.cobblestone : PALETTE.cobblestoneLight;
        break;
      case 'water':
        const wave = Math.sin(gridX * 0.5 + gridY * 0.5) > 0;
        fillColor = wave ? PALETTE.water : PALETTE.waterLight;
        break;
      default: // grass
        fillColor = variation > 0.6 ? PALETTE.grassDark :
                    variation > 0.3 ? PALETTE.grass : PALETTE.grassLight;
    }

    graphics.fillStyle(fillColor, 1);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    graphics.lineTo(points[1].x, points[1].y);
    graphics.lineTo(points[2].x, points[2].y);
    graphics.lineTo(points[3].x, points[3].y);
    graphics.closePath();
    graphics.fill();

    // Subtle tile border
    graphics.lineStyle(1, 0x000000, 0.1);
    graphics.strokePath();

    // Cobblestone details
    if (type === 'path') {
      graphics.fillStyle(PALETTE.cobblestoneDark, 0.3);
      const stoneSize = 3;
      for (let i = 0; i < 4; i++) {
        const sx = x + (this.pseudoNoise(gridX + i, gridY) - 0.5) * (hw - 4);
        const sy = y + (this.pseudoNoise(gridX, gridY + i) - 0.5) * (hh - 2);
        graphics.fillCircle(sx, sy, stoneSize);
      }
    }
  }

  private drawTree(gridX: number, gridY: number): void {
    const screen = this.gridToScreen(gridX, gridY);
    const container = this.add.container(screen.x, screen.y - 20);
    this.mapContainer.add(container);

    const graphics = this.add.graphics();
    container.add(graphics);

    // Tree trunk
    graphics.fillStyle(PALETTE.wood, 1);
    graphics.fillRect(-3, 10, 6, 15);

    // Foliage layers (circular blobs)
    const variation = this.pseudoNoise(gridX * 13, gridY * 17);
    const baseColor = variation > 0.5 ? PALETTE.tree : PALETTE.treeDark;

    graphics.fillStyle(baseColor, 1);
    graphics.fillCircle(0, 0, 12);
    graphics.fillCircle(-6, 4, 10);
    graphics.fillCircle(6, 4, 10);

    // Highlight
    graphics.fillStyle(PALETTE.treeLight, 1);
    graphics.fillCircle(-3, -4, 6);

    // Sort depth based on Y position
    container.setDepth(screen.y + 100);
  }

  private createBuildings(): void {
    // Inn (center)
    this.createBuilding('inn', 'The Wandering Knight', 11, 6, 3, 3);

    // Blacksmith
    this.createBuilding('blacksmith', 'Iron Forge', 5, 7, 2, 2);

    // Shop
    this.createBuilding('shop', 'General Store', 17, 7, 2, 2);

    // Barracks
    this.createBuilding('barracks', 'Barracks', 14, 14, 3, 2);

    // Tower
    this.createBuilding('tower', 'Watch Tower', 6, 14, 2, 2);

    // House 1
    this.createBuilding('house', 'Cottage', 4, 4, 2, 2);

    // House 2
    this.createBuilding('house2', 'Manor', 18, 4, 2, 2);
  }

  private createBuilding(
    type: string,
    name: string,
    gridX: number,
    gridY: number,
    width: number,
    height: number
  ): void {
    const screen = this.gridToScreen(gridX, gridY);
    const container = this.add.container(screen.x + (width * TILE_WIDTH / 4), screen.y);
    this.mapContainer.add(container);

    const graphics = this.add.graphics();
    container.add(graphics);

    // Mark grid as occupied
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        if (gridY + dy < GRID_SIZE && gridX + dx < GRID_SIZE) {
          this.grid[gridY + dy][gridX + dx].buildingId = type;
          this.grid[gridY + dy][gridX + dx].walkable = false;
        }
      }
    }

    // Draw building based on type
    this.drawBuildingGraphics(graphics, type, width, height);

    // Building label (hidden by default)
    const label = this.add.text(0, -60, name, {
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
    });
    label.setOrigin(0.5);
    label.setVisible(false);
    container.add(label);

    // Interactive
    const hitArea = new Phaser.Geom.Rectangle(-30, -50, 60, 70);
    container.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    container.on('pointerover', () => label.setVisible(true));
    container.on('pointerout', () => label.setVisible(false));
    container.on('pointerdown', () => this.onBuildingTap(type, name));

    // Depth sort
    container.setDepth(screen.y + (height * TILE_HEIGHT) + 200);

    const building: Building = {
      id: `${type}-${gridX}-${gridY}`,
      type, name, gridX, gridY, width, height, container,
    };
    this.buildings.push(building);

    this.updatePathfinderGrid();
  }

  private drawBuildingGraphics(
    graphics: Phaser.GameObjects.Graphics,
    type: string,
    width: number,
    height: number
  ): void {
    const w = width * 20;
    void height; // used for depth calculation elsewhere

    // Building style based on type
    let roofColor = PALETTE.roofRed;
    let wallColor = PALETTE.wallTan;
    let buildingHeight = 40;

    switch (type) {
      case 'inn':
        roofColor = PALETTE.roofBrown;
        wallColor = PALETTE.wallTan;
        buildingHeight = 50;
        break;
      case 'blacksmith':
        roofColor = PALETTE.roofRed;
        wallColor = PALETTE.wallBrown;
        buildingHeight = 35;
        break;
      case 'shop':
        roofColor = PALETTE.roofBlue;
        wallColor = PALETTE.wallWhite;
        buildingHeight = 35;
        break;
      case 'barracks':
        roofColor = PALETTE.roofRed;
        wallColor = PALETTE.wallBrown;
        buildingHeight = 45;
        break;
      case 'tower':
        roofColor = PALETTE.roofPurple;
        wallColor = PALETTE.wallTan;
        buildingHeight = 60;
        break;
      case 'house':
      case 'house2':
        roofColor = type === 'house' ? PALETTE.roofRed : PALETTE.roofBlue;
        wallColor = PALETTE.wallWhite;
        buildingHeight = 35;
        break;
    }

    // Front wall
    graphics.fillStyle(wallColor, 1);
    graphics.fillRect(-w/2, -buildingHeight, w, buildingHeight);

    // Side wall (darker)
    graphics.fillStyle(wallColor - 0x202020, 1);
    graphics.beginPath();
    graphics.moveTo(w/2, -buildingHeight);
    graphics.lineTo(w/2 + 15, -buildingHeight + 10);
    graphics.lineTo(w/2 + 15, 10);
    graphics.lineTo(w/2, 0);
    graphics.closePath();
    graphics.fill();

    // Roof
    graphics.fillStyle(roofColor, 1);
    graphics.beginPath();
    graphics.moveTo(-w/2 - 5, -buildingHeight);
    graphics.lineTo(0, -buildingHeight - 20);
    graphics.lineTo(w/2 + 5, -buildingHeight);
    graphics.closePath();
    graphics.fill();

    // Roof side
    graphics.fillStyle(roofColor - 0x202020, 1);
    graphics.beginPath();
    graphics.moveTo(w/2 + 5, -buildingHeight);
    graphics.lineTo(0, -buildingHeight - 20);
    graphics.lineTo(15, -buildingHeight - 10);
    graphics.lineTo(w/2 + 20, -buildingHeight + 10);
    graphics.closePath();
    graphics.fill();

    // Door
    graphics.fillStyle(PALETTE.woodDark, 1);
    graphics.fillRect(-5, -15, 10, 15);

    // Windows
    graphics.fillStyle(0x80c0ff, 1);
    if (width >= 2) {
      graphics.fillRect(-w/2 + 8, -buildingHeight + 10, 8, 8);
      graphics.fillRect(w/2 - 16, -buildingHeight + 10, 8, 8);
    }

    // Sign for inn/shop
    if (type === 'inn' || type === 'shop') {
      graphics.fillStyle(PALETTE.wood, 1);
      graphics.fillRect(-12, -buildingHeight - 5, 24, 12);
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(0, -buildingHeight + 1, 3);
    }
  }

  private createCharacters(): void {
    // Player's hero
    this.createCharacter('hero', 'Your Hero', 'hero', 12, 8);

    // Villagers
    this.createCharacter('villager1', 'Villager', 'villager', 8, 10);
    this.createCharacter('villager2', 'Merchant', 'villager', 15, 11);
  }

  private createCharacter(
    id: string,
    name: string,
    type: 'hero' | 'visitor' | 'villager',
    gridX: number,
    gridY: number
  ): Character {
    const screen = this.gridToScreen(gridX, gridY);
    const container = this.add.container(screen.x, screen.y - 10);
    this.mapContainer.add(container);

    const graphics = this.add.graphics();
    container.add(graphics);

    // Draw character
    this.drawCharacterGraphics(graphics, type);

    // Name label
    const label = this.add.text(0, -25, name, {
      fontSize: '8px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 2, y: 1 },
    });
    label.setOrigin(0.5);
    label.setVisible(false);
    container.add(label);

    // Interactive
    container.setInteractive(new Phaser.Geom.Circle(0, 0, 15), Phaser.Geom.Circle.Contains);
    container.on('pointerover', () => label.setVisible(true));
    container.on('pointerout', () => label.setVisible(false));
    container.on('pointerdown', () => this.onCharacterTap(id, name, type));

    // Idle bob animation
    this.tweens.add({
      targets: container,
      y: container.y - 2,
      duration: 800 + Math.random() * 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    container.setDepth(screen.y + 300);

    const character: Character = {
      id, name, type, gridX, gridY, container,
      path: [], pathIndex: 0, isMoving: false,
    };
    this.characters.push(character);

    return character;
  }

  private drawCharacterGraphics(graphics: Phaser.GameObjects.Graphics, type: string): void {
    // Shadow
    graphics.fillStyle(0x000000, 0.3);
    graphics.fillEllipse(0, 8, 12, 4);

    // Body color based on type
    let bodyColor = 0x4060c0; // Blue for hero
    if (type === 'visitor') bodyColor = 0x60a040; // Green
    if (type === 'villager') bodyColor = 0x806040; // Brown

    // Body
    graphics.fillStyle(bodyColor, 1);
    graphics.fillRect(-5, -5, 10, 12);

    // Head
    graphics.fillStyle(PALETTE.skinTone, 1);
    graphics.fillCircle(0, -10, 6);

    // Hair
    graphics.fillStyle(PALETTE.hair, 1);
    graphics.fillRect(-5, -15, 10, 5);

    // Eyes
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(-3, -11, 2, 2);
    graphics.fillRect(1, -11, 2, 2);
  }

  private spawnVisitor(): void {
    const id = `visitor-${Date.now()}`;
    const name = this.getRandomVisitorName();

    // Spawn at edge of map
    const spawnPoints = [
      { x: 11, y: 0 },
      { x: 12, y: 0 },
    ];
    const spawn = Phaser.Utils.Array.GetRandom(spawnPoints);

    const visitor = this.createCharacter(id, name, 'visitor', spawn.x, spawn.y);

    // Find path to inn
    const inn = this.buildings.find(b => b.type === 'inn');
    if (inn) {
      this.moveCharacterTo(visitor, inn.gridX + 1, inn.gridY + inn.height);
    }
  }

  private getRandomVisitorName(): string {
    const names = ['Traveler', 'Wanderer', 'Adventurer', 'Knight', 'Mage', 'Ranger', 'Bard'];
    return Phaser.Utils.Array.GetRandom(names);
  }

  private moveCharacterTo(character: Character, targetX: number, targetY: number): void {
    if (character.isMoving) return;

    this.pathfinder.findPath(
      character.gridX, character.gridY,
      targetX, targetY,
      (path) => {
        if (path && path.length > 1) {
          character.path = path;
          character.pathIndex = 1;
          character.isMoving = true;
          this.moveAlongPath(character);
        }
      }
    );
    this.pathfinder.calculate();
  }

  private moveAlongPath(character: Character): void {
    if (character.pathIndex >= character.path.length) {
      character.isMoving = false;
      return;
    }

    const next = character.path[character.pathIndex];
    const screen = this.gridToScreen(next.x, next.y);

    this.tweens.add({
      targets: character.container,
      x: screen.x,
      y: screen.y - 10,
      duration: 300,
      onComplete: () => {
        character.gridX = next.x;
        character.gridY = next.y;
        character.container.setDepth(screen.y + 300);
        character.pathIndex++;
        this.moveAlongPath(character);
      },
    });
  }

  private setupInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging && pointer.isDown) {
        const dx = pointer.x - this.dragStartX;
        const dy = pointer.y - this.dragStartY;

        this.cameraOffsetX += dx;
        this.cameraOffsetY += dy;

        // Clamp camera
        this.cameraOffsetX = Phaser.Math.Clamp(this.cameraOffsetX, -200, GAME_WIDTH + 200);
        this.cameraOffsetY = Phaser.Math.Clamp(this.cameraOffsetY, -100, GAME_HEIGHT);

        this.mapContainer.setPosition(this.cameraOffsetX, this.cameraOffsetY);

        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
      }
    });

    this.input.on('pointerup', () => {
      this.isDragging = false;
    });
  }

  private onBuildingTap(type: string, name: string): void {
    console.log('Building tapped:', type, name);
    this.events.emit('building-selected', { type, name });

    // Show info panel
    this.showInfoPanel(`${name}`, `Tap to enter the ${type}`);
  }

  private onCharacterTap(id: string, name: string, type: string): void {
    console.log('Character tapped:', id, name, type);
    this.events.emit('character-selected', { id, name, type });

    if (type === 'visitor') {
      this.showInfoPanel(name, 'A traveling adventurer. Recruit them?');
    } else if (type === 'hero') {
      this.showInfoPanel(name, 'Your loyal hero. View stats?');
    } else {
      this.showInfoPanel(name, 'A villager going about their day.');
    }
  }

  private showInfoPanel(title: string, description: string): void {
    // Remove existing panel
    const existing = this.children.getByName('infoPanel');
    if (existing) existing.destroy();

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 100);
    panel.setName('infoPanel');
    panel.setDepth(1000);

    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.95);
    bg.fillRoundedRect(-150, -40, 300, 80, 10);
    bg.lineStyle(2, 0x4060a0, 1);
    bg.strokeRoundedRect(-150, -40, 300, 80, 10);
    panel.add(bg);

    const titleText = this.add.text(0, -25, title, {
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    titleText.setOrigin(0.5);
    panel.add(titleText);

    const descText = this.add.text(0, 5, description, {
      fontSize: '12px',
      color: '#80a0c0',
    });
    descText.setOrigin(0.5);
    panel.add(descText);

    // Auto-hide after 3 seconds
    this.time.delayedCall(3000, () => panel.destroy());
  }

  private createUI(): void {
    // Header
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a1a2e, 0.95);
    headerBg.fillRect(0, 0, GAME_WIDTH, 50);
    headerBg.lineStyle(2, 0x4060a0, 1);
    headerBg.strokeRect(0, 0, GAME_WIDTH, 50);
    headerBg.setDepth(999);

    const title = this.add.text(GAME_WIDTH / 2, 25, 'YOUR KINGDOM', {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    title.setOrigin(0.5);
    title.setDepth(1000);

    // Back button
    const backBtn = this.add.text(15, 25, '< WORLD', {
      fontSize: '12px',
      color: '#4a90d9',
      fontFamily: 'monospace',
    });
    backBtn.setOrigin(0, 0.5);
    backBtn.setDepth(1000);
    backBtn.setInteractive();
    backBtn.on('pointerdown', () => this.scene.start('WorldScene'));
    backBtn.on('pointerover', () => backBtn.setColor('#80c0ff'));
    backBtn.on('pointerout', () => backBtn.setColor('#4a90d9'));

    // Build button
    const buildBtn = this.add.text(GAME_WIDTH - 15, 25, 'BUILD', {
      fontSize: '12px',
      color: '#40a040',
      fontFamily: 'monospace',
    });
    buildBtn.setOrigin(1, 0.5);
    buildBtn.setDepth(1000);
    buildBtn.setInteractive();
    buildBtn.on('pointerdown', () => this.showInfoPanel('Build Mode', 'Coming soon!'));
    buildBtn.on('pointerover', () => buildBtn.setColor('#80ff80'));
    buildBtn.on('pointerout', () => buildBtn.setColor('#40a040'));

    // Bottom nav
    const navBg = this.add.graphics();
    navBg.fillStyle(0x1a1a2e, 0.95);
    navBg.fillRect(0, GAME_HEIGHT - 60, GAME_WIDTH, 60);
    navBg.lineStyle(2, 0x4060a0, 1);
    navBg.strokeRect(0, GAME_HEIGHT - 60, GAME_WIDTH, 60);
    navBg.setDepth(999);

    // Nav buttons
    this.createNavButton(GAME_WIDTH / 4, GAME_HEIGHT - 30, 'WORLD', false, () => {
      this.scene.start('WorldScene');
    });
    this.createNavButton((GAME_WIDTH / 4) * 2, GAME_HEIGHT - 30, 'KINGDOM', true);
    this.createNavButton((GAME_WIDTH / 4) * 3, GAME_HEIGHT - 30, 'BATTLE', false, () => {
      this.scene.start('BattleScene');
    });
  }

  private createNavButton(x: number, y: number, label: string, active: boolean, callback?: () => void): void {
    const bg = this.add.graphics();
    bg.fillStyle(active ? 0x4060a0 : 0x303050, 1);
    bg.fillRoundedRect(x - 40, y - 12, 80, 24, 4);
    bg.setDepth(1000);

    const btn = this.add.text(x, y, label, {
      fontSize: '11px',
      color: active ? '#ffffff' : '#808090',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    btn.setOrigin(0.5);
    btn.setDepth(1001);

    if (callback) {
      bg.setInteractive(new Phaser.Geom.Rectangle(x - 40, y - 12, 80, 24), Phaser.Geom.Rectangle.Contains);
      bg.on('pointerdown', callback);
    }
  }

  private pseudoNoise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  update(): void {
    // Update character depths for proper sorting
    for (const char of this.characters) {
      const screen = this.gridToScreen(char.gridX, char.gridY);
      char.container.setDepth(screen.y + 300);
    }
  }
}
