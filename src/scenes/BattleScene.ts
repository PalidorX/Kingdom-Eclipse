import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import { GAME_WIDTH, GAME_HEIGHT, BATTLE_GRID_SIZE } from '../config/constants';

type BattlePhase = 'setup' | 'combat' | 'victory' | 'defeat';

interface BattleUnit {
  id: string;
  team: 'player' | 'enemy';
  sprite: Phaser.GameObjects.Sprite;
  gridX: number;
  gridY: number;
  stats: {
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
    attack: number;
    defense: number;
    dexterity: number; // Affects attack speed
    intelligence: number; // Affects skill power
  };
  attackCooldown: number;
  currentCooldown: number;
  target: BattleUnit | null;
  hpBar: Phaser.GameObjects.Graphics;
  manaBar: Phaser.GameObjects.Graphics;
}

interface GridCell {
  x: number;
  y: number;
  walkable: boolean;
  occupied: boolean;
  occupant: BattleUnit | null;
}

export class BattleScene extends Phaser.Scene {
  private grid: GridCell[][] = [];
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private gridStartX: number = 0;
  private gridStartY: number = 0;
  private cellSize: number = 40;

  private playerUnits: BattleUnit[] = [];
  private enemyUnits: BattleUnit[] = [];
  private allUnits: BattleUnit[] = [];

  private phase: BattlePhase = 'setup';
  private combatTick: number = 0;
  private tickRate: number = 100; // ms per tick

  private pathfinder!: EasyStar.js;

  // Setup phase
  private benchUnits: Phaser.GameObjects.Sprite[] = [];
  private validPlacementCells: { x: number; y: number }[] = [];

  constructor() {
    super({ key: 'BattleScene' });
  }

  create(): void {
    this.resetState();
    this.calculateGridPosition();
    this.initializeGrid();
    this.initializePathfinder();
    this.createBattleGrid();
    this.generateObstacles();
    this.spawnEnemies();
    this.createBench();
    this.createUI();

    // Launch UI scene
    this.scene.launch('UIScene');
  }

  private resetState(): void {
    this.phase = 'setup';
    this.combatTick = 0;
    this.playerUnits = [];
    this.enemyUnits = [];
    this.allUnits = [];
    this.benchUnits = [];
    this.grid = [];
  }

  private calculateGridPosition(): void {
    // Center the 8x8 grid on screen
    const gridPixelSize = BATTLE_GRID_SIZE * this.cellSize;
    this.gridStartX = (GAME_WIDTH - gridPixelSize) / 2;
    this.gridStartY = 80; // Leave room for header
  }

  private initializeGrid(): void {
    for (let y = 0; y < BATTLE_GRID_SIZE; y++) {
      this.grid[y] = [];
      for (let x = 0; x < BATTLE_GRID_SIZE; x++) {
        this.grid[y][x] = {
          x,
          y,
          walkable: true,
          occupied: false,
          occupant: null,
        };
      }
    }

    // Define valid placement cells (bottom two rows for player)
    this.validPlacementCells = [];
    for (let y = BATTLE_GRID_SIZE - 2; y < BATTLE_GRID_SIZE; y++) {
      for (let x = 0; x < BATTLE_GRID_SIZE; x++) {
        this.validPlacementCells.push({ x, y });
      }
    }
  }

  private initializePathfinder(): void {
    this.pathfinder = new EasyStar.js();
    this.updatePathfinderGrid();
  }

  private updatePathfinderGrid(): void {
    const walkableGrid: number[][] = [];
    for (let y = 0; y < BATTLE_GRID_SIZE; y++) {
      walkableGrid[y] = [];
      for (let x = 0; x < BATTLE_GRID_SIZE; x++) {
        walkableGrid[y][x] = this.grid[y][x].walkable && !this.grid[y][x].occupied ? 0 : 1;
      }
    }
    this.pathfinder.setGrid(walkableGrid);
    this.pathfinder.setAcceptableTiles([0]);
    this.pathfinder.enableDiagonals();
  }

  private createBattleGrid(): void {
    this.gridGraphics = this.add.graphics();

    for (let y = 0; y < BATTLE_GRID_SIZE; y++) {
      for (let x = 0; x < BATTLE_GRID_SIZE; x++) {
        const worldX = this.gridStartX + x * this.cellSize;
        const worldY = this.gridStartY + y * this.cellSize;

        // Checkerboard pattern
        const isLight = (x + y) % 2 === 0;
        const color = isLight ? 0x4a5568 : 0x2d3748;

        this.gridGraphics.fillStyle(color, 1);
        this.gridGraphics.fillRect(worldX, worldY, this.cellSize, this.cellSize);

        // Highlight valid placement cells during setup
        if (this.validPlacementCells.some((c) => c.x === x && c.y === y)) {
          this.gridGraphics.fillStyle(0x4a90d9, 0.2);
          this.gridGraphics.fillRect(worldX, worldY, this.cellSize, this.cellSize);
        }

        // Grid lines
        this.gridGraphics.lineStyle(1, 0x1a202c, 0.5);
        this.gridGraphics.strokeRect(worldX, worldY, this.cellSize, this.cellSize);
      }
    }
  }

