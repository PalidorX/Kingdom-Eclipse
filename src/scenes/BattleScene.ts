import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, BATTLE_GRID_SIZE } from '../config/constants';

type BattlePhase = 'setup' | 'combat' | 'victory' | 'defeat';

// 32px tiles, characters are 2 tiles tall (32x64)
const TILE_SIZE = 32;

// Color palette matching KingdomScene
const PALETTE = {
  skin: 0xffd8b8,
  skinShadow: 0xe8c8a8,
  hair: 0x4a3728,

  // Team colors
  playerShirt: 0x4466cc,
  playerHighlight: 0x5588ee,
  playerPants: 0x444466,

  enemyShirt: 0xcc4444,
  enemyHighlight: 0xee6666,
  enemyPants: 0x664444,

  // Grid
  gridLight: 0x4a6080,
  gridDark: 0x2d4060,
  gridHighlight: 0x4a90d9,
  obstacle: 0x6b6b6b,
};

interface BattleUnit {
  id: string;
  team: 'player' | 'enemy';
  container: Phaser.GameObjects.Container;
  graphics: Phaser.GameObjects.Graphics;
  gridX: number;
  gridY: number;
  stats: {
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
    attack: number;
    defense: number;
    dexterity: number;
    intelligence: number;
  };
  attackCooldown: number;
  currentCooldown: number;
  target: BattleUnit | null;
  hpBar: Phaser.GameObjects.Graphics;
  manaBar: Phaser.GameObjects.Graphics;
  direction: 'left' | 'right';
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

  private playerUnits: BattleUnit[] = [];
  private enemyUnits: BattleUnit[] = [];
  private allUnits: BattleUnit[] = [];

  private phase: BattlePhase = 'setup';
  private combatTick: number = 0;
  private tickRate: number = 100;

  private benchUnits: Phaser.GameObjects.Container[] = [];
  private validPlacementCells: { x: number; y: number }[] = [];

  constructor() {
    super({ key: 'BattleScene' });
  }

  create(): void {
    this.resetState();
    this.calculateGridPosition();
    this.initializeGrid();
    this.createBattleGrid();
    this.generateObstacles();
    this.spawnEnemies();
    this.createBench();
    this.createUI();

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
    const gridPixelSize = BATTLE_GRID_SIZE * TILE_SIZE;
    this.gridStartX = (GAME_WIDTH - gridPixelSize) / 2;
    this.gridStartY = 70;
  }

  private initializeGrid(): void {
    for (let y = 0; y < BATTLE_GRID_SIZE; y++) {
      this.grid[y] = [];
      for (let x = 0; x < BATTLE_GRID_SIZE; x++) {
        this.grid[y][x] = {
          x, y,
          walkable: true,
          occupied: false,
          occupant: null,
        };
      }
    }

    this.validPlacementCells = [];
    for (let y = BATTLE_GRID_SIZE - 2; y < BATTLE_GRID_SIZE; y++) {
      for (let x = 0; x < BATTLE_GRID_SIZE; x++) {
        this.validPlacementCells.push({ x, y });
      }
    }
  }

