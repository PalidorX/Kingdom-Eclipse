import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';

// HD-2D style tile dimensions (SNES JRPG / RPG Maker style)
const TILE_SIZE = 16;
const GRID_SIZE = 32; // 32x32 grid for the village

// SNES-inspired color palette
const PALETTE = {
  // Ground
  grass1: 0x4a8c38,
  grass2: 0x5a9c48,
  grass3: 0x3a7c28,
  path1: 0x9c8860,
  path2: 0x8c7850,
  path3: 0xac9870,
  dirt: 0x8a7050,

  // Water
  water1: 0x3868a8,
  water2: 0x4878b8,
  water3: 0x2858a8,

  // Buildings
  roofRed: 0xc84848,
  roofBlue: 0x4868c8,
  roofBrown: 0x886848,
  roofGreen: 0x488848,
  roofPurple: 0x885888,
  wallLight: 0xe8d8c8,
  wallMed: 0xc8b8a8,
  wallDark: 0xa89888,
  wood: 0x785838,
  woodDark: 0x583828,
  door: 0x684830,

  // Foliage
  tree1: 0x287828,
  tree2: 0x388838,
  tree3: 0x489848,
  treeTrunk: 0x684828,

  // Characters
  skin: 0xf8c8a8,
  hair: 0x483828,
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
  direction: 'down' | 'up' | 'left' | 'right';
}

export class KingdomScene extends Phaser.Scene {
  private grid: GridTile[][] = [];
  private buildings: Building[] = [];
  private characters: Character[] = [];
  private pathfinder!: EasyStar.js;
  private groundLayer!: Phaser.GameObjects.Container;
  private objectLayer!: Phaser.GameObjects.Container;
  private characterLayer!: Phaser.GameObjects.Container;
  private roofLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;

  // Camera/pan
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private cameraX = 0;
  private cameraY = 0;

  constructor() {
    super({ key: 'KingdomScene' });
  }

  create(): void {
    // Create layers for proper depth sorting (like SNES games)
    this.groundLayer = this.add.container(0, 0);
    this.objectLayer = this.add.container(0, 0);
    this.characterLayer = this.add.container(0, 0);
    this.roofLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    // Center view on map
    this.cameraX = GAME_WIDTH / 2 - (GRID_SIZE * TILE_SIZE) / 2;
    this.cameraY = 60;

    this.updateCameraPosition();

    this.initializeGrid();
    this.initializePathfinder();
    this.drawGround();
    this.createBuildings();
    this.createTrees();
    this.createCharacters();
    this.setupInput();
    this.createUI();

    // Spawn visitors periodically
    this.time.addEvent({
      delay: 10000,
      callback: () => this.spawnVisitor(),
      loop: true,
    });

    this.time.delayedCall(2000, () => this.spawnVisitor());
  }

  private updateCameraPosition(): void {
    this.groundLayer.setPosition(this.cameraX, this.cameraY);
    this.objectLayer.setPosition(this.cameraX, this.cameraY);
    this.characterLayer.setPosition(this.cameraX, this.cameraY);
    this.roofLayer.setPosition(this.cameraX, this.cameraY);
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
    this.createPaths();
    this.createWater();
  }

  private createPaths(): void {
    // Main horizontal road
    for (let x = 2; x < GRID_SIZE - 2; x++) {
      for (let y = 14; y <= 17; y++) {
        this.grid[y][x].type = 'path';
      }
    }

    // Main vertical road
    for (let y = 2; y < GRID_SIZE - 2; y++) {
      for (let x = 14; x <= 17; x++) {
        this.grid[y][x].type = 'path';
      }
    }

    // Side paths to buildings
    for (let x = 6; x <= 9; x++) {
      for (let y = 6; y <= 14; y++) {
        this.grid[y][x].type = 'path';
      }
    }
    for (let x = 22; x <= 25; x++) {
      for (let y = 6; y <= 14; y++) {
        this.grid[y][x].type = 'path';
      }
    }
    for (let x = 6; x <= 9; x++) {
      for (let y = 17; y <= 24; y++) {
        this.grid[y][x].type = 'path';
      }
    }
    for (let x = 22; x <= 25; x++) {
      for (let y = 17; y <= 24; y++) {
        this.grid[y][x].type = 'path';
      }
    }
  }

