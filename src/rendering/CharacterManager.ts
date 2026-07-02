import { ThreeRenderer } from './ThreeRenderer';
import { Character3D, CharacterTeam } from './Character3D';

interface ManagedCharacter {
  id: string;
  character: Character3D;
  screenX: number;
  screenY: number;
  depth: number;
}

export class CharacterManager {
  private renderer: ThreeRenderer;
  private characters: Map<string, ManagedCharacter> = new Map();
  private lastTime: number = 0;
  private cameraOffsetX: number = 0;
  private cameraOffsetY: number = 0;

  constructor() {
    this.renderer = ThreeRenderer.getInstance();
  }

  // Set camera offset for scrolling maps
  setCameraOffset(x: number, y: number): void {
    this.cameraOffsetX = x;
    this.cameraOffsetY = y;
    this.updateAllPositions();
  }

  // Create a new 3D character
  createCharacter(
    id: string,
    team: CharacterTeam,
    screenX: number,
    screenY: number,
    withEquipment: boolean = false
  ): Character3D {
    const character = new Character3D(team);

    // Add default equipment based on team
    if (withEquipment) {
      if (team === 'player') {
        character.equipSword();
        character.equipShield();
        character.equipHelmet('iron');
        character.equipArmor('iron');
      } else if (team === 'enemy') {
        character.equipSword();
        character.equipHelmet('leather');
      }
    }

    this.renderer.scene.add(character.group);

    const managed: ManagedCharacter = {
      id,
      character,
      screenX,
      screenY,
      depth: screenY,
    };

    this.characters.set(id, managed);
    this.updateCharacterPosition(managed);

    return character;
  }

  // Update character's screen position
  setCharacterPosition(id: string, screenX: number, screenY: number): void {
    const managed = this.characters.get(id);
    if (managed) {
      managed.screenX = screenX;
      managed.screenY = screenY;
      managed.depth = screenY;
      this.updateCharacterPosition(managed);
    }
  }

  // Set character facing direction
  setCharacterFacing(id: string, faceRight: boolean): void {
    const managed = this.characters.get(id);
    if (managed) {
      managed.character.setFacing(faceRight);
    }
  }

  // Set character walking state
  setCharacterWalking(id: string, walking: boolean): void {
    const managed = this.characters.get(id);
    if (managed) {
      managed.character.setWalking(walking);
    }
  }

  // Get a character by ID
  getCharacter(id: string): Character3D | null {
    return this.characters.get(id)?.character || null;
  }

  // Remove a character
  removeCharacter(id: string): void {
    const managed = this.characters.get(id);
    if (managed) {
      this.renderer.scene.remove(managed.character.group);
      managed.character.dispose();
      this.characters.delete(id);
    }
  }

  // Update character position in 3D space based on screen coords
  private updateCharacterPosition(managed: ManagedCharacter): void {
    const worldPos = this.renderer.screenToWorld(
      managed.screenX + this.cameraOffsetX,
      managed.screenY + this.cameraOffsetY
    );

    // Scale factor for 3D characters (adjust to match 32px tile scale)
    const scale = 0.5;
    managed.character.group.scale.set(scale, scale, scale);

    // Feet sit on the tile - model origin (y=0) is at the feet, so no vertical lift
    managed.character.setPosition(worldPos.x, worldPos.y, -managed.depth * 0.01);
  }

  private updateAllPositions(): void {
    this.characters.forEach(managed => {
      this.updateCharacterPosition(managed);
    });
  }

  // Update all character animations
  update(time: number): void {
    const delta = (time - this.lastTime) / 1000;
    this.lastTime = time;

    this.characters.forEach(managed => {
      managed.character.update(delta);
    });

    // Sort by depth (Y position) for proper rendering order
    const sorted = Array.from(this.characters.values()).sort((a, b) => a.depth - b.depth);
    sorted.forEach((managed, index) => {
      managed.character.group.renderOrder = index;
    });

    this.renderer.render();
  }

  // Clear all characters
  clear(): void {
    this.characters.forEach(managed => {
      this.renderer.scene.remove(managed.character.group);
      managed.character.dispose();
    });
    this.characters.clear();
  }

  // Show/hide all characters
  setVisible(visible: boolean): void {
    this.characters.forEach(managed => {
      managed.character.group.visible = visible;
    });
  }

  // Dispose manager
  dispose(): void {
    this.clear();
  }
}
