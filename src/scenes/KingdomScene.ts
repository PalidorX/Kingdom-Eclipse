import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';
import { CharacterManager } from '../rendering/CharacterManager';
import { CharacterTeam } from '../rendering/Character3D';

// RPG Maker style - 32x32 tiles, characters are 2 tiles tall
const TILE_SIZE = 32;
const GRID_COLS = Math.ceil(GAME_WIDTH / TILE_SIZE) + 4;
const GRID_ROWS = Math.ceil(GAME_HEIGHT / TILE_SIZE) + 4;

// RPG Maker style color palette
const PALETTE = {
  // Grass
  grass1: 0x5cb85c,
  grass2: 0x4ca84c,
  grass3: 0x6cc86c,
  grassDark: 0x3c983c,

  // Dirt/Path
  path1: 0xc4a574,
  path2: 0xb49564,
  path3: 0xd4b584,
  pathEdge: 0xa48554,

  // Water
  water1: 0x4488cc,
  water2: 0x5498dc,
  water3: 0x3478bc,

  // Buildings
  roofRed: 0xcc4444,
  roofBlue: 0x4466cc,
  roofGreen: 0x44aa44,
  roofBrown: 0x886644,
  wallLight: 0xf0e8d8,
  wallMed: 0xd8d0c0,
  wallDark: 0xb8b0a0,
  wood: 0x8b6914,
  woodDark: 0x5b4904,
  door: 0x6b4914,
  window: 0x88ccff,
  windowShine: 0xaaeeff,

  // Trees
  treeTrunk: 0x6b4423,
  treeLeaf1: 0x228b22,
  treeLeaf2: 0x2e8b2e,
  treeLeaf3: 0x3c9b3c,
  treeHighlight: 0x4cbb4c,
  treeShadow: 0x1a6b1a,

  // Characters
  skin: 0xffd8b8,
  skinShadow: 0xe8c8a8,
  hair: 0x4a3728,
  hairLight: 0x5a4738,
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
  level: number;
  container: Phaser.GameObjects.Container;
}

interface Character {
  id: string;
  name: string;
  type: 'hero' | 'visitor' | 'villager';
  gridX: number;
  gridY: number;
  labelContainer: Phaser.GameObjects.Container; // For name label only
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
  private uiLayer!: Phaser.GameObjects.Container;
  private infoPanel: Phaser.GameObjects.Container | null = null;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private cameraX = 0;
  private cameraY = 0;

  // 3D Character rendering
  private characterManager!: CharacterManager;

  constructor() {
    super({ key: 'KingdomScene' });
  }

  create(): void {
    // Initialize 3D character manager
    this.characterManager = new CharacterManager();

    this.groundLayer = this.add.container(0, 0);
    this.objectLayer = this.add.container(0, 0);
    this.characterLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    this.cameraX = GAME_WIDTH / 2 - (GRID_COLS * TILE_SIZE) / 2;
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

    this.time.addEvent({
      delay: 12000,
      callback: () => this.spawnVisitor(),
      loop: true,
    });

    this.time.delayedCall(2000, () => this.spawnVisitor());
  }

  shutdown(): void {
    // Clean up 3D resources when scene shuts down
    if (this.characterManager) {
      this.characterManager.clear();
    }
  }

  private updateCameraPosition(): void {
    this.groundLayer.setPosition(this.cameraX, this.cameraY);
    this.objectLayer.setPosition(this.cameraX, this.cameraY);
    this.characterLayer.setPosition(this.cameraX, this.cameraY);

    // Sync 3D character positions with camera offset
    if (this.characterManager) {
      this.characterManager.setCameraOffset(this.cameraX, this.cameraY);
    }
  }

