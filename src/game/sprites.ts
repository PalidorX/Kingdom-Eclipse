// Bakes all placeholder pixel sprites into textures once per game.
// Live Graphics re-render every frame in Phaser; baked textures render as
// quads. (Perf lesson carried over from v1.)

import Phaser from 'phaser';
import { HeroClass } from '../core/save';

export const CLASS_COLORS: Record<HeroClass, { main: number; trim: number }> = {
  Knight: { main: 0x4466cc, trim: 0xaab8e8 },
  Archer: { main: 0x3d8a4f, trim: 0xa8d8a0 },
  Mage:   { main: 0x7a4fc9, trim: 0xd0b8f0 },
  Rogue:  { main: 0x666677, trim: 0xb8b8c8 },
  Cleric: { main: 0xd8d0c0, trim: 0xf0e8d0 },
};

function bakeHumanoid(scene: Phaser.Scene, key: string, shirt: number, trim: number, hostile = false): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const skin = hostile ? 0xa8c890 : 0xffd8b8;
  // shadow
  g.fillStyle(0x000000, 0.3);
  g.fillEllipse(16, 60, 22, 7);
  // legs
  g.fillStyle(0x334455, 1);
  g.fillRect(9, 44, 6, 15);
  g.fillRect(17, 44, 6, 15);
  // torso
  g.fillStyle(shirt, 1);
  g.fillRect(7, 26, 18, 20);
  g.fillStyle(trim, 1);
  g.fillRect(7, 26, 18, 3);
  // arms
  g.fillStyle(shirt, 1);
  g.fillRect(3, 28, 5, 14);
  g.fillRect(24, 28, 5, 14);
  g.fillStyle(skin, 1);
  g.fillRect(3, 40, 5, 5);
  g.fillRect(24, 40, 5, 5);
  // head
  g.fillStyle(skin, 1);
  g.fillRect(9, 8, 14, 14);
  g.fillStyle(hostile ? 0x2a3a2a : 0x4a3728, 1);
  g.fillRect(8, 5, 16, 6);
  // eyes
  g.fillStyle(hostile ? 0xcc2222 : 0x000000, 1);
  g.fillRect(12, 14, 2, 3);
  g.fillRect(19, 14, 2, 3);
  g.generateTexture(key, 32, 64);
  g.destroy();
}

function bakeMonster(scene: Phaser.Scene, key: string, color: number, boss = false): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const s = boss ? 44 : 30;
  const cx = boss ? 24 : 16, base = boss ? 44 : 30;
  g.fillStyle(0x000000, 0.3);
  g.fillEllipse(cx, base, s * 0.8, 6);
  // blob body
  g.fillStyle(color, 1);
  g.fillEllipse(cx, base - s * 0.38, s, s * 0.72);
  g.fillStyle(0xffffff, 0.25);
  g.fillEllipse(cx - s * 0.18, base - s * 0.5, s * 0.3, s * 0.2);
  // eyes
  g.fillStyle(0xffffff, 1);
  g.fillEllipse(cx - 5, base - s * 0.42, 6, 7);
  g.fillEllipse(cx + 5, base - s * 0.42, 6, 7);
  g.fillStyle(0x000000, 1);
  g.fillEllipse(cx - 5, base - s * 0.4, 3, 4);
  g.fillEllipse(cx + 5, base - s * 0.4, 3, 4);
  if (boss) {
    g.fillStyle(0xffd700, 1);
    g.fillTriangle(cx - 12, base - s + 4, cx - 8, base - s - 6, cx - 4, base - s + 2);
    g.fillTriangle(cx - 4, base - s + 2, cx, base - s - 8, cx + 4, base - s + 2);
    g.fillTriangle(cx + 4, base - s + 2, cx + 8, base - s - 6, cx + 12, base - s + 4);
  }
  g.generateTexture(key, boss ? 48 : 32, boss ? 48 : 32);
  g.destroy();
}

function bakeChest(scene: Phaser.Scene): void {
  if (scene.textures.exists('spr_chest')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x000000, 0.3);
  g.fillEllipse(14, 24, 22, 6);
  g.fillStyle(0x8a5a28, 1);
  g.fillRect(3, 10, 22, 13);
  g.fillStyle(0xa8743c, 1);
  g.fillRect(3, 6, 22, 6);
  g.fillStyle(0xd8b040, 1);
  g.fillRect(3, 12, 22, 2);
  g.fillRect(12, 6, 4, 17);
  g.fillStyle(0x443300, 1);
  g.fillRect(13, 13, 2, 4);
  g.generateTexture('spr_chest', 28, 28);
  g.destroy();
}

function bakeNode(scene: Phaser.Scene, key: string, color: number): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x000000, 0.3);
  g.fillEllipse(14, 24, 20, 5);
  g.fillStyle(color, 1);
  g.fillTriangle(14, 3, 4, 22, 24, 22);
  g.fillStyle(0xffffff, 0.25);
  g.fillTriangle(14, 3, 10, 12, 15, 12);
  g.generateTexture(key, 28, 28);
  g.destroy();
}

function bakeDungeon(scene: Phaser.Scene): void {
  if (scene.textures.exists('spr_dungeon')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x000000, 0.35);
  g.fillEllipse(20, 38, 34, 8);
  // stone gate
  g.fillStyle(0x6a6a72, 1);
  g.fillRect(4, 10, 32, 28);
  g.fillStyle(0x8a8a92, 1);
  g.fillRect(4, 10, 32, 4);
  g.fillRect(4, 10, 4, 28);
  g.fillRect(32, 10, 4, 28);
  // dark doorway
  g.fillStyle(0x181820, 1);
  g.fillRect(12, 18, 16, 20);
  g.fillStyle(0x35354a, 1);
  g.fillRect(12, 18, 16, 3);
  // purple glow
  g.fillStyle(0x8844ff, 0.7);
  g.fillRect(18, 24, 4, 6);
  g.generateTexture('spr_dungeon', 40, 42);
  g.destroy();
}

export function bakeAllSprites(scene: Phaser.Scene): void {
  (Object.keys(CLASS_COLORS) as HeroClass[]).forEach((c) => {
    bakeHumanoid(scene, `spr_hero_${c}`, CLASS_COLORS[c].main, CLASS_COLORS[c].trim);
  });
  bakeHumanoid(scene, 'spr_villager', 0x8a7a5a, 0xc8b890);
  bakeHumanoid(scene, 'spr_enemy_h', 0x8a3030, 0xd88080, true);
  bakeMonster(scene, 'spr_mon_green', 0x4a9a3a);
  bakeMonster(scene, 'spr_mon_purple', 0x8a4ac0);
  bakeMonster(scene, 'spr_mon_red', 0xc04a3a);
  bakeMonster(scene, 'spr_boss', 0xc03a6a, true);
  bakeChest(scene);
  bakeNode(scene, 'spr_node_wood', 0x6a8a3a);
  bakeNode(scene, 'spr_node_stone', 0x8a8a92);
  bakeDungeon(scene);
}

export const MONSTER_SPRITES = ['spr_mon_green', 'spr_mon_purple', 'spr_mon_red'];
