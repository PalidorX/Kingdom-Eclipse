import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config/constants';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import { KingdomScene } from './scenes/KingdomScene';
import { BattleScene } from './scenes/BattleScene';

window.addEventListener('load', () => {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#0e1420',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    input: { activePointers: 2 },
    scene: [BootScene, WorldScene, KingdomScene, BattleScene],
    pixelArt: true,
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
    else game.resume();
  });

  (window as unknown as { game: Phaser.Game }).game = game;
});
