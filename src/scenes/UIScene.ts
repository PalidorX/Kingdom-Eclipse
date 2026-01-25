import Phaser from 'phaser';

interface VisitorData {
  id: string;
  name: string;
  stats: {
    hp: number;
    attack: number;
    defense: number;
    dexterity: number;
    intelligence: number;
  };
  wishlist: {
    requirement: string;
    met: boolean;
  }[];
}

interface BuildingData {
  type: string;
  level: number;
  production: {
    resource: string;
    rate: number;
  };
  upgradeCost: {
    gold: number;
    wood: number;
    stone: number;
  };
}

export class UIScene extends Phaser.Scene {
  private overlayContainer: HTMLDivElement | null = null;
  private currentPanel: HTMLDivElement | null = null;

  // Player resources (would be stored in a game state manager in production)
  private resources = {
    gold: 500,
    wood: 200,
    stone: 150,
    food: 300,
  };

  private kingdomLevel = 1;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    this.createOverlayContainer();
    this.createResourceBar();
    this.setupEventListeners();
  }

  private createOverlayContainer(): void {
    // Create main overlay container
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'ui-overlay';
    this.overlayContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
    `;
    document.getElementById('game-container')?.appendChild(this.overlayContainer);
  }

  private createResourceBar(): void {
    if (!this.overlayContainer) return;

    const resourceBar = document.createElement('div');
    resourceBar.id = 'resource-bar';
    resourceBar.style.cssText = `
      position: absolute;
      top: 60px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: space-around;
      padding: 8px;
      background: linear-gradient(180deg, rgba(26, 26, 46, 0.9) 0%, transparent 100%);
      pointer-events: none;
    `;

    const resources = [
      { key: 'gold', icon: '🪙', color: '#ffd700' },
      { key: 'wood', icon: '🪵', color: '#8b4513' },
      { key: 'stone', icon: '🪨', color: '#808080' },
      { key: 'food', icon: '🌾', color: '#90ee90' },
    ];

    resources.forEach(({ key, icon, color }) => {
      const item = document.createElement('div');
      item.id = `resource-${key}`;
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 4px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        color: ${color};
      `;
      item.innerHTML = `${icon} <span>${this.resources[key as keyof typeof this.resources]}</span>`;
      resourceBar.appendChild(item);
    });

    this.overlayContainer.appendChild(resourceBar);
  }

  private updateResourceDisplay(): void {
    Object.entries(this.resources).forEach(([key, value]) => {
      const element = document.querySelector(`#resource-${key} span`);
      if (element) {
        element.textContent = value.toString();
      }
    });
  }

  private setupEventListeners(): void {
    // Listen for events from other scenes
    const worldScene = this.scene.get('WorldScene');
    const kingdomScene = this.scene.get('KingdomScene');

    worldScene.events.on('resource-collected', (data: { type: string; amount: number }) => {
      this.collectResource(data.type, data.amount);
    });

    kingdomScene.events.on('visitor-selected', (data: { id: string; x: number; y: number }) => {
      this.showVisitorPanel(data.id);
    });

    kingdomScene.events.on('building-selected', (data: { type: string; gridX: number; gridY: number }) => {
      this.showBuildingPanel(data.type);
    });
  }

  private collectResource(type: string, amount: number): void {
    if (type in this.resources) {
      this.resources[type as keyof typeof this.resources] += amount;
      this.updateResourceDisplay();
      this.showNotification(`+${amount} ${type}`, '#ffd700');
    }
  }

  private showNotification(message: string, color: string): void {
    if (!this.overlayContainer) return;

    const notification = document.createElement('div');
    notification.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 16px 32px;
      background: rgba(0, 0, 0, 0.8);
      color: ${color};
      font-family: 'Courier New', monospace;
      font-size: 18px;
      font-weight: bold;
      border-radius: 8px;
      pointer-events: none;
      animation: fadeInOut 1.5s ease-in-out forwards;
    `;
    notification.textContent = message;
    this.overlayContainer.appendChild(notification);

    setTimeout(() => notification.remove(), 1500);
  }

  private showVisitorPanel(visitorId: string): void {
    // Generate mock visitor data
    const visitor: VisitorData = this.generateVisitorData(visitorId);
    this.closeCurrentPanel();

    const panel = this.createPanel('Visitor');

    // Visitor info
    const infoSection = document.createElement('div');
    infoSection.innerHTML = `
      <h3 style="margin: 0 0 12px; color: #ffa500;">${visitor.name}</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
        <div>HP: ${visitor.stats.hp}</div>
        <div>ATK: ${visitor.stats.attack}</div>
        <div>DEF: ${visitor.stats.defense}</div>
        <div>DEX: ${visitor.stats.dexterity}</div>
        <div>INT: ${visitor.stats.intelligence}</div>
      </div>
    `;
    panel.appendChild(infoSection);

    // Wishlist section
    const wishlistSection = document.createElement('div');
    wishlistSection.innerHTML = `<h4 style="margin: 0 0 8px; color: #4a90d9;">Wishlist</h4>`;

    const wishlistList = document.createElement('ul');
    wishlistList.style.cssText = 'list-style: none; padding: 0; margin: 0 0 16px;';

    visitor.wishlist.forEach((item) => {
      const li = document.createElement('li');
      li.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
        color: ${item.met ? '#32cd32' : '#888888'};
      `;
      li.innerHTML = `
        <span style="font-size: 14px;">${item.met ? '✓' : '○'}</span>
        <span>${item.requirement}</span>
      `;
      wishlistList.appendChild(li);
    });
    wishlistSection.appendChild(wishlistList);
    panel.appendChild(wishlistSection);

    // Recruit button
    const allMet = visitor.wishlist.every((w) => w.met);
    const recruitBtn = document.createElement('button');
    recruitBtn.textContent = 'Recruit';
    recruitBtn.disabled = !allMet;
    recruitBtn.style.cssText = `
      width: 100%;
      padding: 12px;
      background: ${allMet ? '#32cd32' : '#444444'};
      color: ${allMet ? '#ffffff' : '#888888'};
      border: none;
      border-radius: 4px;
      font-size: 16px;
      font-weight: bold;
      cursor: ${allMet ? 'pointer' : 'not-allowed'};
      pointer-events: auto;
    `;
    recruitBtn.onclick = () => {
      if (allMet) {
        this.recruitVisitor(visitorId);
        this.closeCurrentPanel();
      }
    };
    panel.appendChild(recruitBtn);

    this.overlayContainer?.appendChild(panel);
    this.currentPanel = panel;
  }

  private generateVisitorData(id: string): VisitorData {
    const names = ['Sir Roland', 'Lady Elara', 'Grimgor the Bold', 'Sage Mira', 'Scout Finn'];
    const randomName = names[Math.floor(Math.random() * names.length)];

    return {
      id,
      name: randomName,
      stats: {
        hp: 80 + Math.floor(Math.random() * 40),
        attack: 10 + Math.floor(Math.random() * 15),
        defense: 5 + Math.floor(Math.random() * 10),
        dexterity: 5 + Math.floor(Math.random() * 10),
        intelligence: 5 + Math.floor(Math.random() * 10),
      },
      wishlist: [
        {
          requirement: 'Kingdom Level 1+',
          met: this.kingdomLevel >= 1,
        },
        {
          requirement: 'Have an Inn',
          met: true, // Always true since we have an inn by default
        },
        {
          requirement: '100+ Gold',
          met: this.resources.gold >= 100,
        },
      ],
    };
  }

  private recruitVisitor(visitorId: string): void {
    // Cost gold to recruit
    this.resources.gold -= 50;
    this.updateResourceDisplay();
    this.showNotification('Recruited!', '#32cd32');

    // Emit event to KingdomScene
    const kingdomScene = this.scene.get('KingdomScene');
    kingdomScene.events.emit('visitor-recruited', { id: visitorId });
  }

  private showBuildingPanel(buildingType: string): void {
    const building = this.getBuildingData(buildingType);
    this.closeCurrentPanel();

    const panel = this.createPanel(this.formatBuildingName(buildingType));

    // Building info
    const infoSection = document.createElement('div');
    infoSection.innerHTML = `
      <div style="margin-bottom: 16px;">
        <div style="color: #888888; margin-bottom: 8px;">Level ${building.level}</div>
        <div style="color: #32cd32;">
          Produces: ${building.production.rate} ${building.production.resource}/min
        </div>
      </div>
    `;
    panel.appendChild(infoSection);

    // Upgrade section
    const upgradeSection = document.createElement('div');
    upgradeSection.innerHTML = `
      <h4 style="margin: 0 0 8px; color: #4a90d9;">Upgrade Cost</h4>
      <div style="display: flex; gap: 16px; margin-bottom: 16px;">
        <span style="color: #ffd700;">🪙 ${building.upgradeCost.gold}</span>
        <span style="color: #8b4513;">🪵 ${building.upgradeCost.wood}</span>
        <span style="color: #808080;">🪨 ${building.upgradeCost.stone}</span>
      </div>
    `;
    panel.appendChild(upgradeSection);

    // Upgrade button
    const canUpgrade =
      this.resources.gold >= building.upgradeCost.gold &&
      this.resources.wood >= building.upgradeCost.wood &&
      this.resources.stone >= building.upgradeCost.stone;

    const upgradeBtn = document.createElement('button');
    upgradeBtn.textContent = 'Upgrade';
    upgradeBtn.disabled = !canUpgrade;
    upgradeBtn.style.cssText = `
      width: 100%;
      padding: 12px;
      background: ${canUpgrade ? '#4a90d9' : '#444444'};
      color: ${canUpgrade ? '#ffffff' : '#888888'};
      border: none;
      border-radius: 4px;
      font-size: 16px;
      font-weight: bold;
      cursor: ${canUpgrade ? 'pointer' : 'not-allowed'};
      pointer-events: auto;
    `;
    upgradeBtn.onclick = () => {
      if (canUpgrade) {
        this.upgradeBuilding(buildingType, building.upgradeCost);
        this.closeCurrentPanel();
      }
    };
    panel.appendChild(upgradeBtn);

    this.overlayContainer?.appendChild(panel);
    this.currentPanel = panel;
  }

  private getBuildingData(type: string): BuildingData {
    const configs: Record<string, Omit<BuildingData, 'level'>> = {
      inn: {
        type: 'inn',
        production: { resource: 'happiness', rate: 5 },
        upgradeCost: { gold: 100, wood: 50, stone: 30 },
      },
      gate: {
        type: 'gate',
        production: { resource: 'visitors', rate: 1 },
        upgradeCost: { gold: 150, wood: 100, stone: 80 },
      },
      barracks: {
        type: 'barracks',
        production: { resource: 'soldiers', rate: 2 },
        upgradeCost: { gold: 200, wood: 80, stone: 100 },
      },
      farm: {
        type: 'farm',
        production: { resource: 'food', rate: 10 },
        upgradeCost: { gold: 80, wood: 60, stone: 20 },
      },
      mine: {
        type: 'mine',
        production: { resource: 'stone', rate: 5 },
        upgradeCost: { gold: 120, wood: 40, stone: 60 },
      },
    };

    return {
      ...configs[type] || configs.farm,
      level: 1,
    };
  }

  private formatBuildingName(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  private upgradeBuilding(type: string, cost: { gold: number; wood: number; stone: number }): void {
    this.resources.gold -= cost.gold;
    this.resources.wood -= cost.wood;
    this.resources.stone -= cost.stone;
    this.updateResourceDisplay();
    this.showNotification(`${this.formatBuildingName(type)} upgraded!`, '#4a90d9');
  }

  private createPanel(title: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(180deg, #2a2a4e 0%, #1a1a2e 100%);
      border-top: 2px solid #4a90d9;
      border-radius: 16px 16px 0 0;
      padding: 20px;
      color: #ffffff;
      font-family: 'Courier New', monospace;
      animation: slideUp 0.3s ease-out;
      pointer-events: auto;
    `;

    // Header with close button
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    `;

    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    titleEl.style.cssText = 'margin: 0; font-size: 20px;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #888888;
      font-size: 20px;
      cursor: pointer;
      pointer-events: auto;
    `;
    closeBtn.onclick = () => this.closeCurrentPanel();

    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    return panel;
  }

  private closeCurrentPanel(): void {
    if (this.currentPanel) {
      this.currentPanel.remove();
      this.currentPanel = null;
    }
  }

  shutdown(): void {
    // Clean up DOM elements
    this.overlayContainer?.remove();
  }
}
