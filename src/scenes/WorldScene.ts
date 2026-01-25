import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/GameConfig';

interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export class WorldScene extends Phaser.Scene {
  private playerMarker!: Phaser.GameObjects.Sprite;
  private currentPosition: GeoPosition = {
    latitude: 37.7749, // Default: San Francisco
    longitude: -122.4194,
    accuracy: 0,
  };
  private watchId: number | null = null;
  private isDebugMode: boolean = false;
  private debugContainer!: Phaser.GameObjects.Container;
  private positionText!: Phaser.GameObjects.Text;
  private resourceMarkers: Phaser.GameObjects.Sprite[] = [];
  private dungeonMarkers: Phaser.GameObjects.Sprite[] = [];

  constructor() {
    super({ key: 'WorldScene' });
  }

  create(): void {
    this.createWorldMap();
    this.createPlayerMarker();
    this.createResourceMarkers();
    this.createUI();
    this.createDebugUI();
    this.initGeolocation();

    // Start UIScene in parallel
    this.scene.launch('UIScene');
  }

  private createWorldMap(): void {
    // Create a simple grid-based world map background
    const graphics = this.add.graphics();

    // Background color (water)
    graphics.fillStyle(0x3b7cb5, 1);
    graphics.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Create some "land" patches as visual placeholder
    graphics.fillStyle(0x4a7c3f, 1);
    for (let i = 0; i < 10; i++) {
      const x = Phaser.Math.Between(20, GAME_WIDTH - 60);
      const y = Phaser.Math.Between(80, GAME_HEIGHT - 200);
      const w = Phaser.Math.Between(40, 100);
      const h = Phaser.Math.Between(40, 100);
      graphics.fillRoundedRect(x, y, w, h, 10);
    }

    // Grid overlay for reference
    graphics.lineStyle(1, 0xffffff, 0.1);
    for (let x = 0; x < GAME_WIDTH; x += 50) {
      graphics.lineBetween(x, 0, x, GAME_HEIGHT);
    }
    for (let y = 0; y < GAME_HEIGHT; y += 50) {
      graphics.lineBetween(0, y, GAME_WIDTH, y);
    }
  }

  private createPlayerMarker(): void {
    this.playerMarker = this.add.sprite(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      'marker-player'
    );
    this.playerMarker.setDepth(100);

    // Pulsing animation
    this.tweens.add({
      targets: this.playerMarker,
      scale: { from: 1, to: 1.2 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private createResourceMarkers(): void {
    // Spawn random resource points
    for (let i = 0; i < 5; i++) {
      const x = Phaser.Math.Between(30, GAME_WIDTH - 30);
      const y = Phaser.Math.Between(100, GAME_HEIGHT - 200);
      const marker = this.add.sprite(x, y, 'marker-resource');
      marker.setInteractive();
      marker.on('pointerdown', () => this.onResourceTap(marker));
      this.resourceMarkers.push(marker);
    }

    // Spawn dungeon markers
    for (let i = 0; i < 2; i++) {
      const x = Phaser.Math.Between(30, GAME_WIDTH - 30);
      const y = Phaser.Math.Between(100, GAME_HEIGHT - 200);
      const marker = this.add.sprite(x, y, 'marker-dungeon');
      marker.setInteractive();
      marker.on('pointerdown', () => this.onDungeonTap(marker));
      this.dungeonMarkers.push(marker);
    }
  }

  private createUI(): void {
    // Header bar
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a1a2e, 0.9);
    headerBg.fillRect(0, 0, GAME_WIDTH, 60);
    headerBg.setDepth(200);

    // Title
    const title = this.add.text(GAME_WIDTH / 2, 20, 'World Map', {
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    title.setOrigin(0.5, 0);
    title.setDepth(201);

    // Position display
    this.positionText = this.add.text(10, 40, 'Lat: -- Lon: --', {
      fontSize: '10px',
      color: '#aaaaaa',
    });
    this.positionText.setDepth(201);

    // Bottom navigation bar
    const navBg = this.add.graphics();
    navBg.fillStyle(0x1a1a2e, 0.95);
    navBg.fillRect(0, GAME_HEIGHT - 80, GAME_WIDTH, 80);
    navBg.setDepth(200);

    // Navigation buttons
    this.createNavButton(GAME_WIDTH / 4, GAME_HEIGHT - 40, 'World', true);
    this.createNavButton((GAME_WIDTH / 4) * 2, GAME_HEIGHT - 40, 'Kingdom', false, () => {
      this.scene.start('KingdomScene');
    });
    this.createNavButton((GAME_WIDTH / 4) * 3, GAME_HEIGHT - 40, 'Battle', false, () => {
      this.scene.start('BattleScene');
    });
  }

  private createNavButton(
    x: number,
    y: number,
    label: string,
    active: boolean,
    callback?: () => void
  ): void {
    const btn = this.add.text(x, y, label, {
      fontSize: '14px',
      color: active ? '#4a90d9' : '#888888',
      fontStyle: active ? 'bold' : 'normal',
    });
    btn.setOrigin(0.5);
    btn.setDepth(201);

    if (callback) {
      btn.setInteractive();
      btn.on('pointerdown', callback);
      btn.on('pointerover', () => btn.setColor('#ffffff'));
      btn.on('pointerout', () => btn.setColor(active ? '#4a90d9' : '#888888'));
    }
  }

  private createDebugUI(): void {
    // Debug mode toggle - always visible
    const debugToggle = this.add.text(GAME_WIDTH - 10, 10, '[DEBUG]', {
      fontSize: '10px',
      color: '#666666',
    });
    debugToggle.setOrigin(1, 0);
    debugToggle.setDepth(300);
    debugToggle.setInteractive();
    debugToggle.on('pointerdown', () => this.toggleDebugMode());

    // Debug controls container (hidden by default)
    this.debugContainer = this.add.container(0, 70);
    this.debugContainer.setDepth(300);
    this.debugContainer.setVisible(false);

    // Background panel
    const panelBg = this.add.graphics();
    panelBg.fillStyle(0x000000, 0.8);
    panelBg.fillRect(10, 0, GAME_WIDTH - 20, 120);
    this.debugContainer.add(panelBg);

    // Latitude control
    const latLabel = this.add.text(20, 10, 'Latitude:', {
      fontSize: '12px',
      color: '#ffffff',
    });
    this.debugContainer.add(latLabel);

    const latValue = this.add.text(150, 10, this.currentPosition.latitude.toFixed(4), {
      fontSize: '12px',
      color: '#4a90d9',
    });
    this.debugContainer.add(latValue);

    this.createDebugSlider(20, 30, 'lat', -90, 90, this.currentPosition.latitude, (value) => {
      this.currentPosition.latitude = value;
      latValue.setText(value.toFixed(4));
      this.updatePositionDisplay();
    });

    // Longitude control
    const lonLabel = this.add.text(20, 55, 'Longitude:', {
      fontSize: '12px',
      color: '#ffffff',
    });
    this.debugContainer.add(lonLabel);

    const lonValue = this.add.text(150, 55, this.currentPosition.longitude.toFixed(4), {
      fontSize: '12px',
      color: '#4a90d9',
    });
    this.debugContainer.add(lonValue);

    this.createDebugSlider(20, 75, 'lon', -180, 180, this.currentPosition.longitude, (value) => {
      this.currentPosition.longitude = value;
      lonValue.setText(value.toFixed(4));
      this.updatePositionDisplay();
    });

    // Simulate movement button
    const moveBtn = this.add.text(GAME_WIDTH / 2, 105, '[ Simulate Walk ]', {
      fontSize: '12px',
      color: '#32cd32',
    });
    moveBtn.setOrigin(0.5);
    moveBtn.setInteractive();
    moveBtn.on('pointerdown', () => this.simulateWalk());
    this.debugContainer.add(moveBtn);
  }

  private createDebugSlider(
    x: number,
    y: number,
    _id: string,
    min: number,
    max: number,
    initial: number,
    onChange: (value: number) => void
  ): void {
    const width = GAME_WIDTH - 60;

    // Track
    const track = this.add.graphics();
    track.fillStyle(0x333333, 1);
    track.fillRect(x, y, width, 10);
    this.debugContainer.add(track);

    // Calculate initial position
    const normalizedInitial = (initial - min) / (max - min);
    const handleX = x + normalizedInitial * width;

    // Handle
    const handle = this.add.circle(handleX, y + 5, 8, 0x4a90d9);
    handle.setInteractive({ draggable: true });
    this.debugContainer.add(handle);

    // Drag handling
    handle.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number) => {
      const clampedX = Phaser.Math.Clamp(dragX, x, x + width);
      handle.x = clampedX;

      const normalized = (clampedX - x) / width;
      const value = min + normalized * (max - min);
      onChange(value);
    });
  }

  private toggleDebugMode(): void {
    this.isDebugMode = !this.isDebugMode;
    this.debugContainer.setVisible(this.isDebugMode);
  }

  private simulateWalk(): void {
    // Simulate walking in a random direction
    const latDelta = (Math.random() - 0.5) * 0.001;
    const lonDelta = (Math.random() - 0.5) * 0.001;

    this.currentPosition.latitude += latDelta;
    this.currentPosition.longitude += lonDelta;
    this.updatePositionDisplay();

    // Visual feedback
    this.tweens.add({
      targets: this.playerMarker,
      x: this.playerMarker.x + Phaser.Math.Between(-20, 20),
      y: this.playerMarker.y + Phaser.Math.Between(-20, 20),
      duration: 300,
      ease: 'Quad.easeOut',
    });
  }

  private initGeolocation(): void {
    if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.onGeolocationUpdate(position),
        (error) => this.onGeolocationError(error),
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 5000,
        }
      );
    } else {
      console.warn('Geolocation not available, using debug mode');
      this.isDebugMode = true;
      this.debugContainer.setVisible(true);
    }
  }

  private onGeolocationUpdate(position: GeolocationPosition): void {
    if (this.isDebugMode) return; // Ignore GPS when in debug mode

    this.currentPosition = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
    this.updatePositionDisplay();
  }

  private onGeolocationError(error: GeolocationPositionError): void {
    console.error('Geolocation error:', error.message);
    // Enable debug mode on error
    if (!this.isDebugMode) {
      this.isDebugMode = true;
      this.debugContainer.setVisible(true);
    }
  }

  private updatePositionDisplay(): void {
    this.positionText.setText(
      `Lat: ${this.currentPosition.latitude.toFixed(4)} Lon: ${this.currentPosition.longitude.toFixed(4)}`
    );
  }

  private onResourceTap(marker: Phaser.GameObjects.Sprite): void {
    // Calculate distance (simplified - would use haversine in production)
    const distance = Phaser.Math.Distance.Between(
      this.playerMarker.x,
      this.playerMarker.y,
      marker.x,
      marker.y
    );

    if (distance < 100) {
      // Within range - collect resource
      this.tweens.add({
        targets: marker,
        scale: 0,
        alpha: 0,
        duration: 300,
        onComplete: () => {
          marker.destroy();
          const index = this.resourceMarkers.indexOf(marker);
          if (index > -1) this.resourceMarkers.splice(index, 1);
        },
      });

      // Emit event for UI
      this.events.emit('resource-collected', { type: 'gold', amount: 50 });
    } else {
      // Out of range feedback
      this.cameras.main.shake(100, 0.005);
    }
  }

  private onDungeonTap(marker: Phaser.GameObjects.Sprite): void {
    const distance = Phaser.Math.Distance.Between(
      this.playerMarker.x,
      this.playerMarker.y,
      marker.x,
      marker.y
    );

    if (distance < 100) {
      // Enter dungeon - transition to battle
      this.cameras.main.fadeOut(500, 0, 0, 0, (_camera: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress === 1) {
          this.scene.start('BattleScene');
        }
      });
    } else {
      this.cameras.main.shake(100, 0.005);
    }
  }

  shutdown(): void {
    // Clean up geolocation watcher
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
    }
  }
}
