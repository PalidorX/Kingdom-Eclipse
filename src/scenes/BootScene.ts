import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, TILE_SIZE } from '../config/constants';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Create loading bar
    this.createLoadingBar();

    // Generate placeholder graphics (16x16 pixel art style)
    this.generatePlaceholderAssets();
  }

  create(): void {
    // Transition to WorldScene after loading
    this.scene.start('WorldScene');
  }

  private createLoadingBar(): void {
    const centerX = GAME_WIDTH / 2;
    const centerY = GAME_HEIGHT / 2;

    // Loading text
    const loadingText = this.add.text(centerX, centerY - 50, 'Loading...', {
      fontSize: '24px',
      color: '#ffffff',
    });
    loadingText.setOrigin(0.5);

    // Progress bar background
    const progressBarBg = this.add.graphics();
    progressBarBg.fillStyle(0x222222, 1);
    progressBarBg.fillRect(centerX - 150, centerY, 300, 30);

    // Progress bar fill
    const progressBar = this.add.graphics();

    // Update progress bar on load progress
    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0x4a90d9, 1);
      progressBar.fillRect(centerX - 145, centerY + 5, 290 * value, 20);
    });

    // Clean up on complete
    this.load.on('complete', () => {
      progressBar.destroy();
      progressBarBg.destroy();
      loadingText.destroy();
    });
  }

  private generatePlaceholderAssets(): void {
    // Generate tile placeholder textures using Graphics
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

    // Add subtle border for definition
    graphics.lineStyle(1, 0x000000, 0.3);
    graphics.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);

    graphics.generateTexture(key, TILE_SIZE, TILE_SIZE);
    graphics.destroy();
  }

  private generateBuildingTexture(key: string, color: number, sizeTiles: number): void {
    const size = TILE_SIZE * sizeTiles;
    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Building body
    graphics.fillStyle(color, 1);
    graphics.fillRect(2, size * 0.3, size - 4, size * 0.7 - 2);

    // Roof
    graphics.fillStyle(color - 0x222222, 1);
    graphics.fillTriangle(size / 2, 2, 0, size * 0.35, size, size * 0.35);

    // Door
    graphics.fillStyle(0x4a3728, 1);
    graphics.fillRect(size / 2 - 4, size - 12, 8, 10);

    graphics.generateTexture(key, size, size);
    graphics.destroy();
  }

  private generateCharacterTexture(key: string, color: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Body
    graphics.fillStyle(color, 1);
    graphics.fillRect(4, 6, 8, 8);

    // Head
    graphics.fillStyle(0xffdbac, 1);
    graphics.fillCircle(8, 4, 3);

    // Eyes
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(6, 3, 1, 1);
    graphics.fillRect(9, 3, 1, 1);

    graphics.generateTexture(key, TILE_SIZE, TILE_SIZE);
    graphics.destroy();
  }

  private generateUITexture(key: string, color: number, width: number, height: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Background with rounded corners effect
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(0, 0, width, height, 4);

    // Highlight
    graphics.fillStyle(0xffffff, 0.2);
    graphics.fillRect(2, 2, width - 4, height / 3);

    graphics.generateTexture(key, width, height);
    graphics.destroy();
  }

  private generateMarkerTexture(key: string, color: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    const size = 24;

    // Pin shape
    graphics.fillStyle(color, 1);
    graphics.fillCircle(size / 2, size / 3, size / 3);
    graphics.fillTriangle(size / 2, size - 2, size / 4, size / 2, size * 3 / 4, size / 2);

    // Inner circle
    graphics.fillStyle(0xffffff, 0.8);
    graphics.fillCircle(size / 2, size / 3, size / 6);

    graphics.generateTexture(key, size, size);
    graphics.destroy();
  }
}
