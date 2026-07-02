import * as THREE from 'three';

export type EquipmentSlot = 'head' | 'body' | 'mainHand' | 'offHand' | 'feet';
export type CharacterTeam = 'player' | 'enemy' | 'neutral';


// Color palettes for different team types
const TEAM_COLORS = {
  player: {
    skin: 0xffd8b8,
    hair: 0x4a3728,
    shirt: 0x4466cc,
    pants: 0x334466,
    shoes: 0x443322,
  },
  enemy: {
    skin: 0xffd8b8,
    hair: 0x2a2a2a,
    shirt: 0xcc4444,
    pants: 0x663344,
    shoes: 0x332222,
  },
  neutral: {
    skin: 0xffd8b8,
    hair: 0x6a5a4a,
    shirt: 0x888866,
    pants: 0x665544,
    shoes: 0x443322,
  },
};

export class Character3D {
  public group: THREE.Group;
  public mixer: THREE.AnimationMixer | null = null;

  private body: THREE.Group;
  private equipment: Map<EquipmentSlot, THREE.Object3D> = new Map();

  // Body parts for animation
  private head: THREE.Mesh;
  private torso: THREE.Mesh;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private leftLeg: THREE.Group;
  private rightLeg: THREE.Group;

  // Animation state
  private animationTime: number = 0;
  private isWalking: boolean = false;

  constructor(team: CharacterTeam = 'player') {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    // Create placeholder humanoid
    const colors = TEAM_COLORS[team];

    // Head
    const headGeom = new THREE.BoxGeometry(12, 14, 12);
    const headMat = new THREE.MeshLambertMaterial({ color: colors.skin });
    this.head = new THREE.Mesh(headGeom, headMat);
    this.head.position.set(0, 52, 0);
    this.body.add(this.head);

    // Hair
    const hairGeom = new THREE.BoxGeometry(13, 8, 13);
    const hairMat = new THREE.MeshLambertMaterial({ color: colors.hair });
    const hair = new THREE.Mesh(hairGeom, hairMat);
    hair.position.set(0, 5, 0);
    this.head.add(hair);

    // Eyes
    const eyeGeom = new THREE.BoxGeometry(2, 2, 1);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.set(-3, 0, 6.5);
    this.head.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(3, 0, 6.5);
    this.head.add(rightEye);

    // Torso
    const torsoGeom = new THREE.BoxGeometry(16, 20, 10);
    const torsoMat = new THREE.MeshLambertMaterial({ color: colors.shirt });
    this.torso = new THREE.Mesh(torsoGeom, torsoMat);
    this.torso.position.set(0, 35, 0);
    this.body.add(this.torso);

    // Left Arm
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-12, 42, 0);
    const leftArmMesh = this.createArm(colors.shirt, colors.skin);
    this.leftArm.add(leftArmMesh);
    this.body.add(this.leftArm);

    // Right Arm
    this.rightArm = new THREE.Group();
    this.rightArm.position.set(12, 42, 0);
    const rightArmMesh = this.createArm(colors.shirt, colors.skin);
    this.rightArm.add(rightArmMesh);
    this.body.add(this.rightArm);