  private initializeGrid(): void {
    this.grid = [];
    for (let y = 0; y < GRID_ROWS; y++) {
      this.grid[y] = [];
      for (let x = 0; x < GRID_COLS; x++) {
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
    for (let x = 1; x < GRID_COLS - 1; x++) {
      for (let y = 8; y <= 10; y++) {
        if (this.grid[y]) this.grid[y][x].type = 'path';
      }
    }
    // Main vertical road
    for (let y = 1; y < GRID_ROWS - 1; y++) {
      for (let x = 6; x <= 8; x++) {
        if (this.grid[y] && this.grid[y][x]) this.grid[y][x].type = 'path';
      }
    }
    // Side paths
    for (let x = 2; x <= 5; x++) {
      for (let y = 4; y <= 5; y++) {
        if (this.grid[y]) this.grid[y][x].type = 'path';
      }
    }
    for (let x = 9; x <= 12; x++) {
      for (let y = 4; y <= 5; y++) {
        if (this.grid[y]) this.grid[y][x].type = 'path';
      }
    }
  }

  private createWater(): void {
    for (let y = 14; y <= 16; y++) {
      for (let x = 10; x <= 13; x++) {
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
    for (let y = 0; y < GRID_ROWS; y++) {
      walkableGrid[y] = [];
      for (let x = 0; x < GRID_COLS; x++) {
        walkableGrid[y][x] = this.grid[y]?.[x]?.walkable ? 0 : 1;
      }
    }
    this.pathfinder.setGrid(walkableGrid);
    this.pathfinder.setAcceptableTiles([0]);
    this.pathfinder.enableDiagonals();
  }

  private drawGround(): void {
    const graphics = this.add.graphics();
    this.groundLayer.add(graphics);

    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        const tile = this.grid[y]?.[x];
        if (tile) {
          const px = x * TILE_SIZE;
          const py = y * TILE_SIZE;
          this.drawTile(graphics, px, py, tile.type, x, y);
        }
      }
    }
  }

  private drawTile(
    graphics: Phaser.GameObjects.Graphics,
    px: number, py: number,
    type: string,
    gridX: number, gridY: number
  ): void {
    const s = TILE_SIZE;
    const noise = this.noise(gridX, gridY);

    switch (type) {
      case 'grass':
        this.drawGrassTile(graphics, px, py, s, noise, gridX, gridY);
        break;
      case 'path':
        this.drawPathTile(graphics, px, py, s, noise, gridX, gridY);
        break;
      case 'water':
        this.drawWaterTile(graphics, px, py, s, gridX, gridY);
        break;
    }
  }

  private drawGrassTile(
    graphics: Phaser.GameObjects.Graphics,
    px: number, py: number, s: number,
    noise: number, gridX: number, gridY: number
  ): void {
    // Base grass color with variation
    const baseColor = noise > 0.6 ? PALETTE.grass1 : noise > 0.3 ? PALETTE.grass2 : PALETTE.grass3;
    graphics.fillStyle(baseColor, 1);
    graphics.fillRect(px, py, s, s);

    // Grass texture pattern (diagonal lines like RPG Maker)
    graphics.fillStyle(PALETTE.grassDark, 0.15);
    for (let i = 0; i < 4; i++) {
      const ox = (gridX * 7 + gridY * 3 + i * 8) % s;
      const oy = (gridY * 11 + i * 9) % s;
      graphics.fillRect(px + ox, py + oy, 2, 2);
    }

    // Random grass tufts
    if (noise > 0.75) {
      graphics.fillStyle(PALETTE.grass3, 0.6);
      graphics.fillRect(px + 8, py + 12, 3, 6);
      graphics.fillRect(px + 12, py + 10, 2, 8);
      graphics.fillRect(px + 20, py + 14, 3, 5);
    }

    // Occasional flowers
    const flowerNoise = this.noise(gridX * 5, gridY * 7);
    if (flowerNoise > 0.88) {
      graphics.fillStyle(0xff6090, 1);
      graphics.fillCircle(px + 10, py + 20, 3);
      graphics.fillStyle(0xffff60, 1);
      graphics.fillCircle(px + 22, py + 8, 2);
    }
  }

  private drawPathTile(
    graphics: Phaser.GameObjects.Graphics,
    px: number, py: number, s: number,
    noise: number, gridX: number, gridY: number
  ): void {
    // Base path color
    const baseColor = noise > 0.5 ? PALETTE.path1 : PALETTE.path2;
    graphics.fillStyle(baseColor, 1);
    graphics.fillRect(px, py, s, s);

    // Path texture (stone/dirt variation)
    graphics.fillStyle(PALETTE.path3, 0.4);
    const stonePattern = [
      { x: 4, y: 4, w: 8, h: 6 },
      { x: 16, y: 8, w: 10, h: 7 },
      { x: 6, y: 18, w: 9, h: 8 },
      { x: 20, y: 20, w: 7, h: 6 },
    ];
    stonePattern.forEach((stone, i) => {
      const ox = (stone.x + gridX * 3 + i) % 24;
      const oy = (stone.y + gridY * 5) % 24;
      graphics.fillRoundedRect(px + ox, py + oy, stone.w, stone.h, 2);
    });

    // Dark gaps between stones
    graphics.fillStyle(PALETTE.pathEdge, 0.3);
    graphics.fillRect(px + 12, py + 2, 1, 10);
    graphics.fillRect(px + 3, py + 14, 12, 1);
    graphics.fillRect(px + 18, py + 16, 1, 8);

    // Check for edges and draw borders
    const hasN = this.grid[gridY - 1]?.[gridX]?.type !== 'path';
    const hasS = this.grid[gridY + 1]?.[gridX]?.type !== 'path';
    const hasW = this.grid[gridY]?.[gridX - 1]?.type !== 'path';
    const hasE = this.grid[gridY]?.[gridX + 1]?.type !== 'path';

    graphics.fillStyle(PALETTE.pathEdge, 0.5);
    if (hasN) graphics.fillRect(px, py, s, 3);
    if (hasS) graphics.fillRect(px, py + s - 3, s, 3);
    if (hasW) graphics.fillRect(px, py, 3, s);
    if (hasE) graphics.fillRect(px + s - 3, py, 3, s);
  }

  private drawWaterTile(
    graphics: Phaser.GameObjects.Graphics,
    px: number, py: number, s: number,
    gridX: number, gridY: number
  ): void {
    const wave = (Math.sin(gridX * 0.8 + gridY * 0.6) + 1) / 2;
    const baseColor = wave > 0.5 ? PALETTE.water1 : PALETTE.water2;
    graphics.fillStyle(baseColor, 1);
    graphics.fillRect(px, py, s, s);

    // Wave highlights
    graphics.fillStyle(PALETTE.water3, 0.4);
    const waveY = ((gridX + gridY) * 7) % 16;
    graphics.fillRect(px + 4, py + waveY, 24, 3);

    // Shine
    graphics.fillStyle(0xffffff, 0.15);
    graphics.fillRect(px + 8, py + 6, 6, 2);
    graphics.fillRect(px + 18, py + 18, 8, 2);
  }

  private createBuildings(): void {
    // Buildings are placed in tile coordinates
    // Size is in tiles (width x height)
    this.createBuilding('inn', 'The Golden Crown', 2, 1, 3, 3, PALETTE.roofBrown, 1);
    this.createBuilding('blacksmith', 'Iron Forge', 9, 1, 3, 2, PALETTE.roofRed, 1);
    this.createBuilding('shop', 'General Store', 1, 11, 2, 2, PALETTE.roofBlue, 1);
    this.createBuilding('house1', 'Cottage', 9, 11, 2, 2, PALETTE.roofRed, 1);
    this.createBuilding('house2', 'Manor', 12, 5, 2, 3, PALETTE.roofBlue, 1);
    this.createBuilding('house3', 'Cabin', 1, 5, 2, 2, PALETTE.roofGreen, 1);
  }

  private createBuilding(
    type: string,
    name: string,
    gridX: number,
    gridY: number,
    width: number,
    height: number,
    roofColor: number,
    level: number
  ): void {
    const px = gridX * TILE_SIZE;
    const py = gridY * TILE_SIZE;
    const pxW = width * TILE_SIZE;
    const pxH = height * TILE_SIZE;

    // Mark grid as occupied
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        if (this.grid[gridY + dy]?.[gridX + dx]) {
          this.grid[gridY + dy][gridX + dx].buildingId = type;
          this.grid[gridY + dy][gridX + dx].walkable = false;
          this.grid[gridY + dy][gridX + dx].type = 'building';
        }
      }
    }

    const container = this.add.container(px, py);
    this.objectLayer.add(container);

    const graphics = this.add.graphics();
    container.add(graphics);

    // Building shadow
    graphics.fillStyle(0x000000, 0.2);
    graphics.fillRect(4, 8, pxW, pxH - 4);

    // Main wall
    graphics.fillStyle(PALETTE.wallLight, 1);
    graphics.fillRect(0, pxH * 0.3, pxW, pxH * 0.7);

    // Wall shading (left darker, right lighter)
    graphics.fillStyle(PALETTE.wallDark, 1);
    graphics.fillRect(0, pxH * 0.3, 4, pxH * 0.7);
    graphics.fillStyle(PALETTE.wallMed, 1);
    graphics.fillRect(pxW - 4, pxH * 0.3, 4, pxH * 0.7);

    // Roof
    graphics.fillStyle(roofColor, 1);
    graphics.fillRect(-4, 0, pxW + 8, pxH * 0.35);
    // Roof highlight
    graphics.fillStyle(roofColor + 0x202020, 1);
    graphics.fillRect(0, 4, pxW, 8);
    // Roof shadow
    graphics.fillStyle(roofColor - 0x202020, 1);
    graphics.fillRect(-4, pxH * 0.3, pxW + 8, 4);

    // Door
    const doorW = 16;
    const doorH = 24;
    const doorX = (pxW - doorW) / 2;
    const doorY = pxH - doorH;
    graphics.fillStyle(PALETTE.door, 1);
    graphics.fillRect(doorX, doorY, doorW, doorH);
    graphics.fillStyle(PALETTE.woodDark, 1);
    graphics.fillRect(doorX, doorY, doorW, 3);
    graphics.fillRect(doorX + doorW / 2 - 1, doorY, 2, doorH);
    // Door handle
    graphics.fillStyle(0xdaa520, 1);
    graphics.fillCircle(doorX + doorW - 5, doorY + doorH / 2, 2);

    // Windows (32x32 style)
    if (width >= 2) {
      this.drawWindow(graphics, 8, pxH * 0.4);
      if (width >= 3) {
        this.drawWindow(graphics, pxW - 24, pxH * 0.4);
      }
    }

    // Name label
    const label = this.add.text(pxW / 2, -8, name, {
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#000000cc',
      padding: { x: 4, y: 2 },
    });
    label.setOrigin(0.5, 1);
    label.setVisible(false);
    container.add(label);

    container.setSize(pxW, pxH);
    container.setInteractive();
    container.on('pointerover', () => label.setVisible(true));
    container.on('pointerout', () => label.setVisible(false));
    container.on('pointerdown', () => this.showBuildingInfo(type, name, level));

    container.setDepth(py + pxH);

    const building: Building = {
      id: `${type}-${gridX}-${gridY}`,
      type, name, gridX, gridY, width, height, level, container,
    };
    this.buildings.push(building);
    this.updatePathfinderGrid();
  }