  private createWater(): void {
    // Pond in corner
    for (let y = 24; y <= 28; y++) {
      for (let x = 24; x <= 28; x++) {
        if (this.grid[y] && this.grid[y][x]) {
          this.grid[y][x].type = 'water';
          this.grid[y][x].walkable = false;
        }
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

  private drawGround(): void {
    const graphics = this.add.graphics();
    this.groundLayer.add(graphics);

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = this.grid[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        this.drawTile(graphics, px, py, tile.type, x, y);
      }
    }
  }

  private drawTile(
    graphics: Phaser.GameObjects.Graphics,
    px: number,
    py: number,
    type: string,
    gridX: number,
    gridY: number
  ): void {
    const noise = this.noise(gridX, gridY);

    let color: number;
    switch (type) {
      case 'path':
        color = noise > 0.6 ? PALETTE.path1 : noise > 0.3 ? PALETTE.path2 : PALETTE.path3;
        break;
      case 'water':
        const wave = (Math.sin(gridX * 0.8 + gridY * 0.6) + 1) / 2;
        color = wave > 0.6 ? PALETTE.water1 : wave > 0.3 ? PALETTE.water2 : PALETTE.water3;
        break;
      default:
        color = noise > 0.6 ? PALETTE.grass1 : noise > 0.3 ? PALETTE.grass2 : PALETTE.grass3;
    }

    graphics.fillStyle(color, 1);
    graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);

    // Add subtle texture for paths (cobblestone look)
    if (type === 'path') {
      graphics.fillStyle(PALETTE.path3, 0.3);
      const stoneNoise1 = this.noise(gridX * 3, gridY * 2);
      const stoneNoise2 = this.noise(gridX * 2, gridY * 3);
      if (stoneNoise1 > 0.5) {
        graphics.fillCircle(px + 4, py + 4, 2);
      }
      if (stoneNoise2 > 0.5) {
        graphics.fillCircle(px + 11, py + 10, 2);
      }
      // Stone lines
      graphics.lineStyle(1, PALETTE.path2, 0.2);
      graphics.strokeRect(px + 1, py + 1, 6, 6);
      graphics.strokeRect(px + 8, py + 8, 7, 7);
    }

    // Grass detail
    if (type === 'grass' && noise > 0.7) {
      graphics.fillStyle(PALETTE.grass3, 0.5);
      graphics.fillRect(px + 3, py + 2, 2, 3);
      graphics.fillRect(px + 10, py + 8, 2, 3);
    }
  }

  private createBuildings(): void {
    // Inn (large, center-ish)
    this.createBuilding('inn', 'The Golden Crown', 10, 4, 5, 4, PALETTE.roofBrown);

    // Blacksmith
    this.createBuilding('blacksmith', 'Iron Forge', 3, 5, 4, 3, PALETTE.roofRed);

    // Shop
    this.createBuilding('shop', 'General Store', 24, 5, 4, 3, PALETTE.roofBlue);

    // Barracks
    this.createBuilding('barracks', 'Barracks', 3, 19, 5, 4, PALETTE.roofRed);

    // Tower
    this.createBuilding('tower', 'Watch Tower', 26, 19, 3, 4, PALETTE.roofPurple);

    // Houses
    this.createBuilding('house1', 'Cottage', 19, 4, 3, 3, PALETTE.roofRed);
    this.createBuilding('house2', 'Manor', 10, 20, 4, 3, PALETTE.roofBlue);
    this.createBuilding('house3', 'Cabin', 17, 22, 3, 3, PALETTE.roofGreen);
  }

  private createBuilding(
    type: string,
    name: string,
    gridX: number,
    gridY: number,
    width: number,
    height: number,
    roofColor: number
  ): void {
    const px = gridX * TILE_SIZE;
    const py = gridY * TILE_SIZE;
    const pxW = width * TILE_SIZE;
    const pxH = height * TILE_SIZE;

    // Mark grid as occupied
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        if (this.grid[gridY + dy] && this.grid[gridY + dy][gridX + dx]) {
          this.grid[gridY + dy][gridX + dx].buildingId = type;
          this.grid[gridY + dy][gridX + dx].walkable = false;
        }
      }
    }

    const container = this.add.container(px, py);
    this.objectLayer.add(container);

    const graphics = this.add.graphics();
    container.add(graphics);

    // Building shadow (depth illusion)
    graphics.fillStyle(0x000000, 0.2);
    graphics.fillRect(4, 4, pxW, pxH);

