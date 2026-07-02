import * as THREE from 'three';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';

export class ThreeRenderer {
  private static instance: ThreeRenderer | null = null;

  public scene: THREE.Scene;
  public camera: THREE.OrthographicCamera;
  public renderer: THREE.WebGLRenderer;
  private container: HTMLElement;

  private constructor() {
    this.scene = new THREE.Scene();

    // Orthographic camera for 2D-style rendering
    const aspect = GAME_WIDTH / GAME_HEIGHT;
    const frustumSize = GAME_HEIGHT;
    this.camera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 100);
    this.camera.lookAt(0, 0, 0);

    // Create renderer with transparent background
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    this.renderer.setSize(GAME_WIDTH, GAME_HEIGHT);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Position the Three.js canvas over the Phaser canvas
    const canvas = this.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '10';

    // Find game container and append
    this.container = document.getElementById('game-container') || document.body;
    this.container.appendChild(canvas);

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    // Add directional light for depth
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(50, 100, 50);
    this.scene.add(directionalLight);

    // Handle resize
    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();
  }

  static getInstance(): ThreeRenderer {
    if (!ThreeRenderer.instance) {
      ThreeRenderer.instance = new ThreeRenderer();
    }
    return ThreeRenderer.instance;
  }

  private handleResize(): void {
    const phaserCanvas = this.container.querySelector('canvas:not([style*="z-index"])') as HTMLCanvasElement;
    if (phaserCanvas) {
      const rect = phaserCanvas.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();

      this.renderer.domElement.style.left = `${rect.left - containerRect.left}px`;
      this.renderer.domElement.style.top = `${rect.top - containerRect.top}px`;
      this.renderer.domElement.style.width = `${rect.width}px`;
      this.renderer.domElement.style.height = `${rect.height}px`;
    }
  }

  // Convert Phaser screen coordinates to Three.js coordinates
  screenToWorld(screenX: number, screenY: number): THREE.Vector3 {
    return new THREE.Vector3(
      screenX - GAME_WIDTH / 2,
      GAME_HEIGHT / 2 - screenY,
      0
    );
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  clear(): void {
    while (this.scene.children.length > 2) { // Keep lights
      const child = this.scene.children[this.scene.children.length - 1];
      if (child.type !== 'AmbientLight' && child.type !== 'DirectionalLight') {
        this.scene.remove(child);
      } else {
        break;
      }
    }
  }

  destroy(): void {
    this.renderer.domElement.remove();
    this.renderer.dispose();
    ThreeRenderer.instance = null;
  }
}