  private drawWindow(graphics: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const w = 16;
    const h = 16;
    // Window frame
    graphics.fillStyle(PALETTE.wood, 1);
    graphics.fillRect(x - 2, y - 2, w + 4, h + 4);
    // Window glass
    graphics.fillStyle(PALETTE.window, 1);
    graphics.fillRect(x, y, w, h);
    // Window shine
    graphics.fillStyle(PALETTE.windowShine, 0.6);
    graphics.fillRect(x + 2, y + 2, 5, 4);
    // Window cross
    graphics.fillStyle(PALETTE.wood, 1);
    graphics.fillRect(x + w / 2 - 1, y, 2, h);
    graphics.fillRect(x, y + h / 2 - 1, w, 2);
  }

  private createTrees(): void {
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        const tile = this.grid[y]?.[x];
        if (tile?.type === 'grass' && !tile.buildingId) {
          const n = this.noise(x * 7, y * 11);
          if (n > 0.82) {
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

    // Shadow
    graphics.fillStyle(0x000000, 0.25);
    graphics.fillEllipse(0, 4, 28, 10);

    // Trunk (visible below foliage)
    graphics.fillStyle(PALETTE.treeTrunk, 1);
    graphics.fillRect(-4, -20, 8, 24);
    graphics.fillStyle(PALETTE.woodDark, 1);
    graphics.fillRect(-4, -20, 3, 24);

    // Foliage layers (2 tiles tall = 64px of foliage)
    // Bottom layer
    graphics.fillStyle(PALETTE.treeShadow, 1);
    graphics.fillCircle(0, -24, 18);

    // Middle layer
    graphics.fillStyle(PALETTE.treeLeaf1, 1);
    graphics.fillCircle(-6, -32, 14);
    graphics.fillCircle(6, -32, 14);
    graphics.fillCircle(0, -28, 16);

    // Top layer
    graphics.fillStyle(PALETTE.treeLeaf2, 1);
    graphics.fillCircle(0, -40, 14);
    graphics.fillCircle(-8, -36, 10);
    graphics.fillCircle(8, -36, 10);

    // Highlights
    graphics.fillStyle(PALETTE.treeHighlight, 1);
    graphics.fillCircle(-4, -44, 6);
    graphics.fillCircle(-10, -34, 4);

    this.grid[gridY][gridX].walkable = false;
    container.setDepth(py);
  }

  private createCharacters(): void {
    this.createCharacter('hero', 'Your Hero', 'hero', 7, 9);
    this.createCharacter('villager1', 'Farmer', 'villager', 4, 8);
    this.createCharacter('villager2', 'Guard', 'villager', 10, 9);
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

    // Create 3D character
    const team: CharacterTeam = type === 'hero' ? 'player' : type === 'visitor' ? 'neutral' : 'neutral';
    const char3D = this.characterManager.createCharacter(
      id,
      team,
      px + this.cameraX,
      py + this.cameraY,
      type === 'hero' // Only hero gets full equipment
    );

    // Give visitors a sword
    if (type === 'visitor') {
      char3D.equipSword();
    }

    // Create label container (for hover labels - positioned in 2D)
    const labelContainer = this.add.container(px, py - 40);
    this.characterLayer.add(labelContainer);

    const label = this.add.text(0, 0, name, {
      fontSize: '9px',
      color: '#ffffff',
      backgroundColor: '#000000cc',
      padding: { x: 3, y: 2 },
    });
    label.setOrigin(0.5, 1);
    label.setVisible(false);
    labelContainer.add(label);

    // Create invisible hitbox for interaction
    const hitbox = this.add.rectangle(px, py - 20, TILE_SIZE, TILE_SIZE * 2, 0x000000, 0);
    this.characterLayer.add(hitbox);
    hitbox.setInteractive();
    hitbox.on('pointerover', () => label.setVisible(true));
    hitbox.on('pointerout', () => label.setVisible(false));
    hitbox.on('pointerdown', () => this.showCharacterInfo(id, name, type));

    // Store hitbox reference in label container for position updates
    labelContainer.setData('hitbox', hitbox);

    const character: Character = {
      id, name, type, gridX, gridY, labelContainer,
      path: [], pathIndex: 0, isMoving: false, direction: 'down',
    };
    this.characters.push(character);

    if (type === 'villager') {
      this.time.addEvent({
        delay: 5000 + Math.random() * 5000,
        callback: () => this.wanderCharacter(character),
        loop: true,
      });
    }

    return character;
  }

  private wanderCharacter(character: Character): void {
    if (character.isMoving) return;

    const dx = Math.floor(Math.random() * 5) - 2;
    const dy = Math.floor(Math.random() * 5) - 2;
    const newX = Phaser.Math.Clamp(character.gridX + dx, 1, GRID_COLS - 2);
    const newY = Phaser.Math.Clamp(character.gridY + dy, 1, GRID_ROWS - 2);

    if (this.grid[newY]?.[newX]?.walkable) {
      this.moveCharacterTo(character, newX, newY);
    }
  }

  private spawnVisitor(): void {
    const id = `visitor-${Date.now()}`;
    const names = ['Traveler', 'Wanderer', 'Knight', 'Mage', 'Ranger'];
    const name = Phaser.Utils.Array.GetRandom(names);

    const visitor = this.createCharacter(id, name, 'visitor', 7, 1);

    const inn = this.buildings.find(b => b.type === 'inn');
    if (inn) {
      this.time.delayedCall(500, () => {
        this.moveCharacterTo(visitor, inn.gridX + 1, inn.gridY + inn.height + 1);
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
      this.characterManager.setCharacterWalking(character.id, false);
      return;
    }

    const next = character.path[character.pathIndex];
    const px = next.x * TILE_SIZE + TILE_SIZE / 2;
    const py = next.y * TILE_SIZE + TILE_SIZE;

    const dx = next.x - character.gridX;
    const dy = next.y - character.gridY;
    if (Math.abs(dx) > Math.abs(dy)) {
      character.direction = dx > 0 ? 'right' : 'left';
    } else {
      character.direction = dy > 0 ? 'down' : 'up';
    }

    // Update 3D character facing and walking
    this.characterManager.setCharacterFacing(character.id, character.direction === 'right' || character.direction === 'down');
    this.characterManager.setCharacterWalking(character.id, true);

    // Get hitbox from label container
    const hitbox = character.labelContainer.getData('hitbox') as Phaser.GameObjects.Rectangle;

    // Animate label container
    this.tweens.add({
      targets: character.labelContainer,
      x: px,
      y: py - 40,
      duration: 250,
      onUpdate: () => {
        // Sync 3D character position during tween
        this.characterManager.setCharacterPosition(
          character.id,
          character.labelContainer.x + this.cameraX,
          character.labelContainer.y + 40 + this.cameraY
        );
      },
      onComplete: () => {
        character.gridX = next.x;
        character.gridY = next.y;
        character.pathIndex++;
        this.moveAlongPath(character);
      },
    });

    // Animate hitbox separately
    this.tweens.add({
      targets: hitbox,
      x: px,
      y: py - 20,
      duration: 250,
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

        const mapW = GRID_COLS * TILE_SIZE;
        const mapH = GRID_ROWS * TILE_SIZE;
        this.cameraX = Phaser.Math.Clamp(this.cameraX, -mapW + 150, GAME_WIDTH - 150);
        this.cameraY = Phaser.Math.Clamp(this.cameraY, -mapH + 200, GAME_HEIGHT - 100);

        this.updateCameraPosition();

        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
      }
    });

    this.input.on('pointerup', () => {
      this.isDragging = false;
    });
  }

  private showBuildingInfo(type: string, name: string, level: number): void {
    this.hideInfoPanel();

    const building = this.buildings.find(b => b.type === type);
    const production = type === 'inn' ? '15 gold/min' :
                       type === 'blacksmith' ? '5 weapons/hr' :
                       type === 'shop' ? '20 gold/min' : '10 food/min';

    this.infoPanel = this.add.container(0, GAME_HEIGHT);
    this.uiLayer.add(this.infoPanel);

    const panelH = 180;
    const bg = this.add.graphics();
    bg.fillStyle(0x1a2040, 0.98);
    bg.fillRoundedRect(10, -panelH, GAME_WIDTH - 20, panelH - 10, 12);
    bg.lineStyle(2, 0x4080c0, 1);
    bg.strokeRoundedRect(10, -panelH, GAME_WIDTH - 20, panelH - 10, 12);
    this.infoPanel.add(bg);

    const titleText = this.add.text(25, -panelH + 18, name, {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    this.infoPanel.add(titleText);

    const closeBtn = this.add.text(GAME_WIDTH - 35, -panelH + 15, 'X', {
      fontSize: '20px',
      color: '#ff6666',
    });
    closeBtn.setInteractive();
    closeBtn.on('pointerdown', () => this.hideInfoPanel());
    this.infoPanel.add(closeBtn);

    const levelText = this.add.text(25, -panelH + 48, `Level ${level}`, {
      fontSize: '13px',
      color: '#888899',
    });
    this.infoPanel.add(levelText);

    const prodText = this.add.text(25, -panelH + 70, `Produces: ${production}`, {
      fontSize: '14px',
      color: '#44dd88',
    });
    this.infoPanel.add(prodText);

    const costLabel = this.add.text(25, -panelH + 98, 'Upgrade Cost', {
      fontSize: '13px',
      color: '#ddaa44',
    });
    this.infoPanel.add(costLabel);

    const costs = this.add.text(25, -panelH + 118, `  80      60      20`, {
      fontSize: '13px',
      color: '#ffffff',
    });
    this.infoPanel.add(costs);

    // Resource icons (simple circles for now)
    const iconY = -panelH + 122;
    const goldIcon = this.add.circle(35, iconY, 8, 0xffd700);
    const woodIcon = this.add.circle(95, iconY, 8, 0xcd853f);
    const stoneIcon = this.add.circle(155, iconY, 8, 0xaaaaaa);
    this.infoPanel.add(goldIcon);
    this.infoPanel.add(woodIcon);
    this.infoPanel.add(stoneIcon);

    // Upgrade button
    const btnBg = this.add.graphics();
    btnBg.fillStyle(0x4488dd, 1);
    btnBg.fillRoundedRect(25, -50, GAME_WIDTH - 70, 36, 6);
    this.infoPanel.add(btnBg);

    const btnText = this.add.text(GAME_WIDTH / 2, -32, 'Upgrade', {
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    btnText.setOrigin(0.5);
    this.infoPanel.add(btnText);

    btnBg.setInteractive(new Phaser.Geom.Rectangle(25, -50, GAME_WIDTH - 70, 36), Phaser.Geom.Rectangle.Contains);
    btnBg.on('pointerdown', () => {
      if (building) {
        building.level++;
        this.showBuildingInfo(type, name, building.level);
      }
    });

    // Animate in
    this.tweens.add({
      targets: this.infoPanel,
      y: GAME_HEIGHT,
      duration: 200,
      ease: 'Back.easeOut',
    });
  }

  private showCharacterInfo(_id: string, name: string, type: string): void {
    this.hideInfoPanel();

    this.infoPanel = this.add.container(0, GAME_HEIGHT);
    this.uiLayer.add(this.infoPanel);

    const panelH = 140;
    const bg = this.add.graphics();
    bg.fillStyle(0x1a2040, 0.98);
    bg.fillRoundedRect(10, -panelH, GAME_WIDTH - 20, panelH - 10, 12);
    bg.lineStyle(2, 0x4080c0, 1);
    bg.strokeRoundedRect(10, -panelH, GAME_WIDTH - 20, panelH - 10, 12);
    this.infoPanel.add(bg);

    const titleText = this.add.text(25, -panelH + 18, name, {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    this.infoPanel.add(titleText);

    const closeBtn = this.add.text(GAME_WIDTH - 35, -panelH + 15, 'X', {
      fontSize: '20px',
      color: '#ff6666',
    });
    closeBtn.setInteractive();
    closeBtn.on('pointerdown', () => this.hideInfoPanel());
    this.infoPanel.add(closeBtn);

    const typeText = this.add.text(25, -panelH + 48, type.charAt(0).toUpperCase() + type.slice(1), {
      fontSize: '13px',
      color: '#888899',
    });
    this.infoPanel.add(typeText);

    const desc = type === 'hero' ? 'Your loyal champion. Ready for battle!' :
                 type === 'visitor' ? 'A traveling adventurer seeking glory.' :
                 'A peaceful villager of the kingdom.';

    const descText = this.add.text(25, -panelH + 70, desc, {
      fontSize: '12px',
      color: '#aabbcc',
      wordWrap: { width: GAME_WIDTH - 60 },
    });
    this.infoPanel.add(descText);

    if (type === 'visitor') {
      const btnBg = this.add.graphics();
      btnBg.fillStyle(0x44aa44, 1);
      btnBg.fillRoundedRect(25, -45, GAME_WIDTH - 70, 32, 6);
      this.infoPanel.add(btnBg);

      const btnText = this.add.text(GAME_WIDTH / 2, -29, 'Recruit', {
        fontSize: '14px',
        color: '#ffffff',
        fontStyle: 'bold',
      });
      btnText.setOrigin(0.5);
      this.infoPanel.add(btnText);
    }

    this.tweens.add({
      targets: this.infoPanel,
      y: GAME_HEIGHT,
      duration: 200,
      ease: 'Back.easeOut',
    });
  }

  private hideInfoPanel(): void {
    if (this.infoPanel) {
      this.infoPanel.destroy();
      this.infoPanel = null;
    }
  }

  private createUI(): void {
    // Header
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a2040, 0.95);
    headerBg.fillRect(0, 0, GAME_WIDTH, 55);
    headerBg.lineStyle(2, 0x4080c0, 1);
    headerBg.lineBetween(0, 55, GAME_WIDTH, 55);
    this.uiLayer.add(headerBg);

    const title = this.add.text(GAME_WIDTH / 2, 16, 'YOUR KINGDOM', {
      fontSize: '15px',
      color: '#ffffff',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    title.setOrigin(0.5, 0);
    this.uiLayer.add(title);

    // Resource bar
    const resources = [
      { icon: 0xffd700, value: '550', x: 30 },
      { icon: 0xcd853f, value: '200', x: 110 },
      { icon: 0xaaaaaa, value: '150', x: 190 },
      { icon: 0x88dd44, value: '300', x: 270 },
    ];
    resources.forEach(r => {
      const circle = this.add.circle(r.x, 40, 8, r.icon);
      this.uiLayer.add(circle);
      const text = this.add.text(r.x + 14, 40, r.value, {
        fontSize: '12px',
        color: '#ffffff',
      });
      text.setOrigin(0, 0.5);
      this.uiLayer.add(text);
    });

    // Back button
    const backBtn = this.add.text(12, 16, '< WORLD', {
      fontSize: '11px',
      color: '#4488dd',
      fontFamily: 'monospace',
    });
    backBtn.setInteractive();
    backBtn.on('pointerdown', () => this.scene.start('WorldScene'));
    backBtn.on('pointerover', () => backBtn.setColor('#88ccff'));
    backBtn.on('pointerout', () => backBtn.setColor('#4488dd'));
    this.uiLayer.add(backBtn);

    // Build button
    const buildBtn = this.add.text(GAME_WIDTH - 12, 16, 'BUILD', {
      fontSize: '11px',
      color: '#44aa44',
      fontFamily: 'monospace',
    });
    buildBtn.setOrigin(1, 0);
    buildBtn.setInteractive();
    buildBtn.on('pointerover', () => buildBtn.setColor('#88ee88'));
    buildBtn.on('pointerout', () => buildBtn.setColor('#44aa44'));
    this.uiLayer.add(buildBtn);

    // Bottom nav
    const navBg = this.add.graphics();
    navBg.fillStyle(0x1a2040, 0.95);
    navBg.fillRect(0, GAME_HEIGHT - 55, GAME_WIDTH, 55);
    navBg.lineStyle(2, 0x4080c0, 1);
    navBg.lineBetween(0, GAME_HEIGHT - 55, GAME_WIDTH, GAME_HEIGHT - 55);
    this.uiLayer.add(navBg);

    this.createNavButton(GAME_WIDTH / 4, GAME_HEIGHT - 28, 'WORLD', false, () => this.scene.start('WorldScene'));
    this.createNavButton((GAME_WIDTH / 4) * 2, GAME_HEIGHT - 28, 'KINGDOM', true);
    this.createNavButton((GAME_WIDTH / 4) * 3, GAME_HEIGHT - 28, 'BATTLE', false, () => this.scene.start('BattleScene'));
  }

  private createNavButton(x: number, y: number, label: string, active: boolean, callback?: () => void): void {
    const bg = this.add.graphics();
    bg.fillStyle(active ? 0x4080c0 : 0x303050, 1);
    bg.fillRoundedRect(x - 38, y - 12, 76, 24, 4);
    this.uiLayer.add(bg);

    const btn = this.add.text(x, y, label, {
      fontSize: '11px',
      color: active ? '#ffffff' : '#666688',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    btn.setOrigin(0.5);
    this.uiLayer.add(btn);

    if (callback) {
      bg.setInteractive(new Phaser.Geom.Rectangle(x - 38, y - 12, 76, 24), Phaser.Geom.Rectangle.Contains);
      bg.on('pointerdown', callback);
    }
  }

  private noise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  update(time: number): void {
    // Update 3D character rendering
    if (this.characterManager) {
      this.characterManager.update(time);
    }

    // Update label depths
    for (const char of this.characters) {
      const py = char.gridY * TILE_SIZE + TILE_SIZE;
      char.labelContainer.setDepth(py);
    }
  }
}
