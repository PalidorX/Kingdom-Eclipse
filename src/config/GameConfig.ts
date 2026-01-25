import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { WorldScene } from '../scenes/WorldScene';
import { KingdomScene } from '../scenes/KingdomScene';
import { BattleScene } from '../scenes/BattleScene';
import { UIScene } from '../scenes/UIScene';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';

// Re-export constants for convenience
export { GAME_WIDTH, GAME_HEIGHT, KINGDOM_GRID_SIZE, BATTLE_GRID_SIZE, TILE_SIZE } from './constants';

export const GameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    min: {
      width: GAME_WIDTH * 0.5,
      height: GAME_HEIGHT * 0.5,
    },
    max: {
      width: GAME_WIDTH * 2,
      height: GAME_HEIGHT * 2,
    },
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  input: {
    activePointers: 3, // Support multi-touch for pinch-zoom
  },
  scene: [BootScene, WorldScene, KingdomScene, BattleScene, UIScene],
  pixelArt: false,
  antialias: true,
  roundPixels: false,
};