    // Left Leg
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-4, 22, 0);
    const leftLegMesh = this.createLeg(colors.pants, colors.shoes);
    this.leftLeg.add(leftLegMesh);
    this.body.add(this.leftLeg);

    // Right Leg
    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(4, 22, 0);
    const rightLegMesh = this.createLeg(colors.pants, colors.shoes);
    this.rightLeg.add(rightLegMesh);
    this.body.add(this.rightLeg);

    // Shadow
    const shadowGeom = new THREE.CircleGeometry(10, 16);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
    });
    const shadow = new THREE.Mesh(shadowGeom, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 1;
    this.group.add(shadow);

    // Default equipment slots (empty placeholders)
    this.createDefaultEquipmentSlots();
  }

  private createArm(shirtColor: number, skinColor: number): THREE.Group {
    const arm = new THREE.Group();

    // Upper arm (shirt)
    const upperArmGeom = new THREE.BoxGeometry(5, 12, 6);
    const upperArmMat = new THREE.MeshLambertMaterial({ color: shirtColor });
    const upperArm = new THREE.Mesh(upperArmGeom, upperArmMat);
    upperArm.position.set(0, -6, 0);
    arm.add(upperArm);

    // Hand
    const handGeom = new THREE.BoxGeometry(4, 6, 5);
    const handMat = new THREE.MeshLambertMaterial({ color: skinColor });
    const hand = new THREE.Mesh(handGeom, handMat);
    hand.position.set(0, -15, 0);
    arm.add(hand);

    return arm;
  }

  private createLeg(pantsColor: number, shoesColor: number): THREE.Group {
    const leg = new THREE.Group();

    // Upper leg
    const upperLegGeom = new THREE.BoxGeometry(6, 14, 6);
    const upperLegMat = new THREE.MeshLambertMaterial({ color: pantsColor });
    const upperLeg = new THREE.Mesh(upperLegGeom, upperLegMat);
    upperLeg.position.set(0, -7, 0);
    leg.add(upperLeg);

    // Foot
    const footGeom = new THREE.BoxGeometry(6, 4, 8);
    const footMat = new THREE.MeshLambertMaterial({ color: shoesColor });
    const foot = new THREE.Mesh(footGeom, footMat);
    foot.position.set(0, -16, 2);
    leg.add(foot);

    return leg;
  }

  private createDefaultEquipmentSlots(): void {
    // Main hand weapon slot (right hand)
    const weaponSlot = new THREE.Group();
    weaponSlot.position.set(0, -12, 0);
    this.rightArm.add(weaponSlot);
    this.equipment.set('mainHand', weaponSlot);

    // Off hand slot (left hand)
    const offHandSlot = new THREE.Group();
    offHandSlot.position.set(0, -12, 0);
    this.leftArm.add(offHandSlot);
    this.equipment.set('offHand', offHandSlot);

    // Head slot
    const headSlot = new THREE.Group();
    headSlot.position.set(0, 10, 0);
    this.head.add(headSlot);
    this.equipment.set('head', headSlot);

    // Body slot (for armor overlay)
    const bodySlot = new THREE.Group();
    bodySlot.position.set(0, 0, 0);
    this.torso.add(bodySlot);
    this.equipment.set('body', bodySlot);
  }

  // Equip an item to a slot
  equipItem(slot: EquipmentSlot, mesh: THREE.Object3D): void {
    const slotGroup = this.equipment.get(slot);
    if (slotGroup) {
      // Clear existing equipment in slot
      while (slotGroup.children.length > 0) {
        slotGroup.remove(slotGroup.children[0]);
      }
      slotGroup.add(mesh);
    }
  }

  // Equip a simple sword (placeholder)
  equipSword(): void {
    const swordGroup = new THREE.Group();

    // Blade
    const bladeGeom = new THREE.BoxGeometry(2, 28, 1);
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
    const blade = new THREE.Mesh(bladeGeom, bladeMat);
    blade.position.set(0, 14, 0);
    swordGroup.add(blade);

    // Handle
    const handleGeom = new THREE.BoxGeometry(3, 8, 2);
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
    const handle = new THREE.Mesh(handleGeom, handleMat);
    handle.position.set(0, -2, 0);
    swordGroup.add(handle);

    // Crossguard
    const guardGeom = new THREE.BoxGeometry(10, 2, 2);
    const guardMat = new THREE.MeshLambertMaterial({ color: 0xdaa520 });
    const guard = new THREE.Mesh(guardGeom, guardMat);
    guard.position.set(0, 2, 0);
    swordGroup.add(guard);

    this.equipItem('mainHand', swordGroup);
  }

  // Equip a simple shield (placeholder)
  equipShield(): void {
    const shieldGroup = new THREE.Group();

    const shieldGeom = new THREE.BoxGeometry(3, 18, 14);
    const shieldMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    const shield = new THREE.Mesh(shieldGeom, shieldMat);
    shieldGroup.add(shield);

    // Shield boss
    const bossGeom = new THREE.SphereGeometry(3, 8, 8);
    const bossMat = new THREE.MeshLambertMaterial({ color: 0xdaa520 });
    const boss = new THREE.Mesh(bossGeom, bossMat);
    boss.position.set(2, 0, 0);
    shieldGroup.add(boss);

    this.equipItem('offHand', shieldGroup);
  }

  // Equip a simple helmet (placeholder)
  equipHelmet(type: 'iron' | 'gold' | 'leather' = 'iron'): void {
    const helmetGroup = new THREE.Group();

    const colors = {
      iron: 0x888888,
      gold: 0xdaa520,
      leather: 0x8b4513,
    };

    const helmetGeom = new THREE.BoxGeometry(14, 10, 14);
    const helmetMat = new THREE.MeshLambertMaterial({ color: colors[type] });
    const helmet = new THREE.Mesh(helmetGeom, helmetMat);
    helmet.position.set(0, 2, 0);
    helmetGroup.add(helmet);

    // Visor
    const visorGeom = new THREE.BoxGeometry(12, 4, 2);
    const visorMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const visor = new THREE.Mesh(visorGeom, visorMat);
    visor.position.set(0, -2, 8);
    helmetGroup.add(visor);

    this.equipItem('head', helmetGroup);
  }

  // Equip body armor (placeholder)
  equipArmor(type: 'iron' | 'gold' | 'leather' = 'iron'): void {
    const armorGroup = new THREE.Group();

    const colors = {
      iron: 0x888888,
      gold: 0xdaa520,
      leather: 0x8b4513,
    };

    // Chestplate overlay
    const chestGeom = new THREE.BoxGeometry(17, 18, 11);
    const chestMat = new THREE.MeshLambertMaterial({ color: colors[type] });
    const chest = new THREE.Mesh(chestGeom, chestMat);
    chestGeom.translate(0, 0, 0.5);
    armorGroup.add(chest);

    // Shoulder pads
    const shoulderGeom = new THREE.BoxGeometry(6, 5, 8);
    const shoulderMat = new THREE.MeshLambertMaterial({ color: colors[type] });
    const leftShoulder = new THREE.Mesh(shoulderGeom, shoulderMat);
    leftShoulder.position.set(-10, 6, 0);
    armorGroup.add(leftShoulder);
    const rightShoulder = new THREE.Mesh(shoulderGeom, shoulderMat);
    rightShoulder.position.set(10, 6, 0);
    armorGroup.add(rightShoulder);

    this.equipItem('body', armorGroup);
  }

  // Set position in Three.js world coordinates
  setPosition(x: number, y: number, z: number = 0): void {
    this.group.position.set(x, y, z);
  }

  // Set facing direction
  setFacing(faceRight: boolean): void {
    this.body.rotation.y = faceRight ? 0 : Math.PI;
  }

  // Start/stop walking animation
  setWalking(walking: boolean): void {
    this.isWalking = walking;
    if (!walking) {
      // Reset to idle pose
      this.leftArm.rotation.x = 0;
      this.rightArm.rotation.x = 0;
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
    }
  }

  // Update animation
  update(delta: number): void {
    this.animationTime += delta;

    if (this.isWalking) {
      const speed = 8;
      const amplitude = 0.5;
      const t = this.animationTime * speed;

      // Arm swing
      this.leftArm.rotation.x = Math.sin(t) * amplitude;
      this.rightArm.rotation.x = -Math.sin(t) * amplitude;

      // Leg swing
      this.leftLeg.rotation.x = -Math.sin(t) * amplitude * 0.8;
      this.rightLeg.rotation.x = Math.sin(t) * amplitude * 0.8;
    }
    // No idle animation - characters stand still when not walking
  }

  // Play attack animation
  attack(): Promise<void> {
    return new Promise((resolve) => {
      const startRotation = this.rightArm.rotation.x;

      // Wind up
      const windUp = () => {
        this.rightArm.rotation.x = -1.2;
        this.rightArm.rotation.z = 0.3;
        setTimeout(swing, 100);
      };

      // Swing
      const swing = () => {
        this.rightArm.rotation.x = 0.8;
        this.rightArm.rotation.z = -0.2;
        setTimeout(reset, 150);
      };

      // Reset
      const reset = () => {
        this.rightArm.rotation.x = startRotation;
        this.rightArm.rotation.z = 0;
        resolve();
      };

      windUp();
    });
  }

  // Dispose of resources
  dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