    // Wall base (3/4 view - we see front and side)
    graphics.fillStyle(PALETTE.wallLight, 1);
    graphics.fillRect(0, 6, pxW, pxH - 6);

    // Wall shadow for depth
    graphics.fillStyle(PALETTE.wallDark, 1);
    graphics.fillRect(0, 6, 4, pxH - 6); // Left edge darker

    // Right wall darker (3/4 view perspective)
    graphics.fillStyle(PALETTE.wallMed, 1);
    graphics.fillRect(pxW - 4, 6, 4, pxH - 6);

    // Roof (HD-2D style - visible top with slight angle)
    graphics.fillStyle(roofColor, 1);
    graphics.fillRect(-2, -4, pxW + 4, 12);

    // Roof highlight
    graphics.fillStyle(roofColor + 0x202020, 1);
    graphics.fillRect(0, -2, pxW, 4);

    // Roof shadow line
    graphics.fillStyle(roofColor - 0x202020, 1);
    graphics.fillRect(-2, 6, pxW + 4, 2);

    // Door (centered at bottom)
    const doorX = (pxW - 10) / 2;
    const doorY = pxH - 14;
    graphics.fillStyle(PALETTE.door, 1);
    graphics.fillRect(doorX, doorY, 10, 14);
    graphics.fillStyle(PALETTE.woodDark, 1);
    graphics.fillRect(doorX, doorY, 10, 2);
    // Door handle
    graphics.fillStyle(0xc8a838, 1);
    graphics.fillCircle(doorX + 8, doorY + 8, 1);

    // Windows
    const windowColor = 0x88b8e8;
    const windowShine = 0xa8d8ff;
    if (width >= 3) {
      // Left window
      graphics.fillStyle(windowColor, 1);
      graphics.fillRect(8, 14, 8, 8);
      graphics.fillStyle(windowShine, 0.5);
      graphics.fillRect(9, 15, 3, 3);
      // Window frame
      graphics.lineStyle(1, PALETTE.wood, 1);
      graphics.strokeRect(8, 14, 8, 8);
      graphics.lineBetween(12, 14, 12, 22);
      graphics.lineBetween(8, 18, 16, 18);

      // Right window
      graphics.fillStyle(windowColor, 1);
      graphics.fillRect(pxW - 16, 14, 8, 8);
      graphics.fillStyle(windowShine, 0.5);
      graphics.fillRect(pxW - 15, 15, 3, 3);
      graphics.lineStyle(1, PALETTE.wood, 1);
      graphics.strokeRect(pxW - 16, 14, 8, 8);
      graphics.lineBetween(pxW - 12, 14, pxW - 12, 22);
      graphics.lineBetween(pxW - 16, 18, pxW - 8, 18);
    }

    // Building sign for shops
    if (type === 'inn' || type === 'shop' || type === 'blacksmith') {
      graphics.fillStyle(PALETTE.wood, 1);
      graphics.fillRect(pxW / 2 - 12, -8, 24, 8);
      graphics.fillStyle(0xf8f8e8, 1);
      graphics.fillCircle(pxW / 2, -4, 2);
    }

    // Name label (hidden by default)
    const label = this.add.text(pxW / 2, -16, name, {
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#000000cc',
      padding: { x: 4, y: 2 },
    });
    label.setOrigin(0.5);
    label.setVisible(false);
    container.add(label);

    // Interactive area
    container.setSize(pxW, pxH);
    container.setInteractive();
    container.on('pointerover', () => label.setVisible(true));
    container.on('pointerout', () => label.setVisible(false));
    container.on('pointerdown', () => this.onBuildingTap(type, name));

    // Depth based on Y (lower = in front)
    container.setDepth(py + pxH);

    const building: Building = {
      id: `${type}-${gridX}-${gridY}`,
      type, name, gridX, gridY, width, height, container,
    };
    this.buildings.push(building);

