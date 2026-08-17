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

  // Phaser pauses/resumes on tab visibility by itself — a manual pause here
  // was double-pausing and could wedge the loop on mobile tab-switches.
  // What Phaser can't recover alone: Android reclaiming the WebGL context
  // wipes every RenderTexture (all our maps). When the context comes back,
  // restart the live scenes so they redraw from scratch.
  game.events.once(Phaser.Core.Events.READY, () => {
    if (game.renderer.type === Phaser.WEBGL) {
      (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).on(
        Phaser.Renderer.Events.RESTORE_WEBGL,
        () => {
          game.scene.getScenes(true).forEach((s) => {
            // a battle can't replay its launch data — retreat to the surface
            if (s.scene.key === 'BattleScene') s.scene.start('WorldScene');
            else s.scene.restart();
          });
        }
      );
    }
  });

  (window as unknown as { game: Phaser.Game }).game = game;
});
