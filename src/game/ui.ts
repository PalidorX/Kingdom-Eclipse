// Minimal shared UI kit: HUD bar, bottom nav, buttons, modal panels, toasts.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';
import { store } from '../core/save';

export const UI_DEPTH = 1000;

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onTap: () => void,
  opts: { color?: number; textColor?: string; fontSize?: string } = {}
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const color = opts.color ?? 0x2a4a8a;
  g.fillStyle(color, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
  g.lineStyle(1, 0xffffff, 0.25);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
  c.add(g);
  const t = scene.add.text(0, 0, label, {
    fontSize: opts.fontSize ?? '12px',
    color: opts.textColor ?? '#ffffff',
    fontFamily: 'monospace',
    fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(t);
  g.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
  g.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
    ev.stopPropagation();
    onTap();
  });
  c.setData('label', t);
  c.setData('bg', g);
  return c;
}

export function hud(scene: Phaser.Scene, title: string): { refresh: () => void } {
  const bar = scene.add.graphics().setDepth(UI_DEPTH);
  bar.fillStyle(0x101828, 0.96);
  bar.fillRect(0, 0, GAME_WIDTH, 58);
  bar.lineStyle(2, 0x3a5a9a, 1);
  bar.lineBetween(0, 58, GAME_WIDTH, 58);

  scene.add.text(GAME_WIDTH / 2, 12, title, {
    fontSize: '15px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
  }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 1);

  const res = scene.add.text(GAME_WIDTH / 2, 38, '', {
    fontSize: '11px', color: '#e8c860', fontFamily: 'monospace',
  }).setOrigin(0.5, 0).setDepth(UI_DEPTH + 1);

  const refresh = () => {
    const s = store.state;
    res.setText(`⛃ ${s.gold}   🪵 ${s.wood}   🪨 ${s.stone}   ♜ Lv ${store.kingdomLevel()}`);
  };
  refresh();
  return { refresh };
}

export function bottomNav(scene: Phaser.Scene, active: 'world' | 'kingdom'): void {
  const g = scene.add.graphics().setDepth(UI_DEPTH);
  g.fillStyle(0x101828, 0.96);
  g.fillRect(0, GAME_HEIGHT - 54, GAME_WIDTH, 54);
  g.lineStyle(2, 0x3a5a9a, 1);
  g.lineBetween(0, GAME_HEIGHT - 54, GAME_WIDTH, GAME_HEIGHT - 54);

  const mk = (x: number, label: string, key: 'world' | 'kingdom', target: string) => {
    const isActive = active === key;
    const b = makeButton(scene, x, GAME_HEIGHT - 27, 120, 34, label, () => {
      if (!isActive) scene.scene.start(target);
    }, { color: isActive ? 0x3a6acc : 0x1c2c4c });
    b.setDepth(UI_DEPTH + 1);
  };
  mk(GAME_WIDTH / 2 - 70, 'WORLD', 'world', 'WorldScene');
  mk(GAME_WIDTH / 2 + 70, 'KINGDOM', 'kingdom', 'KingdomScene');
}

export function toast(scene: Phaser.Scene, msg: string, color = '#ffffff'): void {
  const t = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 80, msg, {
    fontSize: '12px', color, fontFamily: 'monospace',
    backgroundColor: '#000000dd', padding: { x: 10, y: 6 },
    align: 'center', wordWrap: { width: GAME_WIDTH - 60 },
  }).setOrigin(0.5, 1).setDepth(UI_DEPTH + 50);
  scene.tweens.add({ targets: t, y: t.y - 16, alpha: 0, delay: 1700, duration: 500, onComplete: () => t.destroy() });
}

// Full-screen modal panel. Returns container + content area; tap X to close.
export function modal(
  scene: Phaser.Scene,
  title: string,
  onClose?: () => void
): { root: Phaser.GameObjects.Container; close: () => void } {
  const root = scene.add.container(0, 0).setDepth(UI_DEPTH + 100);
  const dim = scene.add.graphics();
  dim.fillStyle(0x000000, 0.7);
  dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
  dim.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => ev.stopPropagation());
  root.add(dim);

  const panel = scene.add.graphics();
  panel.fillStyle(0x18243c, 0.98);
  panel.fillRoundedRect(14, 70, GAME_WIDTH - 28, GAME_HEIGHT - 160, 10);
  panel.lineStyle(2, 0x4a6aaa, 1);
  panel.strokeRoundedRect(14, 70, GAME_WIDTH - 28, GAME_HEIGHT - 160, 10);
  root.add(panel);

  root.add(scene.add.text(GAME_WIDTH / 2, 86, title, {
    fontSize: '14px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
  }).setOrigin(0.5, 0));

  const close = () => { root.destroy(); onClose?.(); };
  const xBtn = makeButton(scene, GAME_WIDTH - 38, 94, 30, 26, 'X', close, { color: 0x883333 });
  root.add(xBtn);

  return { root, close };
}
