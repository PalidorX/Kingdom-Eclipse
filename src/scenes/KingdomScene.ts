import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  KINGDOM_GRID_SIZE,
  TILE_SIZE,
} from '../config/constants';

interface GridTile {
  x: number;
  y: number;
  type: string;
  walkable: boolean;
  building: string | null;
}

interface Building {
  id: string;
  type: string;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  sprite: Phaser.GameObjects.Sprite;
}

interface Visitor {
  id: string;
  sprite: Phaser.GameObjects.Sprite;
  targetX: number;
  targetY: number;
  path: { x: number; y: number }[];
  pathIndex: number;
}

export class KingdomScene extends Phaser.Scene {
  private grid: GridTile[][] = [];
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private buildings: Building[] = [];
  private visitors: Visitor[] = [];
  private pathfinder!: EasyStar.js;

  // Camera controls
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private lastPointerDistance: number = 0;
  private minZoom: number = 0.25;
  private maxZoom: number = 2;

  // Map dimensions
  private mapWidth: number = KINGDOM_GRID_SIZE * TILE_SIZE;
  private mapHeight: number = KINGDOM_GRID_SIZE * TILE_SIZE;

  // Building placement mode
  private isPlacementMode: boolean = false;
  private placementPreview: Phaser.GameObjects.Sprite | null = null;
  private selectedBuildingType: string | null = null;

  constructor() {
    super({ key: 'KingdomScene' });
  }

  create(): void {
    this.initializeGrid();
    this.initializePathfinder();
    this.createTilemap();
    this.setupCamera();
    this.setupInputHandlers();
    this.createDefaultBuildings();
    this.createUI();

    // Start visitor spawning
    this.time.addEvent({
      delay: 10000,
      callback: this.spawnVisitor,
      callbackScope: this,
      loop: true,
    });

    // Spawn initial visitor after short delay
    this.time.delayedCall(2000, () => this.spawnVisitor());

    // Launch UI scene
    this.scene.launch('UIScene');
  }

  private initializeGrid(): void {
    this.grid = [];
    for (let y = 0; y < KINGDOM_GRID_SIZE; y++) {
      this.grid[y] = [];
      for (let x = 0; x < KINGDOM_GRID_SIZE; x++) {
        this.grid[y][x] = {
          x,
          y,
          type: 'grass',
          walkable: true,
          building: null,
        };
      }
    }

    // Create some varied terrain
    this.generateTerrain();
  }

  private generateTerrain(): void {
    // Add paths from gate to center
    const centerX = Math.floor(KINGDOM_GRID_SIZE / 2);
    const centerY = Math.floor(KINGDOM_GRID_SIZE / 2);

    // Vertical path from gate (bottom center) to center
    for (let y = KINGDOM_GRID_SIZE - 1; y >= centerY; y--) {
      this.grid[y][centerX].type = 'path';
    }

    // Horizontal path through center
    for (let x = 20; x < KINGDOM_GRID_SIZE - 20; x++) {
      this.grid[centerY][x].type = 'path';
    }

    // Add some water features
    for (let i = 0; i < 3; i++) {
      const pondX = Phaser.Math.Between(20, KINGDOM_GRID_SIZE - 30);
      const pondY = Phaser.Math.Between(20, KINGDOM_GRID_SIZE - 30);
      const pondSize = Phaser.Math.Between(3, 6);

      for (let dy = 0; dy < pondSize; dy++) {
        for (let dx = 0; dx < pondSize; dx++) {
          if (pondY + dy < KINGDOM_GRID_SIZE && pondX + dx < KINGDOM_GRID_SIZE) {
            this.grid[pondY + dy][pondX + dx].type = 'water';
            this.grid[pondY + dy][pondX + dx].walkable = false;
          }
        }
      }
    }
  }

  private initializePathfinder(): void {
    this.pathfinder = new EasyStar.js();

    // Create walkability grid
    const walkableGrid: number[][] = [];
    for (let y = 0; y < KINGDOM_GRID_SIZE; y++) {
      walkableGrid[y] = [];
      for (let x = 0; x < KINGDOM_GRID_SIZE; x++) {
        walkableGrid[y][x] = this.grid[y][x].walkable ? 0 : 1;
      }
    }

    this.pathfinder.setGrid(walkableGrid);
    this.pathfinder.setAcceptableTiles([0]);
    this.pathfinder.enableDiagonals();
    this.pathfinder.enableCornerCutting();
  }

