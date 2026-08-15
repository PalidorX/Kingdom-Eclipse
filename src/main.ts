import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config/constants';
import { ZOOM } from './core/zoom';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import { KingdomScene } from './scenes/KingdomScene';
import { BattleScene } from './scenes/BattleScene';

// Render all text at device resolution so it stays sharp under camera zoom
const origText = Phaser.GameObjects.GameObjectFactory.prototype.text;
(Phaser.GameObjects.GameObjectFactory.prototype as any).text = function (
  x: number, y: number, t: string | string[], style?: Phaser.Types.GameObjects.Text.TextStyle
) {
  const st = { ...(style ?? {}) } as Phaser.Types.GameObjects.Text.TextStyle & { resolution?: number };
  if (st.resolution === undefined) st.resolution = ZOOM;
  return origText.call(this, x, y, t, st);
};

window.addEventListener('load', () => {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#0e1420',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH * ZOOM,
      height: GAME_HEIGHT * ZOOM,
      autoRound: true,
    },
    render: {
      pixelArt: true,
      antialias: false,
      roundPixels: true,
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
