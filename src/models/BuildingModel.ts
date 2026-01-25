export type BuildingType = 'gate' | 'inn' | 'barracks' | 'farm' | 'mine' | 'lumberyard' | 'tower' | 'market';

export interface BuildingCost {
  gold: number;
  wood: number;
  stone: number;
  food?: number;
}

export interface BuildingProduction {
  resource: string;
  baseRate: number;
  interval: number; // seconds
}

export interface BuildingConfig {
  type: BuildingType;
  name: string;
  description: string;
  gridWidth: number;
  gridHeight: number;
  baseCost: BuildingCost;
  production?: BuildingProduction;
  maxLevel: number;
  unlockLevel: number;
  hospitalityBonus: number;
}

export class BuildingModel {
  public id: string;
  public type: BuildingType;
  public level: number;
  public gridX: number;
  public gridY: number;
  public isConstructed: boolean;
  public constructionProgress: number;
  public lastCollectionTime: number;
  public storedResources: number;

  private config: BuildingConfig;

  constructor(
    type: BuildingType,
    gridX: number,
    gridY: number,
    level: number = 1
  ) {
    this.id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.type = type;
    this.level = level;
    this.gridX = gridX;
    this.gridY = gridY;
    this.isConstructed = true;
    this.constructionProgress = 100;
    this.lastCollectionTime = Date.now();
    this.storedResources = 0;
    this.config = BuildingModel.getBuildingConfig(type);
  }

  public static getBuildingConfig(type: BuildingType): BuildingConfig {
    const configs: Record<BuildingType, BuildingConfig> = {
      gate: {
        type: 'gate',
        name: 'Kingdom Gate',
        description: 'The entrance to your kingdom. Visitors arrive here.',
        gridWidth: 2,
        gridHeight: 2,
        baseCost: { gold: 0, wood: 0, stone: 0 },
        maxLevel: 10,
        unlockLevel: 1,
        hospitalityBonus: 5,
      },
      inn: {
        type: 'inn',
        name: 'Inn',
        description: 'Welcomes visitors and increases hospitality.',
        gridWidth: 2,
        gridHeight: 2,
        baseCost: { gold: 100, wood: 50, stone: 30 },
        production: { resource: 'happiness', baseRate: 5, interval: 60 },
        maxLevel: 10,
        unlockLevel: 1,
        hospitalityBonus: 20,
      },
      barracks: {
        type: 'barracks',
        name: 'Barracks',
        description: 'Trains soldiers and stores military equipment.',
        gridWidth: 3,
        gridHeight: 3,
        baseCost: { gold: 200, wood: 80, stone: 100 },
        maxLevel: 10,
        unlockLevel: 2,
        hospitalityBonus: 5,
      },
      farm: {
        type: 'farm',
        name: 'Farm',
        description: 'Produces food for your kingdom.',
        gridWidth: 2,
        gridHeight: 2,
        baseCost: { gold: 80, wood: 60, stone: 20 },
        production: { resource: 'food', baseRate: 10, interval: 30 },
        maxLevel: 10,
        unlockLevel: 1,
        hospitalityBonus: 10,
      },
      mine: {
        type: 'mine',
        name: 'Mine',
        description: 'Extracts stone from the ground.',
        gridWidth: 2,
        gridHeight: 2,
        baseCost: { gold: 120, wood: 40, stone: 60 },
        production: { resource: 'stone', baseRate: 5, interval: 45 },
        maxLevel: 10,
        unlockLevel: 2,
        hospitalityBonus: 0,
      },
      lumberyard: {
        type: 'lumberyard',
        name: 'Lumberyard',
        description: 'Produces wood from nearby forests.',
        gridWidth: 2,
        gridHeight: 2,
        baseCost: { gold: 100, wood: 30, stone: 40 },
        production: { resource: 'wood', baseRate: 8, interval: 40 },
        maxLevel: 10,
        unlockLevel: 2,
        hospitalityBonus: 5,
      },
      tower: {
        type: 'tower',
        name: 'Watch Tower',
        description: 'Defends the kingdom and spots incoming threats.',
        gridWidth: 1,
        gridHeight: 1,
        baseCost: { gold: 150, wood: 50, stone: 80 },
        maxLevel: 10,
        unlockLevel: 3,
        hospitalityBonus: 0,
      },
      market: {
        type: 'market',
        name: 'Market',
        description: 'Generates gold through trade.',
        gridWidth: 3,
        gridHeight: 2,
        baseCost: { gold: 250, wood: 100, stone: 80 },
        production: { resource: 'gold', baseRate: 15, interval: 60 },
        maxLevel: 10,
        unlockLevel: 3,
        hospitalityBonus: 15,
      },
    };
    return configs[type];
  }

  public getConfig(): BuildingConfig {
    return this.config;
  }

  public getGridSize(): { width: number; height: number } {
    return {
      width: this.config.gridWidth,
      height: this.config.gridHeight,
    };
  }

  public getUpgradeCost(): BuildingCost {
    const multiplier = Math.pow(1.5, this.level);
    return {
      gold: Math.floor(this.config.baseCost.gold * multiplier),
      wood: Math.floor(this.config.baseCost.wood * multiplier),
      stone: Math.floor(this.config.baseCost.stone * multiplier),
      food: this.config.baseCost.food
        ? Math.floor(this.config.baseCost.food * multiplier)
        : undefined,
    };
  }

  public canUpgrade(): boolean {
    return this.level < this.config.maxLevel;
  }

  public upgrade(): boolean {
    if (!this.canUpgrade()) return false;
    this.level++;
    return true;
  }

  public getProductionRate(): number {
    if (!this.config.production) return 0;
    return this.config.production.baseRate * (1 + (this.level - 1) * 0.2);
  }

  public getHospitalityBonus(): number {
    return this.config.hospitalityBonus * this.level;
  }

  public updateProduction(): number {
    if (!this.config.production) return 0;

    const now = Date.now();
    const elapsed = (now - this.lastCollectionTime) / 1000; // seconds
    const cycles = Math.floor(elapsed / this.config.production.interval);

    if (cycles > 0) {
      const produced = cycles * this.getProductionRate();
      this.storedResources += produced;
      this.lastCollectionTime = now;
      return produced;
    }

    return 0;
  }

  public collectResources(): { resource: string; amount: number } | null {
    if (!this.config.production || this.storedResources <= 0) return null;

    const collected = Math.floor(this.storedResources);
    this.storedResources = 0;

    return {
      resource: this.config.production.resource,
      amount: collected,
    };
  }

  public toJSON(): BuildingSaveData {
    return {
      id: this.id,
      type: this.type,
      level: this.level,
      gridX: this.gridX,
      gridY: this.gridY,
      isConstructed: this.isConstructed,
      constructionProgress: this.constructionProgress,
      lastCollectionTime: this.lastCollectionTime,
      storedResources: this.storedResources,
    };
  }

  public static fromJSON(data: BuildingSaveData): BuildingModel {
    const building = new BuildingModel(
      data.type,
      data.gridX,
      data.gridY,
      data.level
    );
    building.id = data.id;
    building.isConstructed = data.isConstructed;
    building.constructionProgress = data.constructionProgress;
    building.lastCollectionTime = data.lastCollectionTime;
    building.storedResources = data.storedResources;
    return building;
  }
}

export interface BuildingSaveData {
  id: string;
  type: BuildingType;
  level: number;
  gridX: number;
  gridY: number;
  isConstructed: boolean;
  constructionProgress: number;
  lastCollectionTime: number;
  storedResources: number;
}