  private generateObstacles(): void {
    // Add random obstacles to the middle rows
    const obstacleCount = Phaser.Math.Between(2, 4);

    for (let i = 0; i < obstacleCount; i++) {
      const x = Phaser.Math.Between(1, BATTLE_GRID_SIZE - 2);
      const y = Phaser.Math.Between(2, BATTLE_GRID_SIZE - 3);

      if (this.grid[y][x].walkable && !this.grid[y][x].occupied) {
        this.grid[y][x].walkable = false;

        // Draw obstacle
        const worldX = this.gridStartX + x * this.cellSize;
        const worldY = this.gridStartY + y * this.cellSize;

        this.gridGraphics.fillStyle(0x6b6b6b, 1);
        this.gridGraphics.fillRect(worldX + 4, worldY + 4, this.cellSize - 8, this.cellSize - 8);
      }
    }

    this.updatePathfinderGrid();
  }

  private spawnEnemies(): void {
    // Spawn enemies in top two rows
    const enemyCount = Phaser.Math.Between(2, 4);
    const spawnPositions: { x: number; y: number }[] = [];

    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < BATTLE_GRID_SIZE; x++) {
        if (this.grid[y][x].walkable) {
          spawnPositions.push({ x, y });
        }
      }
    }

    Phaser.Utils.Array.Shuffle(spawnPositions);

    for (let i = 0; i < Math.min(enemyCount, spawnPositions.length); i++) {
      const pos = spawnPositions[i];
      this.createUnit('enemy', pos.x, pos.y);
    }
  }

  private createUnit(team: 'player' | 'enemy', gridX: number, gridY: number): BattleUnit {
    const worldX = this.gridStartX + gridX * this.cellSize + this.cellSize / 2;
    const worldY = this.gridStartY + gridY * this.cellSize + this.cellSize / 2;

    const textureKey = team === 'player' ? 'char-ally' : 'char-enemy';
    const sprite = this.add.sprite(worldX, worldY, textureKey);
    sprite.setScale(2);
    sprite.setDepth(10);

    // Random stats with some variance
    const baseStats = {
      hp: Phaser.Math.Between(80, 120),
      mana: 0,
      attack: Phaser.Math.Between(10, 20),
      defense: Phaser.Math.Between(5, 15),
      dexterity: Phaser.Math.Between(5, 15),
      intelligence: Phaser.Math.Between(5, 15),
    };

    // HP bar
    const hpBar = this.add.graphics();
    hpBar.setDepth(11);

    // Mana bar
    const manaBar = this.add.graphics();
    manaBar.setDepth(11);

    const unit: BattleUnit = {
      id: `${team}-${Date.now()}-${Phaser.Math.Between(0, 999)}`,
      team,
      sprite,
      gridX,
      gridY,
      stats: {
        ...baseStats,
        maxHp: baseStats.hp,
        maxMana: 100,
      },
      attackCooldown: this.calculateAttackCooldown(baseStats.dexterity),
      currentCooldown: 0,
      target: null,
      hpBar,
      manaBar,
    };

    this.updateUnitBars(unit);

    // Mark grid cell as occupied
    this.grid[gridY][gridX].occupied = true;
    this.grid[gridY][gridX].occupant = unit;

    if (team === 'player') {
      this.playerUnits.push(unit);
    } else {
      this.enemyUnits.push(unit);
    }
    this.allUnits.push(unit);

    this.updatePathfinderGrid();

    return unit;
  }

  private calculateAttackCooldown(dexterity: number): number {
    // Higher dexterity = faster attacks
    // Base: 20 ticks, min: 5 ticks
    return Math.max(5, 25 - dexterity);
  }

  private updateUnitBars(unit: BattleUnit): void {
    const barWidth = 30;
    const barHeight = 4;
    const barX = unit.sprite.x - barWidth / 2;
    const hpBarY = unit.sprite.y - 20;
    const manaBarY = hpBarY + 5;

    // HP bar
    unit.hpBar.clear();
    unit.hpBar.fillStyle(0x333333, 1);
    unit.hpBar.fillRect(barX, hpBarY, barWidth, barHeight);
    unit.hpBar.fillStyle(0x32cd32, 1);
    const hpWidth = (unit.stats.hp / unit.stats.maxHp) * barWidth;
    unit.hpBar.fillRect(barX, hpBarY, hpWidth, barHeight);

    // Mana bar
    unit.manaBar.clear();
    unit.manaBar.fillStyle(0x333333, 1);
    unit.manaBar.fillRect(barX, manaBarY, barWidth, barHeight);
    unit.manaBar.fillStyle(0x4a90d9, 1);
    const manaWidth = (unit.stats.mana / unit.stats.maxMana) * barWidth;
    unit.manaBar.fillRect(barX, manaBarY, manaWidth, barHeight);
  }

  private createBench(): void {
    // Create bench area at bottom of screen
    const benchY = GAME_HEIGHT - 80;
    const benchBg = this.add.graphics();
    benchBg.fillStyle(0x1a1a2e, 0.9);
    benchBg.fillRect(0, benchY - 10, GAME_WIDTH, 90);

    const benchLabel = this.add.text(GAME_WIDTH / 2, benchY - 5, 'Drag units to battle grid', {
      fontSize: '12px',
      color: '#888888',
    });
    benchLabel.setOrigin(0.5);

    // Create bench units (player's available units)
    const unitCount = 4;
    const spacing = GAME_WIDTH / (unitCount + 1);

    for (let i = 0; i < unitCount; i++) {
      const x = spacing * (i + 1);
      const unit = this.add.sprite(x, benchY + 30, 'char-ally');
      unit.setScale(2);
      unit.setInteractive({ draggable: true });

      unit.on('dragstart', () => {
        unit.setAlpha(0.7);
      });

      unit.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        unit.x = dragX;
        unit.y = dragY;
      });

      unit.on('dragend', (pointer: Phaser.Input.Pointer) => {
        unit.setAlpha(1);

        // Check if dropped on valid cell
        const gridX = Math.floor((pointer.x - this.gridStartX) / this.cellSize);
        const gridY = Math.floor((pointer.y - this.gridStartY) / this.cellSize);

        if (this.isValidPlacement(gridX, gridY)) {
          // Place unit on grid
          this.createUnit('player', gridX, gridY);
          unit.destroy();
          const index = this.benchUnits.indexOf(unit);
          if (index > -1) this.benchUnits.splice(index, 1);
        } else {
          // Return to bench
          unit.x = spacing * (i + 1);
          unit.y = benchY + 30;
        }
      });

      this.benchUnits.push(unit);
    }
  }

  private isValidPlacement(gridX: number, gridY: number): boolean {
    if (gridX < 0 || gridX >= BATTLE_GRID_SIZE || gridY < 0 || gridY >= BATTLE_GRID_SIZE) {
      return false;
    }

    const isValidCell = this.validPlacementCells.some((c) => c.x === gridX && c.y === gridY);
    const cell = this.grid[gridY]?.[gridX];

    return isValidCell && cell && cell.walkable && !cell.occupied;
  }

  private createUI(): void {
    // Header
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a1a2e, 0.9);
    headerBg.fillRect(0, 0, GAME_WIDTH, 60);
    headerBg.setDepth(100);

    const title = this.add.text(GAME_WIDTH / 2, 20, 'Battle', {
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5, 0);
    title.setDepth(101);

    // Phase indicator
    const phaseText = this.add.text(GAME_WIDTH / 2, 45, 'Setup Phase', {
      fontSize: '12px',
      color: '#4a90d9',
    });
    phaseText.setOrigin(0.5);
    phaseText.setDepth(101);
    this.data.set('phaseText', phaseText);

    // Back button
    const backBtn = this.add.text(20, 30, '< Exit', {
      fontSize: '14px',
      color: '#dc143c',
    });
    backBtn.setOrigin(0, 0.5);
    backBtn.setDepth(101);
    backBtn.setInteractive();
    backBtn.on('pointerdown', () => this.scene.start('WorldScene'));

    // Start battle button
    const startBtn = this.add.text(GAME_WIDTH - 20, 30, 'Start Battle', {
      fontSize: '14px',
      color: '#32cd32',
      backgroundColor: '#1a1a2e',
      padding: { x: 10, y: 5 },
    });
    startBtn.setOrigin(1, 0.5);
    startBtn.setDepth(101);
    startBtn.setInteractive();
    startBtn.on('pointerdown', () => this.startCombat());
    this.data.set('startBtn', startBtn);
  }

  private startCombat(): void {
    if (this.playerUnits.length === 0) {
      // Need at least one unit
      this.cameras.main.shake(100, 0.01);
      return;
    }

    this.phase = 'combat';

    // Update UI
    const phaseText = this.data.get('phaseText') as Phaser.GameObjects.Text;
    phaseText.setText('Combat Phase');
    phaseText.setColor('#dc143c');

    const startBtn = this.data.get('startBtn') as Phaser.GameObjects.Text;
    startBtn.setVisible(false);

    // Remove remaining bench units
    this.benchUnits.forEach((u) => u.destroy());
    this.benchUnits = [];

    // Start combat loop
    this.time.addEvent({
      delay: this.tickRate,
      callback: this.combatLoop,
      callbackScope: this,
      loop: true,
    });
  }

  private combatLoop(): void {
    if (this.phase !== 'combat') return;

    this.combatTick++;

    // Process each unit
    for (const unit of this.allUnits) {
      if (unit.stats.hp <= 0) continue;

      // Reduce cooldown
      unit.currentCooldown--;

      // Find target if needed
      if (!unit.target || unit.target.stats.hp <= 0) {
        unit.target = this.findNearestEnemy(unit);
      }

      if (unit.target) {
        const distance = this.getGridDistance(unit, unit.target);

        if (distance <= 1.5) {
          // In attack range
          if (unit.currentCooldown <= 0) {
            this.performAttack(unit, unit.target);
            unit.currentCooldown = unit.attackCooldown;
          }
        } else {
          // Move towards target
          this.moveTowardsTarget(unit, unit.target);
        }
      }

      // Gain mana over time
      unit.stats.mana = Math.min(unit.stats.maxMana, unit.stats.mana + 1);
      this.updateUnitBars(unit);

      // Check for ultimate skill
      if (unit.stats.mana >= unit.stats.maxMana) {
        this.performUltimate(unit);
      }
    }

    // Check win/lose conditions
    this.checkBattleEnd();
  }

  private findNearestEnemy(unit: BattleUnit): BattleUnit | null {
    const enemies = unit.team === 'player' ? this.enemyUnits : this.playerUnits;
    const aliveEnemies = enemies.filter((e) => e.stats.hp > 0);

    if (aliveEnemies.length === 0) return null;

    let nearest: BattleUnit | null = null;
    let minDistance = Infinity;

    for (const enemy of aliveEnemies) {
      const distance = this.getGridDistance(unit, enemy);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = enemy;
      }
    }

    return nearest;
  }

  private getGridDistance(a: BattleUnit, b: BattleUnit): number {
    return Math.sqrt(Math.pow(a.gridX - b.gridX, 2) + Math.pow(a.gridY - b.gridY, 2));
  }

  private moveTowardsTarget(unit: BattleUnit, target: BattleUnit): void {
    // Simple movement towards target (one cell per several ticks)
    if (this.combatTick % 3 !== 0) return; // Move every 3 ticks

    const dx = Math.sign(target.gridX - unit.gridX);
    const dy = Math.sign(target.gridY - unit.gridY);

    // Try to move in primary direction
    const newX = unit.gridX + dx;
    const newY = unit.gridY + dy;

    if (this.canMoveTo(newX, newY)) {
      this.moveUnit(unit, newX, newY);
    } else if (dx !== 0 && this.canMoveTo(newX, unit.gridY)) {
      this.moveUnit(unit, newX, unit.gridY);
    } else if (dy !== 0 && this.canMoveTo(unit.gridX, newY)) {
      this.moveUnit(unit, unit.gridX, newY);
    }
  }

  private canMoveTo(x: number, y: number): boolean {
    if (x < 0 || x >= BATTLE_GRID_SIZE || y < 0 || y >= BATTLE_GRID_SIZE) {
      return false;
    }
    return this.grid[y][x].walkable && !this.grid[y][x].occupied;
  }

  private moveUnit(unit: BattleUnit, newX: number, newY: number): void {
    // Clear old position
    this.grid[unit.gridY][unit.gridX].occupied = false;
    this.grid[unit.gridY][unit.gridX].occupant = null;

    // Set new position
    unit.gridX = newX;
    unit.gridY = newY;
    this.grid[newY][newX].occupied = true;
    this.grid[newY][newX].occupant = unit;

    // Animate movement
    const worldX = this.gridStartX + newX * this.cellSize + this.cellSize / 2;
    const worldY = this.gridStartY + newY * this.cellSize + this.cellSize / 2;

    this.tweens.add({
      targets: [unit.sprite, unit.hpBar, unit.manaBar],
      x: worldX,
      y: worldY,
      duration: 150,
    });

    // Update bars position
    this.updateUnitBars(unit);
  }

  private performAttack(attacker: BattleUnit, target: BattleUnit): void {
    // Calculate damage
    const baseDamage = attacker.stats.attack;
    const defense = target.stats.defense;
    const damage = Math.max(1, baseDamage - defense / 2 + Phaser.Math.Between(-3, 3));

    target.stats.hp -= damage;

    // Visual feedback
    this.tweens.add({
      targets: attacker.sprite,
      x: target.sprite.x,
      duration: 50,
      yoyo: true,
    });

    this.tweens.add({
      targets: target.sprite,
      tint: 0xff0000,
      duration: 100,
      onComplete: () => target.sprite.clearTint(),
    });

    // Damage number
    const dmgText = this.add.text(target.sprite.x, target.sprite.y - 30, `-${Math.round(damage)}`, {
      fontSize: '14px',
      color: '#ff4444',
      fontStyle: 'bold',
    });
    dmgText.setOrigin(0.5);
    dmgText.setDepth(50);

    this.tweens.add({
      targets: dmgText,
      y: dmgText.y - 30,
      alpha: 0,
      duration: 800,
      onComplete: () => dmgText.destroy(),
    });

    // Attacker gains mana on hit
    attacker.stats.mana = Math.min(attacker.stats.maxMana, attacker.stats.mana + 10);

    this.updateUnitBars(target);
    this.updateUnitBars(attacker);

    // Check if target died
    if (target.stats.hp <= 0) {
      this.killUnit(target);
    }
  }

  private performUltimate(unit: BattleUnit): void {
    unit.stats.mana = 0;

    // Ultimate: AOE damage based on intelligence
    const damage = unit.stats.intelligence * 2;
    const enemies = unit.team === 'player' ? this.enemyUnits : this.playerUnits;

    // Visual effect
    const circle = this.add.circle(unit.sprite.x, unit.sprite.y, 10, 0xffd700, 0.8);
    circle.setDepth(5);

    this.tweens.add({
      targets: circle,
      radius: 100,
      alpha: 0,
      duration: 500,
      onComplete: () => circle.destroy(),
    });

    // Damage all enemies
    for (const enemy of enemies) {
      if (enemy.stats.hp <= 0) continue;

      const distance = this.getGridDistance(unit, enemy);
      if (distance <= 3) {
        const actualDamage = Math.max(1, damage - enemy.stats.defense / 3);
        enemy.stats.hp -= actualDamage;
        this.updateUnitBars(enemy);

        if (enemy.stats.hp <= 0) {
          this.killUnit(enemy);
        }
      }
    }

    this.updateUnitBars(unit);
  }

  private killUnit(unit: BattleUnit): void {
    // Clear grid
    this.grid[unit.gridY][unit.gridX].occupied = false;
    this.grid[unit.gridY][unit.gridX].occupant = null;

    // Death animation
    this.tweens.add({
      targets: [unit.sprite, unit.hpBar, unit.manaBar],
      alpha: 0,
      scale: 0.5,
      duration: 300,
      onComplete: () => {
        unit.sprite.destroy();
        unit.hpBar.destroy();
        unit.manaBar.destroy();
      },
    });
  }

  private checkBattleEnd(): void {
    const alivePlayerUnits = this.playerUnits.filter((u) => u.stats.hp > 0);
    const aliveEnemyUnits = this.enemyUnits.filter((u) => u.stats.hp > 0);

    if (aliveEnemyUnits.length === 0) {
      this.endBattle('victory');
    } else if (alivePlayerUnits.length === 0) {
      this.endBattle('defeat');
    }
  }

  private endBattle(result: 'victory' | 'defeat'): void {
    this.phase = result;

    // Stop combat loop
    this.time.removeAllEvents();

    // Show result
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.7);
    overlay.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    overlay.setDepth(200);

    const resultText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, result.toUpperCase(), {
      fontSize: '48px',
      color: result === 'victory' ? '#32cd32' : '#dc143c',
      fontStyle: 'bold',
    });
    resultText.setOrigin(0.5);
    resultText.setDepth(201);

    const continueBtn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'Continue', {
      fontSize: '20px',
      color: '#ffffff',
      backgroundColor: '#4a90d9',
      padding: { x: 20, y: 10 },
    });
    continueBtn.setOrigin(0.5);
    continueBtn.setDepth(201);
    continueBtn.setInteractive();
    continueBtn.on('pointerdown', () => this.scene.start('WorldScene'));
  }

  update(): void {
    // Main game loop updates handled by combatLoop timer
  }
}
