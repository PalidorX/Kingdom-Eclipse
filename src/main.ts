import Phaser from 'phaser';
import { GameConfig } from './config/GameConfig';

// Initialize the game when DOM is ready
window.addEventListener('load', () => {
  const game = new Phaser.Game(GameConfig);

  // Handle visibility change (pause game when tab is inactive)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.pause();
    } else {
      game.resume();
    }
  });

  // Expose game instance for debugging
  if (import.meta.env.DEV) {
    (window as unknown as { game: Phaser.Game }).game = game;
  }
});
