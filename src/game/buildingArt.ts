// Building facades baked from the Tiny Tales Overworld pack (A3 roof/wall
// autotiles + village doors/windows). JRPG-scale: iconic fronts, not floor
// plans. Frame table matches tools baking in buildings.png.

import Phaser from 'phaser';

export const BUILDING_FRAMES: Record<string, [number, number, number, number]> = {
  townhall: [0, 0, 96, 96],
  tavern: [96, 0, 96, 64],
  farm: [192, 0, 64, 64],
  house: [256, 0, 64, 64],
  storage: [320, 0, 64, 64],
  memorial: [384, 0, 64, 64],
  knightschool: [0, 96, 96, 64],
  thievesguild: [96, 96, 96, 64],
  magetower: [192, 96, 64, 96],
  vanguardhall: [256, 96, 64, 64],
  bulwarkkeep: [320, 96, 64, 64],
  rangerslodge: [384, 96, 64, 64],
  assassinsden: [448, 96, 64, 64],
  sorcerersanctum: [0, 192, 64, 64],
  clericschapel: [64, 192, 64, 64],
};

// Buildings whose chimneys smoke (life signs)
export const SMOKING = new Set(['house', 'farm', 'tavern', 'townhall']);

export function registerBuildingFrames(scene: Phaser.Scene): void {
  const tex = scene.textures.get('buildings');
  for (const [k, [x, y, w, h]] of Object.entries(BUILDING_FRAMES)) {
    if (!tex.has(`bld_${k}`)) tex.add(`bld_${k}`, 0, x, y, w, h);
  }
  if (!scene.anims.exists('smoke_puff')) {
    scene.anims.create({
      key: 'smoke_puff',
      frames: scene.anims.generateFrameNumbers('smoke', { start: 0, end: 2 }),
      frameRate: 4,
      repeat: -1,
    });
  }
}
