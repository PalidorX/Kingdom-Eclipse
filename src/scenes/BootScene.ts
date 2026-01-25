import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, TILE_SIZE } from '../config/constants';

interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export class BootScene extends Phaser.Scene {
  private loadingBar!: Phaser.GameObjects.Graphics;
  private loadingBarBg!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    this.createLoadingUI();
    this.generatePlaceholderAssets();
  }

  async create(): Promise<void> {
    // Stage 1: Assets loaded
    this.updateProgress(0.2, 'Assets loaded');
    await this.delay(300);

    // Stage 2: Get geolocation
    this.updateProgress(0.3, 'Getting your location...');
    const position = await this.getGeolocation();

    // Stage 3: Fetch OSM data
    this.updateProgress(0.5, 'Fetching map data...');
    const osmData = await this.fetchOSMData(position);

    // Stage 4: Processing map
    this.updateProgress(0.8, 'Processing map...');
    await this.delay(300);

    // Stage 5: Ready
    this.updateProgress(1.0, 'Ready!');
    await this.delay(500);

    // Store data in registry for WorldScene to use
    this.registry.set('initialPosition', position);
    this.registry.set('initialOSMData', osmData);

    // Transition to WorldScene
    this.scene.start('WorldScene');
  }

  private createLoadingUI(): void {
    const centerX = GAME_WIDTH / 2;
    const centerY = GAME_HEIGHT / 2;

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Title
    this.titleText = this.add.text(centerX, centerY - 100, 'KINGDOM ECLIPSE', {
      fontSize: '28px',
      color: '#ffffff',
      fontStyle: 'bold',
      fontFamily: 'monospace',
    });
    this.titleText.setOrigin(0.5);

    // Subtitle
    const subtitle = this.add.text(centerX, centerY - 65, 'Loading your world...', {
      fontSize: '14px',
      color: '#80a0c0',
      fontFamily: 'monospace',
    });
    subtitle.setOrigin(0.5);

    // Progress bar background
    this.loadingBarBg = this.add.graphics();
    this.loadingBarBg.fillStyle(0x2a2a4e, 1);
    this.loadingBarBg.fillRoundedRect(centerX - 140, centerY - 10, 280, 24, 12);
    this.loadingBarBg.lineStyle(2, 0x4060a0, 1);
    this.loadingBarBg.strokeRoundedRect(centerX - 140, centerY - 10, 280, 24, 12);

    // Progress bar fill
    this.loadingBar = this.add.graphics();

    // Status text
    this.statusText = this.add.text(centerX, centerY + 35, 'Initializing...', {
      fontSize: '12px',
      color: '#60a0c0',
      fontFamily: 'monospace',
    });
    this.statusText.setOrigin(0.5);

    // Version text
    const versionText = this.add.text(centerX, GAME_HEIGHT - 30, 'v0.1.0 Alpha', {
      fontSize: '10px',
      color: '#404060',
      fontFamily: 'monospace',
    });
    versionText.setOrigin(0.5);
  }

  private updateProgress(value: number, status: string): void {
    const centerX = GAME_WIDTH / 2;
    const centerY = GAME_HEIGHT / 2;

    // Update progress bar
    this.loadingBar.clear();
    if (value > 0) {
      this.loadingBar.fillStyle(0x4a90d9, 1);
      this.loadingBar.fillRoundedRect(
        centerX - 136,
        centerY - 6,
        Math.max(0, 272 * value),
        16,
        8
      );
    }

    // Update status text
    this.statusText.setText(status);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getGeolocation(): Promise<GeoPosition> {
    return new Promise((resolve) => {
      // Default position (San Francisco)
      const defaultPosition: GeoPosition = {
        latitude: 37.7749,
        longitude: -122.4194,
        accuracy: 0,
      };

      if (!('geolocation' in navigator)) {
        this.updateProgress(0.4, 'Location unavailable, using default');
        resolve(defaultPosition);
        return;
      }

      const timeoutId = setTimeout(() => {
        this.updateProgress(0.4, 'Location timeout, using default');
        resolve(defaultPosition);
      }, 8000);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timeoutId);
          this.updateProgress(0.4, 'Location found!');
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        () => {
          clearTimeout(timeoutId);
          this.updateProgress(0.4, 'Location denied, using default');
          resolve(defaultPosition);
        },
        {
          enableHighAccuracy: true,
          timeout: 7000,
          maximumAge: 60000,
        }
      );
    });
  }

  private async fetchOSMData(position: GeoPosition): Promise<unknown> {
    const METERS_PER_TILE = 5;
    const TILES_X = Math.ceil(GAME_WIDTH / 16);
    const TILES_Y = Math.ceil(GAME_HEIGHT / 16);

    try {
      // Calculate bounding box
      const latDelta = (TILES_Y * METERS_PER_TILE) / 111000;
      const lonDelta = (TILES_X * METERS_PER_TILE) / (111000 * Math.cos(position.latitude * Math.PI / 180));

      const south = position.latitude - latDelta / 2;
      const north = position.latitude + latDelta / 2;
      const west = position.longitude - lonDelta / 2;
      const east = position.longitude + lonDelta / 2;

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

      this.updateProgress(0.6, 'Downloading map data...');

      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
      });

      if (!response.ok) {
        throw new Error('API request failed');
      }

      this.updateProgress(0.7, 'Parsing map data...');
      const data = await response.json();

      console.log('Preloader: OSM data loaded', data.elements?.length || 0, 'elements');
      return data;
    } catch (error) {
      console.error('Failed to fetch OSM data:', error);
      this.updateProgress(0.7, 'Map data unavailable');
      return null;
    }
  }

  private generatePlaceholderAssets(): void {
    // Generate tile placeholder textures
    this.generateTileTexture('tile-grass', 0x4a7c3f);
    this.generateTileTexture('tile-dirt', 0x8b6914);
    this.generateTileTexture('tile-water', 0x3b7cb5);
    this.generateTileTexture('tile-stone', 0x6b6b6b);
    this.generateTileTexture('tile-path', 0xc4a35a);

    // Building placeholders
    this.generateBuildingTexture('building-inn', 0xb5651d, 2);
    this.generateBuildingTexture('building-gate', 0x8b4513, 2);
    this.generateBuildingTexture('building-barracks', 0x4a4a4a, 3);
    this.generateBuildingTexture('building-farm', 0x90ee90, 2);
    this.generateBuildingTexture('building-mine', 0x696969, 2);

    // Character placeholders
    this.generateCharacterTexture('char-player', 0x4169e1);
    this.generateCharacterTexture('char-visitor', 0xffa500);
    this.generateCharacterTexture('char-enemy', 0xdc143c);
    this.generateCharacterTexture('char-ally', 0x32cd32);

    // UI elements
    this.generateUITexture('btn-primary', 0x4a90d9, 80, 32);
    this.generateUITexture('btn-secondary', 0x6b6b6b, 80, 32);
    this.generateUITexture('panel-bg', 0x2a2a4e, 200, 150);

    // World map markers
    this.generateMarkerTexture('marker-player', 0x4169e1);
    this.generateMarkerTexture('marker-resource', 0xffd700);
    this.generateMarkerTexture('marker-dungeon', 0x8b0000);
  }

  private generateTileTexture(key: string, color: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(color, 1);
    graphics.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    graphics.lineStyle(1, 0x000000, 0.3);
    graphics.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
    graphics.generateTexture(key, TILE_SIZE, TILE_SIZE);
    graphics.destroy();
  }

  private generateBuildingTexture(key: string, color: number, sizeTiles: number): void {
    const size = TILE_SIZE * sizeTiles;
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(color, 1);
    graphics.fillRect(2, size * 0.3, size - 4, size * 0.7 - 2);
    graphics.fillStyle(color - 0x222222, 1);
    graphics.fillTriangle(size / 2, 2, 0, size * 0.35, size, size * 0.35);
    graphics.fillStyle(0x4a3728, 1);
    graphics.fillRect(size / 2 - 4, size - 12, 8, 10);
    graphics.generateTexture(key, size, size);
    graphics.destroy();
  }

  private generateCharacterTexture(key: string, color: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(color, 1);
    graphics.fillRect(4, 6, 8, 8);
    graphics.fillStyle(0xffdbac, 1);
    graphics.fillCircle(8, 4, 3);
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(6, 3, 1, 1);
    graphics.fillRect(9, 3, 1, 1);
    graphics.generateTexture(key, TILE_SIZE, TILE_SIZE);
    graphics.destroy();
  }

  private generateUITexture(key: string, color: number, width: number, height: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(0, 0, width, height, 4);
    graphics.fillStyle(0xffffff, 0.2);
    graphics.fillRect(2, 2, width - 4, height / 3);
    graphics.generateTexture(key, width, height);
    graphics.destroy();
  }

  private generateMarkerTexture(key: string, color: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    const size = 24;
    graphics.fillStyle(color, 1);
    graphics.fillCircle(size / 2, size / 3, size / 3);
    graphics.fillTriangle(size / 2, size - 2, size / 4, size / 2, size * 3 / 4, size / 2);
    graphics.fillStyle(0xffffff, 0.8);
    graphics.fillCircle(size / 2, size / 3, size / 6);
    graphics.generateTexture(key, size, size);
    graphics.destroy();
  }
}