  private createTilemap(): void {
    this.gridGraphics = this.add.graphics();

    for (let y = 0; y < KINGDOM_GRID_SIZE; y++) {
      for (let x = 0; x < KINGDOM_GRID_SIZE; x++) {
        const tile = this.grid[y][x];
        const worldX = x * TILE_SIZE;
        const worldY = y * TILE_SIZE;

        // Draw tile based on type
        let color: number;
        switch (tile.type) {
          case 'path':
            color = 0xc4a35a;
            break;
          case 'water':
            color = 0x3b7cb5;
            break;
          case 'stone':
            color = 0x6b6b6b;
            break;
          default:
            color = 0x4a7c3f;
        }

        this.gridGraphics.fillStyle(color, 1);
        this.gridGraphics.fillRect(worldX, worldY, TILE_SIZE, TILE_SIZE);

        // Grid lines (subtle)
        this.gridGraphics.lineStyle(1, 0x000000, 0.1);
        this.gridGraphics.strokeRect(worldX, worldY, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main;

    // Set camera bounds to the full map
    cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    // Set initial zoom to show a reasonable area
    cam.setZoom(1);

    // Center camera on the kingdom center
    cam.centerOn(this.mapWidth / 2, this.mapHeight / 2);
  }

  private setupInputHandlers(): void {
    // Pan/drag handling
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging && pointer.leftButtonDown()) {
        const cam = this.cameras.main;
        const dx = (this.dragStartX - pointer.x) / cam.zoom;
        const dy = (this.dragStartY - pointer.y) / cam.zoom;

        cam.scrollX += dx;
        cam.scrollY += dy;

        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
      }

      // Pinch-to-zoom detection
      const pointers = this.input.manager.pointers.filter((p) => p.isDown);
      if (pointers.length === 2) {
        const [p1, p2] = pointers;
        const distance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);

        if (this.lastPointerDistance > 0) {
          const delta = distance - this.lastPointerDistance;
          const zoomChange = delta * 0.005;
          this.zoomCamera(zoomChange);
        }

        this.lastPointerDistance = distance;
      }

      // Placement preview
      if (this.isPlacementMode && this.placementPreview) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gridX = Math.floor(worldPoint.x / TILE_SIZE);
        const gridY = Math.floor(worldPoint.y / TILE_SIZE);
        this.placementPreview.setPosition(
          gridX * TILE_SIZE + TILE_SIZE,
          gridY * TILE_SIZE + TILE_SIZE
        );
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = false;
      this.lastPointerDistance = 0;

      // Handle placement
      if (this.isPlacementMode && this.selectedBuildingType) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gridX = Math.floor(worldPoint.x / TILE_SIZE);
        const gridY = Math.floor(worldPoint.y / TILE_SIZE);
        this.placeBuilding(this.selectedBuildingType, gridX, gridY);
      }
    });

    // Mouse wheel zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown, _deltaX: number, deltaY: number) => {
      const zoomChange = deltaY > 0 ? -0.1 : 0.1;
      this.zoomCamera(zoomChange);
    });
  }

  private zoomCamera(delta: number): void {
    const cam = this.cameras.main;
    const newZoom = Phaser.Math.Clamp(cam.zoom + delta, this.minZoom, this.maxZoom);
    cam.setZoom(newZoom);
  }

  private createDefaultBuildings(): void {
    const centerX = Math.floor(KINGDOM_GRID_SIZE / 2);
    const centerY = Math.floor(KINGDOM_GRID_SIZE / 2);

    // Place gate at bottom center
    this.placeBuilding('gate', centerX - 1, KINGDOM_GRID_SIZE - 4);

    // Place inn near center
    this.placeBuilding('inn', centerX - 1, centerY - 1);

    // Place some initial buildings
    this.placeBuilding('barracks', centerX + 5, centerY - 2);
    this.placeBuilding('farm', centerX - 8, centerY + 3);
  }

  private placeBuilding(type: string, gridX: number, gridY: number): boolean {
    // Get building config
    const config = this.getBuildingConfig(type);
    if (!config) return false;

    // Check if area is valid and clear
    for (let dy = 0; dy < config.height; dy++) {
      for (let dx = 0; dx < config.width; dx++) {
        const checkX = gridX + dx;
        const checkY = gridY + dy;

        if (
          checkX < 0 ||
          checkX >= KINGDOM_GRID_SIZE ||
          checkY < 0 ||
          checkY >= KINGDOM_GRID_SIZE
        ) {
          return false;
        }

        if (this.grid[checkY][checkX].building !== null) {
          return false;
        }

        if (!this.grid[checkY][checkX].walkable) {
          return false;
        }
      }
    }

    // Create building sprite
    const worldX = gridX * TILE_SIZE + (config.width * TILE_SIZE) / 2;
    const worldY = gridY * TILE_SIZE + (config.height * TILE_SIZE) / 2;

    const sprite = this.add.sprite(worldX, worldY, `building-${type}`);
    sprite.setInteractive();
    sprite.on('pointerdown', () => this.onBuildingTap(type, gridX, gridY));

    // Register building
    const building: Building = {
      id: `${type}-${Date.now()}`,
      type,
      gridX,
      gridY,
      width: config.width,
      height: config.height,
      sprite,
    };
    this.buildings.push(building);

    // Mark grid cells
    for (let dy = 0; dy < config.height; dy++) {
      for (let dx = 0; dx < config.width; dx++) {
        this.grid[gridY + dy][gridX + dx].building = building.id;
        this.grid[gridY + dy][gridX + dx].walkable = false;
      }
    }

    // Update pathfinder
    this.updatePathfinderGrid();

    return true;
  }

  private getBuildingConfig(type: string): { width: number; height: number } | null {
    const configs: Record<string, { width: number; height: number }> = {
      gate: { width: 2, height: 2 },
      inn: { width: 2, height: 2 },
      barracks: { width: 3, height: 3 },
      farm: { width: 2, height: 2 },
      mine: { width: 2, height: 2 },
    };
    return configs[type] || null;
  }

  private updatePathfinderGrid(): void {
    const walkableGrid: number[][] = [];
    for (let y = 0; y < KINGDOM_GRID_SIZE; y++) {
      walkableGrid[y] = [];
      for (let x = 0; x < KINGDOM_GRID_SIZE; x++) {
        walkableGrid[y][x] = this.grid[y][x].walkable ? 0 : 1;
      }
    }
    this.pathfinder.setGrid(walkableGrid);
  }

  private onBuildingTap(type: string, gridX: number, gridY: number): void {
    // Emit event for UI to show building details
    this.events.emit('building-selected', { type, gridX, gridY });
  }

  private spawnVisitor(): void {
    // Find gate building
    const gate = this.buildings.find((b) => b.type === 'gate');
    if (!gate) return;

    // Spawn at gate position
    const spawnX = gate.gridX * TILE_SIZE + TILE_SIZE;
    const spawnY = (gate.gridY + gate.height) * TILE_SIZE;

    const sprite = this.add.sprite(spawnX, spawnY, 'char-visitor');
    sprite.setDepth(50);
    sprite.setInteractive();

    const visitor: Visitor = {
      id: `visitor-${Date.now()}`,
      sprite,
      targetX: 0,
      targetY: 0,
      path: [],
      pathIndex: 0,
    };

    sprite.on('pointerdown', () => this.onVisitorTap(visitor));

    this.visitors.push(visitor);

    // Find path to inn
    const inn = this.buildings.find((b) => b.type === 'inn');
    if (inn) {
      this.findPathForVisitor(visitor, inn.gridX, inn.gridY - 1);
    }
  }

  private findPathForVisitor(visitor: Visitor, targetGridX: number, targetGridY: number): void {
    const startGridX = Math.floor(visitor.sprite.x / TILE_SIZE);
    const startGridY = Math.floor(visitor.sprite.y / TILE_SIZE);

    this.pathfinder.findPath(
      startGridX,
      startGridY,
      targetGridX,
      targetGridY,
      (path) => {
        if (path && path.length > 0) {
          visitor.path = path;
          visitor.pathIndex = 0;
          this.moveVisitorAlongPath(visitor);
        }
      }
    );
    this.pathfinder.calculate();
  }

  private moveVisitorAlongPath(visitor: Visitor): void {
    if (visitor.pathIndex >= visitor.path.length) {
      // Reached destination
      this.onVisitorArrived(visitor);
      return;
    }

    const nextTile = visitor.path[visitor.pathIndex];
    const targetX = nextTile.x * TILE_SIZE + TILE_SIZE / 2;
    const targetY = nextTile.y * TILE_SIZE + TILE_SIZE / 2;

    this.tweens.add({
      targets: visitor.sprite,
      x: targetX,
      y: targetY,
      duration: 200,
      onComplete: () => {
        visitor.pathIndex++;
        this.moveVisitorAlongPath(visitor);
      },
    });
  }

  private onVisitorArrived(visitor: Visitor): void {
    // Visitor reached the inn - idle animation
    this.tweens.add({
      targets: visitor.sprite,
      y: visitor.sprite.y - 5,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });
  }

  private onVisitorTap(visitor: Visitor): void {
    // Emit event for UI to show visitor details / recruitment dialog
    this.events.emit('visitor-selected', {
      id: visitor.id,
      x: visitor.sprite.x,
      y: visitor.sprite.y,
    });
  }

  private createUI(): void {
    // Create fixed UI elements that stay on screen

    // Zoom controls
    const zoomInBtn = this.add.text(GAME_WIDTH - 40, GAME_HEIGHT / 2 - 30, '+', {
      fontSize: '24px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 8, y: 4 },
    });
    zoomInBtn.setScrollFactor(0);
    zoomInBtn.setDepth(1000);
    zoomInBtn.setInteractive();
    zoomInBtn.on('pointerdown', () => this.zoomCamera(0.2));

    const zoomOutBtn = this.add.text(GAME_WIDTH - 40, GAME_HEIGHT / 2 + 10, '-', {
      fontSize: '24px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 10, y: 4 },
    });
    zoomOutBtn.setScrollFactor(0);
    zoomOutBtn.setDepth(1000);
    zoomOutBtn.setInteractive();
    zoomOutBtn.on('pointerdown', () => this.zoomCamera(-0.2));

    // Navigation header
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a1a2e, 0.9);
    headerBg.fillRect(0, 0, GAME_WIDTH, 50);
    headerBg.setScrollFactor(0);
    headerBg.setDepth(999);

    const title = this.add.text(GAME_WIDTH / 2, 25, 'Kingdom', {
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5);
    title.setScrollFactor(0);
    title.setDepth(1000);

    // Back button
    const backBtn = this.add.text(20, 25, '< World', {
      fontSize: '14px',
      color: '#4a90d9',
    });
    backBtn.setOrigin(0, 0.5);
    backBtn.setScrollFactor(0);
    backBtn.setDepth(1000);
    backBtn.setInteractive();
    backBtn.on('pointerdown', () => this.scene.start('WorldScene'));

    // Build button
    const buildBtn = this.add.text(GAME_WIDTH - 20, 25, 'Build', {
      fontSize: '14px',
      color: '#32cd32',
    });
    buildBtn.setOrigin(1, 0.5);
    buildBtn.setScrollFactor(0);
    buildBtn.setDepth(1000);
    buildBtn.setInteractive();
    buildBtn.on('pointerdown', () => this.toggleBuildMode());
  }

  private toggleBuildMode(): void {
    this.isPlacementMode = !this.isPlacementMode;

    if (this.isPlacementMode) {
      // Show building selection (simplified - just place farm for now)
      this.selectedBuildingType = 'farm';
      this.placementPreview = this.add.sprite(0, 0, 'building-farm');
      this.placementPreview.setAlpha(0.5);
      this.placementPreview.setDepth(100);
    } else {
      if (this.placementPreview) {
        this.placementPreview.destroy();
        this.placementPreview = null;
      }
      this.selectedBuildingType = null;
    }
  }

  update(): void {
    // Update logic if needed
  }
}