  private createBattleGrid(): void {
    this.gridGraphics = this.add.graphics();

    for (let y = 0; y < BATTLE_GRID_SIZE; y++) {
      for (let x = 0; x < BATTLE_GRID_SIZE; x++) {
        const worldX = this.gridStartX + x * TILE_SIZE;
        const worldY = this.gridStartY + y * TILE_SIZE;

        const isLight = (x + y) % 2 === 0;
        const color = isLight ? PALETTE.gridLight : PALETTE.gridDark;

        this.gridGraphics.fillStyle(color, 1);
        this.gridGraphics.fillRect(worldX, worldY, TILE_SIZE, TILE_SIZE);

        if (this.validPlacementCells.some(c => c.x === x && c.y === y)) {
          this.gridGraphics.fillStyle(PALETTE.gridHighlight, 0.2);
          this.gridGraphics.fillRect(worldX, worldY, TILE_SIZE, TILE_SIZE);
        }

        this.gridGraphics.lineStyle(1, 0x1a202c, 0.5);
        this.gridGraphics.strokeRect(worldX, worldY, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private generateObstacles(): void {
    const obstacleCount = Phaser.Math.Between(2, 4);

    for (let i = 0; i < obstacleCount; i++) {
      const x = Phaser.Math.Between(1, BATTLE_GRID_SIZE - 2);
      const y = Phaser.Math.Between(2, BATTLE_GRID_SIZE - 3);

      if (this.grid[y][x].walkable && !this.grid[y][x].occupied) {
        this.grid[y][x].walkable = false;

        const worldX = this.gridStartX + x * TILE_SIZE;
        const worldY = this.gridStartY + y * TILE_SIZE;

        // Draw rock obstacle
        this.gridGraphics.fillStyle(PALETTE.obstacle, 1);
        this.gridGraphics.fillRect(worldX + 4, worldY + 8, TILE_SIZE - 8, TILE_SIZE - 10);
        this.gridGraphics.fillStyle(0x888888, 1);
        this.gridGraphics.fillRect(worldX + 6, worldY + 10, TILE_SIZE - 14, 6);
      }
    }
  }

  private spawnEnemies(): void {
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
    const worldX = this.gridStartX + gridX * TILE_SIZE + TILE_SIZE / 2;
    const worldY = this.gridStartY + gridY * TILE_SIZE + TILE_SIZE;

    const container = this.add.container(worldX, worldY);
    const graphics = this.add.graphics();
    container.add(graphics);

    this.drawUnitGraphics(graphics, team, team === 'player' ? 'right' : 'left');

    container.setDepth(10 + gridY);

    const baseStats = {
      hp: Phaser.Math.Between(80, 120),
      mana: 0,
      attack: Phaser.Math.Between(10, 20),
      defense: Phaser.Math.Between(5, 15),
      dexterity: Phaser.Math.Between(5, 15),
      intelligence: Phaser.Math.Between(5, 15),
    };

    const hpBar = this.add.graphics();
    hpBar.setDepth(50);
    const manaBar = this.add.graphics();
    manaBar.setDepth(50);

    const unit: BattleUnit = {
      id: `${team}-${Date.now()}-${Phaser.Math.Between(0, 999)}`,
      team,
      container,
      graphics,
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
      direction: team === 'player' ? 'right' : 'left',
    };

    this.updateUnitBars(unit);

    this.grid[gridY][gridX].occupied = true;
    this.grid[gridY][gridX].occupant = unit;

    if (team === 'player') {
      this.playerUnits.push(unit);
    } else {
      this.enemyUnits.push(unit);
    }
    this.allUnits.push(unit);

    return unit;
  }

  private drawUnitGraphics(
    graphics: Phaser.GameObjects.Graphics,
    team: string,
    direction: string
  ): void {
    graphics.clear();

    // Characters are 32x64 (2 tiles tall)
    const shirtColor = team === 'player' ? PALETTE.playerShirt : PALETTE.enemyShirt;
    const shirtHighlight = team === 'player' ? PALETTE.playerHighlight : PALETTE.enemyHighlight;
    const pantsColor = team === 'player' ? PALETTE.playerPants : PALETTE.enemyPants;

    // Shadow
    graphics.fillStyle(0x000000, 0.3);
    graphics.fillEllipse(0, 0, 24, 8);

    // Legs/pants
    graphics.fillStyle(pantsColor, 1);
    graphics.fillRect(-8, -16, 7, 16);
    graphics.fillRect(1, -16, 7, 16);

    // Feet
    graphics.fillStyle(0x443322, 1);
    graphics.fillRect(-9, -4, 8, 4);
    graphics.fillRect(1, -4, 8, 4);

    // Body/shirt
    graphics.fillStyle(shirtColor, 1);
    graphics.fillRect(-10, -36, 20, 22);
    graphics.fillStyle(shirtHighlight, 1);
    graphics.fillRect(-8, -34, 6, 16);

    // Arms
    graphics.fillStyle(shirtColor, 1);
    graphics.fillRect(-14, -34, 5, 18);
    graphics.fillRect(9, -34, 5, 18);
    // Hands
    graphics.fillStyle(PALETTE.skin, 1);
    graphics.fillRect(-13, -18, 4, 6);
    graphics.fillRect(9, -18, 4, 6);

    // Head
    graphics.fillStyle(PALETTE.skin, 1);
    graphics.fillCircle(0, -46, 10);
    graphics.fillStyle(PALETTE.skinShadow, 1);
    graphics.fillRect(-8, -46, 4, 8);

    // Hair
    graphics.fillStyle(PALETTE.hair, 1);
    graphics.fillRect(-10, -56, 20, 10);
    graphics.fillRect(-10, -52, 20, 4);

    if (direction === 'left') {
      graphics.fillRect(-12, -54, 4, 10);
    } else if (direction === 'right') {
      graphics.fillRect(8, -54, 4, 10);
    }

    // Eyes
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(-6, -48, 5, 4);
    graphics.fillRect(1, -48, 5, 4);
    graphics.fillStyle(0x000000, 1);
    if (direction === 'left') {
      graphics.fillRect(-5, -47, 2, 3);
      graphics.fillRect(2, -47, 2, 3);
    } else {
      graphics.fillRect(-3, -47, 2, 3);
      graphics.fillRect(4, -47, 2, 3);
    }

    // Mouth
    graphics.fillStyle(0x000000, 0.3);
    graphics.fillRect(-3, -40, 6, 2);

    // Weapon indicator for enemies (sword/axe shape)
    if (team === 'enemy') {
      graphics.fillStyle(0x888888, 1);
      graphics.fillRect(12, -30, 3, 16);
      graphics.fillStyle(0xaaaaaa, 1);
      graphics.fillRect(10, -32, 7, 4);
    }
  }

  private calculateAttackCooldown(dexterity: number): number {
    return Math.max(5, 25 - dexterity);
  }

  private updateUnitBars(unit: BattleUnit): void {
    const barWidth = 28;
    const barHeight = 4;
    const barX = unit.container.x - barWidth / 2;
    const hpBarY = unit.container.y - 66;
    const manaBarY = hpBarY + 6;

    unit.hpBar.clear();
    unit.hpBar.fillStyle(0x333333, 1);
    unit.hpBar.fillRect(barX, hpBarY, barWidth, barHeight);
    unit.hpBar.fillStyle(0x32cd32, 1);
    const hpWidth = Math.max(0, (unit.stats.hp / unit.stats.maxHp) * barWidth);
    unit.hpBar.fillRect(barX, hpBarY, hpWidth, barHeight);

    unit.manaBar.clear();
    unit.manaBar.fillStyle(0x333333, 1);
    unit.manaBar.fillRect(barX, manaBarY, barWidth, barHeight);
    unit.manaBar.fillStyle(0x4a90d9, 1);
    const manaWidth = (unit.stats.mana / unit.stats.maxMana) * barWidth;
    unit.manaBar.fillRect(barX, manaBarY, manaWidth, barHeight);
  }

  private createBench(): void {
    const benchY = GAME_HEIGHT - 90;
    const benchBg = this.add.graphics();
    benchBg.fillStyle(0x1a2040, 0.95);
    benchBg.fillRect(0, benchY - 20, GAME_WIDTH, 100);
    benchBg.lineStyle(2, 0x4080c0, 1);
    benchBg.lineBetween(0, benchY - 20, GAME_WIDTH, benchY - 20);

    const benchLabel = this.add.text(GAME_WIDTH / 2, benchY - 8, 'Drag units to battle grid', {
      fontSize: '11px',
      color: '#888899',
    });
    benchLabel.setOrigin(0.5);

    const unitCount = 4;
    const spacing = GAME_WIDTH / (unitCount + 1);

    for (let i = 0; i < unitCount; i++) {
      const x = spacing * (i + 1);
      const container = this.add.container(x, benchY + 40);

      const graphics = this.add.graphics();
      this.drawUnitGraphics(graphics, 'player', 'right');
      container.add(graphics);

      container.setSize(TILE_SIZE, TILE_SIZE * 2);
      container.setInteractive({ draggable: true });

      const originalX = x;
      const originalY = benchY + 40;

      container.on('dragstart', () => {
        container.setAlpha(0.8);
        container.setDepth(100);
      });

      container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        container.x = dragX;
        container.y = dragY;
      });

      container.on('dragend', (pointer: Phaser.Input.Pointer) => {
        container.setAlpha(1);
        container.setDepth(1);

        const gridX = Math.floor((pointer.x - this.gridStartX) / TILE_SIZE);
        const gridY = Math.floor((pointer.y - this.gridStartY) / TILE_SIZE);

        if (this.isValidPlacement(gridX, gridY)) {
          this.createUnit('player', gridX, gridY);
          container.destroy();
          const index = this.benchUnits.indexOf(container);
          if (index > -1) this.benchUnits.splice(index, 1);
        } else {
          container.x = originalX;
          container.y = originalY;
        }
      });

      this.benchUnits.push(container);
    }
  }

  private isValidPlacement(gridX: number, gridY: number): boolean {
    if (gridX < 0 || gridX >= BATTLE_GRID_SIZE || gridY < 0 || gridY >= BATTLE_GRID_SIZE) {
      return false;
    }

    const isValidCell = this.validPlacementCells.some(c => c.x === gridX && c.y === gridY);
    const cell = this.grid[gridY]?.[gridX];

    return isValidCell && cell && cell.walkable && !cell.occupied;
  }

  private createUI(): void {
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a2040, 0.95);
    headerBg.fillRect(0, 0, GAME_WIDTH, 55);
    headerBg.lineStyle(2, 0x4080c0, 1);
    headerBg.lineBetween(0, 55, GAME_WIDTH, 55);
    headerBg.setDepth(100);

    const title = this.add.text(GAME_WIDTH / 2, 16, 'BATTLE', {
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    title.setOrigin(0.5, 0);
    title.setDepth(101);

    const phaseText = this.add.text(GAME_WIDTH / 2, 38, 'Setup Phase - Place Your Units', {
      fontSize: '11px',
      color: '#4a90d9',
    });
    phaseText.setOrigin(0.5);
    phaseText.setDepth(101);
    this.data.set('phaseText', phaseText);

    const backBtn = this.add.text(15, 28, '< EXIT', {
      fontSize: '11px',
      color: '#cc4444',
      fontFamily: 'monospace',
    });
    backBtn.setOrigin(0, 0.5);
    backBtn.setDepth(101);
    backBtn.setInteractive();
    backBtn.on('pointerdown', () => this.scene.start('WorldScene'));
    backBtn.on('pointerover', () => backBtn.setColor('#ff6666'));
    backBtn.on('pointerout', () => backBtn.setColor('#cc4444'));

    const startBg = this.add.graphics();
    startBg.fillStyle(0x44aa44, 1);
    startBg.fillRoundedRect(GAME_WIDTH - 100, 18, 85, 26, 4);
    startBg.setDepth(101);

    const startBtn = this.add.text(GAME_WIDTH - 58, 31, 'START', {
      fontSize: '12px',
      color: '#ffffff',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    startBtn.setOrigin(0.5);
    startBtn.setDepth(102);

    startBg.setInteractive(new Phaser.Geom.Rectangle(GAME_WIDTH - 100, 18, 85, 26), Phaser.Geom.Rectangle.Contains);
    startBg.on('pointerdown', () => this.startCombat());

    this.data.set('startBtn', startBtn);
    this.data.set('startBg', startBg);
  }

  private startCombat(): void {
    if (this.playerUnits.length === 0) {
      this.cameras.main.shake(100, 0.01);
      return;
    }

    this.phase = 'combat';

    const phaseText = this.data.get('phaseText') as Phaser.GameObjects.Text;
    phaseText.setText('Combat Phase');
    phaseText.setColor('#cc4444');

    const startBtn = this.data.get('startBtn') as Phaser.GameObjects.Text;
    const startBg = this.data.get('startBg') as Phaser.GameObjects.Graphics;
    startBtn.setVisible(false);
    startBg.setVisible(false);

    this.benchUnits.forEach(u => u.destroy());
    this.benchUnits = [];

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

    for (const unit of this.allUnits) {
      if (unit.stats.hp <= 0) continue;

      unit.currentCooldown--;

      if (!unit.target || unit.target.stats.hp <= 0) {
        unit.target = this.findNearestEnemy(unit);
      }

      if (unit.target) {
        const distance = this.getGridDistance(unit, unit.target);

        // Update facing direction
        if (unit.target.gridX < unit.gridX && unit.direction !== 'left') {
          unit.direction = 'left';
          this.drawUnitGraphics(unit.graphics, unit.team, 'left');
        } else if (unit.target.gridX > unit.gridX && unit.direction !== 'right') {
          unit.direction = 'right';
          this.drawUnitGraphics(unit.graphics, unit.team, 'right');
        }

        if (distance <= 1.5) {
          if (unit.currentCooldown <= 0) {
            this.performAttack(unit, unit.target);
            unit.currentCooldown = unit.attackCooldown;
          }
        } else {
          this.moveTowardsTarget(unit, unit.target);
        }
      }

      unit.stats.mana = Math.min(unit.stats.maxMana, unit.stats.mana + 1);
      this.updateUnitBars(unit);

      if (unit.stats.mana >= unit.stats.maxMana) {
        this.performUltimate(unit);
      }
    }

    this.checkBattleEnd();
  }

  private findNearestEnemy(unit: BattleUnit): BattleUnit | null {
    const enemies = unit.team === 'player' ? this.enemyUnits : this.playerUnits;
    const aliveEnemies = enemies.filter(e => e.stats.hp > 0);

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
    if (this.combatTick % 3 !== 0) return;

    const dx = Math.sign(target.gridX - unit.gridX);
    const dy = Math.sign(target.gridY - unit.gridY);

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
    this.grid[unit.gridY][unit.gridX].occupied = false;
    this.grid[unit.gridY][unit.gridX].occupant = null;

    unit.gridX = newX;
    unit.gridY = newY;
    this.grid[newY][newX].occupied = true;
    this.grid[newY][newX].occupant = unit;

    const worldX = this.gridStartX + newX * TILE_SIZE + TILE_SIZE / 2;
    const worldY = this.gridStartY + newY * TILE_SIZE + TILE_SIZE;

    this.tweens.add({
      targets: unit.container,
      x: worldX,
      y: worldY,
      duration: 150,
      onUpdate: () => this.updateUnitBars(unit),
      onComplete: () => {
        unit.container.setDepth(10 + newY);
      },
    });
  }

  private performAttack(attacker: BattleUnit, target: BattleUnit): void {
    const baseDamage = attacker.stats.attack;
    const defense = target.stats.defense;
    const damage = Math.max(1, baseDamage - defense / 2 + Phaser.Math.Between(-3, 3));

    target.stats.hp -= damage;

    // Attack lunge animation
    const lungeX = target.container.x > attacker.container.x ? 8 : -8;
    this.tweens.add({
      targets: attacker.container,
      x: attacker.container.x + lungeX,
      duration: 50,
      yoyo: true,
    });

    // Hit flash - shake the container
    this.tweens.add({
      targets: target.container,
      x: target.container.x + 4,
      duration: 30,
      yoyo: true,
      repeat: 2,
    });

    // Damage number
    const dmgText = this.add.text(target.container.x, target.container.y - 70, `-${Math.round(damage)}`, {
      fontSize: '14px',
      color: '#ff4444',
      fontStyle: 'bold',
    });
    dmgText.setOrigin(0.5);
    dmgText.setDepth(60);

    this.tweens.add({
      targets: dmgText,
      y: dmgText.y - 25,
      alpha: 0,
      duration: 600,
      onComplete: () => dmgText.destroy(),
    });

    attacker.stats.mana = Math.min(attacker.stats.maxMana, attacker.stats.mana + 10);

    this.updateUnitBars(target);
    this.updateUnitBars(attacker);

    if (target.stats.hp <= 0) {
      this.killUnit(target);
    }
  }

  private performUltimate(unit: BattleUnit): void {
    unit.stats.mana = 0;

    const damage = unit.stats.intelligence * 2;
    const enemies = unit.team === 'player' ? this.enemyUnits : this.playerUnits;

    const circle = this.add.circle(unit.container.x, unit.container.y - 30, 10, 0xffd700, 0.8);
    circle.setDepth(5);

    this.tweens.add({
      targets: circle,
      radius: 80,
      alpha: 0,
      duration: 400,
      onComplete: () => circle.destroy(),
    });

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
    this.grid[unit.gridY][unit.gridX].occupied = false;
    this.grid[unit.gridY][unit.gridX].occupant = null;

    this.tweens.add({
      targets: [unit.container, unit.hpBar, unit.manaBar],
      alpha: 0,
      scaleX: 0.5,
      scaleY: 0.5,
      duration: 300,
      onComplete: () => {
        unit.container.destroy();
        unit.hpBar.destroy();
        unit.manaBar.destroy();
      },
    });
  }

  private checkBattleEnd(): void {
    const alivePlayerUnits = this.playerUnits.filter(u => u.stats.hp > 0);
    const aliveEnemyUnits = this.enemyUnits.filter(u => u.stats.hp > 0);

    if (aliveEnemyUnits.length === 0) {
      this.endBattle('victory');
    } else if (alivePlayerUnits.length === 0) {
      this.endBattle('defeat');
    }
  }

  private endBattle(result: 'victory' | 'defeat'): void {
    this.phase = result;
    this.time.removeAllEvents();

    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.7);
    overlay.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    overlay.setDepth(200);

    const resultText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, result.toUpperCase(), {
      fontSize: '36px',
      color: result === 'victory' ? '#44dd44' : '#dd4444',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    resultText.setOrigin(0.5);
    resultText.setDepth(201);

    const continueBg = this.add.graphics();
    continueBg.fillStyle(0x4080c0, 1);
    continueBg.fillRoundedRect(GAME_WIDTH / 2 - 60, GAME_HEIGHT / 2 + 20, 120, 40, 6);
    continueBg.setDepth(201);

    const continueBtn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'Continue', {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'monospace',
    });
    continueBtn.setOrigin(0.5);
    continueBtn.setDepth(202);

    continueBg.setInteractive(new Phaser.Geom.Rectangle(GAME_WIDTH / 2 - 60, GAME_HEIGHT / 2 + 20, 120, 40), Phaser.Geom.Rectangle.Contains);
    continueBg.on('pointerdown', () => this.scene.start('WorldScene'));
  }

  update(): void {
    // Combat handled by timer
  }
}