    this.updatePathfinderGrid();
  }

  private createTrees(): void {
    // Place trees on grass tiles that aren't paths or buildings
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = this.grid[y][x];
        if (tile.type === 'grass' && tile.buildingId === null) {
          const n = this.noise(x * 7, y * 11);
          if (n > 0.78) {
            this.createTree(x, y);
          }
        }
      }
    }
  }

  private createTree(gridX: number, gridY: number): void {
    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE;

    const container = this.add.container(px, py);
    this.objectLayer.add(container);

    const graphics = this.add.graphics();
    container.add(graphics);

    const treeVariation = this.noise(gridX * 13, gridY * 17);

    // Tree shadow
    graphics.fillStyle(0x000000, 0.2);
    graphics.fillEllipse(2, 2, 12, 6);

    // Trunk
    graphics.fillStyle(PALETTE.treeTrunk, 1);
    graphics.fillRect(-2, -12, 4, 14);

    // Foliage (layered circles for HD-2D depth)
    const baseColor = treeVariation > 0.5 ? PALETTE.tree1 : PALETTE.tree2;

    // Back layer
    graphics.fillStyle(baseColor - 0x101010, 1);
    graphics.fillCircle(0, -18, 10);

    // Middle layer
    graphics.fillStyle(baseColor, 1);
    graphics.fillCircle(-4, -14, 8);
    graphics.fillCircle(4, -14, 8);

    // Front layer (highlight)
    graphics.fillStyle(PALETTE.tree3, 1);
    graphics.fillCircle(-2, -16, 5);

    // Mark as unwalkable
    this.grid[gridY][gridX].walkable = false;

    container.setDepth(py);
  }

  private createCharacters(): void {
    // Player's hero (blue outfit)
    this.createCharacter('hero', 'Your Hero', 'hero', 15, 15);

    // Villagers (brown outfits)
    this.createCharacter('villager1', 'Farmer', 'villager', 12, 12);
    this.createCharacter('villager2', 'Merchant', 'villager', 18, 16);
    this.createCharacter('villager3', 'Guard', 'villager', 8, 8);
  }

  private createCharacter(
    id: string,
    name: string,
    type: 'hero' | 'visitor' | 'villager',
    gridX: number,
    gridY: number
  ): Character {
    const px = gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = gridY * TILE_SIZE + TILE_SIZE;

    const container = this.add.container(px, py);
    this.characterLayer.add(container);

    const graphics = this.add.graphics();
    container.add(graphics);

    this.drawCharacter(graphics, type, 'down');

    // Name label
    const label = this.add.text(0, -24, name, {
      fontSize: '8px',
      color: '#ffffff',
      backgroundColor: '#000000cc',
      padding: { x: 2, y: 1 },
    });
    label.setOrigin(0.5);
    label.setVisible(false);
    container.add(label);

    // Interactive
    container.setSize(16, 20);
    container.setInteractive();
    container.on('pointerover', () => label.setVisible(true));
    container.on('pointerout', () => label.setVisible(false));
    container.on('pointerdown', () => this.onCharacterTap(id, name, type));

    // Idle animation
    this.tweens.add({
      targets: container,
      y: py - 1,
      duration: 600 + Math.random() * 200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    container.setDepth(py);

    const character: Character = {
      id, name, type, gridX, gridY, container,
      path: [], pathIndex: 0, isMoving: false, direction: 'down',
    };
    this.characters.push(character);

    // Make villagers wander
    if (type === 'villager') {
      this.time.addEvent({
        delay: 5000 + Math.random() * 5000,
        callback: () => this.wanderCharacter(character),
        loop: true,
      });
    }

    return character;
  }

  private drawCharacter(
    graphics: Phaser.GameObjects.Graphics,
    type: string,
    direction: string
  ): void {
    graphics.clear();

    // Shadow
    graphics.fillStyle(0x000000, 0.3);
    graphics.fillEllipse(0, 2, 10, 4);

    // Body color
    let bodyColor = 0x4868c8; // Blue for hero
    let bodyHighlight = 0x6888e8;
    if (type === 'visitor') {
      bodyColor = 0x48a848;
      bodyHighlight = 0x68c868;
    }
    if (type === 'villager') {
      bodyColor = 0x886848;
      bodyHighlight = 0xa88868;
    }

    // Body (tunic)
    graphics.fillStyle(bodyColor, 1);
    graphics.fillRect(-5, -8, 10, 10);

    // Body highlight
    graphics.fillStyle(bodyHighlight, 1);
    graphics.fillRect(-4, -7, 3, 4);

    // Arms
    graphics.fillStyle(bodyColor, 1);
    graphics.fillRect(-7, -6, 3, 6);
    graphics.fillRect(4, -6, 3, 6);

    // Head
    graphics.fillStyle(PALETTE.skin, 1);
    graphics.fillCircle(0, -12, 5);

    // Hair (different based on direction)
    graphics.fillStyle(PALETTE.hair, 1);
    if (direction === 'down') {
      graphics.fillRect(-4, -16, 8, 4);
    } else if (direction === 'up') {
      graphics.fillRect(-4, -17, 8, 6);
    } else {
      graphics.fillRect(-4, -16, 8, 4);
      graphics.fillRect(direction === 'left' ? -5 : 3, -14, 3, 4);
    }

    // Eyes (only visible from front/side)
    if (direction !== 'up') {
      graphics.fillStyle(0x000000, 1);
      if (direction === 'down') {
        graphics.fillRect(-2, -13, 2, 2);
        graphics.fillRect(1, -13, 2, 2);
      } else if (direction === 'left') {
        graphics.fillRect(-3, -13, 2, 2);
      } else if (direction === 'right') {
        graphics.fillRect(1, -13, 2, 2);
      }
    }

    // Feet
    graphics.fillStyle(0x483828, 1);
    graphics.fillRect(-4, 0, 3, 2);
    graphics.fillRect(1, 0, 3, 2);
  }

  private wanderCharacter(character: Character): void {
    if (character.isMoving) return;

    const dx = Math.floor(Math.random() * 7) - 3;
    const dy = Math.floor(Math.random() * 7) - 3;
    const newX = Phaser.Math.Clamp(character.gridX + dx, 2, GRID_SIZE - 3);
    const newY = Phaser.Math.Clamp(character.gridY + dy, 2, GRID_SIZE - 3);

    if (this.grid[newY] && this.grid[newY][newX] && this.grid[newY][newX].walkable) {
      this.moveCharacterTo(character, newX, newY);
    }
  }

  private spawnVisitor(): void {
    const id = `visitor-${Date.now()}`;
    const names = ['Traveler', 'Wanderer', 'Knight', 'Mage', 'Ranger', 'Bard', 'Merchant'];
    const name = Phaser.Utils.Array.GetRandom(names);

    // Spawn at road entrance
    const spawn = { x: 15, y: 1 };
    const visitor = this.createCharacter(id, name, 'visitor', spawn.x, spawn.y);

    // Path to inn
    const inn = this.buildings.find(b => b.type === 'inn');
    if (inn) {
      this.time.delayedCall(500, () => {
        this.moveCharacterTo(visitor, inn.gridX + 2, inn.gridY + inn.height + 1);
      });
    }
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
    const px = next.x * TILE_SIZE + TILE_SIZE / 2;
    const py = next.y * TILE_SIZE + TILE_SIZE;

    // Update direction
    const dx = next.x - character.gridX;
    const dy = next.y - character.gridY;
    if (Math.abs(dx) > Math.abs(dy)) {
      character.direction = dx > 0 ? 'right' : 'left';
    } else {
      character.direction = dy > 0 ? 'down' : 'up';
    }

    // Redraw character facing new direction
    const graphics = character.container.getAt(0) as Phaser.GameObjects.Graphics;
    this.drawCharacter(graphics, character.type, character.direction);

    this.tweens.add({
      targets: character.container,
      x: px,
      y: py,
      duration: 200,
      onComplete: () => {
        character.gridX = next.x;
        character.gridY = next.y;
        character.container.setDepth(py);
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

        this.cameraX += dx;
        this.cameraY += dy;

        // Clamp camera
        const mapWidth = GRID_SIZE * TILE_SIZE;
        const mapHeight = GRID_SIZE * TILE_SIZE;
        this.cameraX = Phaser.Math.Clamp(this.cameraX, -mapWidth + 100, GAME_WIDTH - 100);
        this.cameraY = Phaser.Math.Clamp(this.cameraY, -mapHeight + 150, GAME_HEIGHT - 100);

        this.updateCameraPosition();

        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
      }
    });

    this.input.on('pointerup', () => {
      this.isDragging = false;
    });
  }

  private onBuildingTap(type: string, name: string): void {
    this.events.emit('building-selected', { type, name });
    this.showInfoPanel(name, `Tap to enter the ${type}`);
  }

  private onCharacterTap(id: string, name: string, type: string): void {
    this.events.emit('character-selected', { id, name, type });

    if (type === 'visitor') {
      this.showInfoPanel(name, 'A traveling adventurer seeking glory!');
    } else if (type === 'hero') {
      this.showInfoPanel(name, 'Your loyal champion.');
    } else {
      this.showInfoPanel(name, 'A villager of the kingdom.');
    }
  }

  private showInfoPanel(title: string, description: string): void {
    const existing = this.uiLayer.getByName('infoPanel');
    if (existing) existing.destroy();

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 100);
    panel.setName('infoPanel');
    this.uiLayer.add(panel);

    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.95);
    bg.fillRoundedRect(-140, -35, 280, 70, 8);
    bg.lineStyle(2, 0x4868a8, 1);
    bg.strokeRoundedRect(-140, -35, 280, 70, 8);
    panel.add(bg);

    const titleText = this.add.text(0, -18, title, {
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    titleText.setOrigin(0.5);
    panel.add(titleText);

    const descText = this.add.text(0, 6, description, {
      fontSize: '11px',
      color: '#88a8c8',
    });
    descText.setOrigin(0.5);
    panel.add(descText);

    this.time.delayedCall(3000, () => panel.destroy());
  }

  private createUI(): void {
    // Header
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a1a2e, 0.95);
    headerBg.fillRect(0, 0, GAME_WIDTH, 50);
    headerBg.lineStyle(2, 0x4868a8, 1);
    headerBg.lineBetween(0, 50, GAME_WIDTH, 50);
    this.uiLayer.add(headerBg);

    const title = this.add.text(GAME_WIDTH / 2, 25, 'YOUR KINGDOM', {
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    title.setOrigin(0.5);
    this.uiLayer.add(title);

    // Back button
    const backBtn = this.add.text(15, 25, '< WORLD', {
      fontSize: '11px',
      color: '#4888d8',
      fontFamily: 'monospace',
    });
    backBtn.setOrigin(0, 0.5);
    backBtn.setInteractive();
    backBtn.on('pointerdown', () => this.scene.start('WorldScene'));
    backBtn.on('pointerover', () => backBtn.setColor('#88c8ff'));
    backBtn.on('pointerout', () => backBtn.setColor('#4888d8'));
    this.uiLayer.add(backBtn);

    // Build button
    const buildBtn = this.add.text(GAME_WIDTH - 15, 25, 'BUILD', {
      fontSize: '11px',
      color: '#48a848',
      fontFamily: 'monospace',
    });
    buildBtn.setOrigin(1, 0.5);
    buildBtn.setInteractive();
    buildBtn.on('pointerdown', () => this.showInfoPanel('Build Mode', 'Coming soon!'));
    buildBtn.on('pointerover', () => buildBtn.setColor('#88e888'));
    buildBtn.on('pointerout', () => buildBtn.setColor('#48a848'));
    this.uiLayer.add(buildBtn);

    // Bottom nav
    const navBg = this.add.graphics();
    navBg.fillStyle(0x1a1a2e, 0.95);
    navBg.fillRect(0, GAME_HEIGHT - 55, GAME_WIDTH, 55);
    navBg.lineStyle(2, 0x4868a8, 1);
    navBg.lineBetween(0, GAME_HEIGHT - 55, GAME_WIDTH, GAME_HEIGHT - 55);
    this.uiLayer.add(navBg);

    this.createNavButton(GAME_WIDTH / 4, GAME_HEIGHT - 28, 'WORLD', false, () => {
      this.scene.start('WorldScene');
    });
    this.createNavButton((GAME_WIDTH / 4) * 2, GAME_HEIGHT - 28, 'KINGDOM', true);
    this.createNavButton((GAME_WIDTH / 4) * 3, GAME_HEIGHT - 28, 'BATTLE', false, () => {
      this.scene.start('BattleScene');
    });
  }

  private createNavButton(
    x: number, y: number, label: string, active: boolean, callback?: () => void
  ): void {
    const bg = this.add.graphics();
    bg.fillStyle(active ? 0x4868a8 : 0x303048, 1);
    bg.fillRoundedRect(x - 38, y - 11, 76, 22, 4);
    this.uiLayer.add(bg);

    const btn = this.add.text(x, y, label, {
      fontSize: '10px',
      color: active ? '#ffffff' : '#686878',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    btn.setOrigin(0.5);
    this.uiLayer.add(btn);

    if (callback) {
      bg.setInteractive(new Phaser.Geom.Rectangle(x - 38, y - 11, 76, 22), Phaser.Geom.Rectangle.Contains);
      bg.on('pointerdown', callback);
    }
  }

  private noise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  update(): void {
    // Update character depths for proper Y-sorting
    for (const char of this.characters) {
      const py = char.gridY * TILE_SIZE + TILE_SIZE;
      char.container.setDepth(py);
    }
  }
}
