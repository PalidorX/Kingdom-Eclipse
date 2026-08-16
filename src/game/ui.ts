// Shared UI kit: HUD, bottom nav (with lock states), buttons, modals, toasts.
// Skinned with the purchased gold-and-onyx fantasy menu set (see ui.png +
// uiArt.ts). Scalable chrome is drawn with 9-slice so the ornate corners
// never stretch; legacy color hints map onto the kit's plate variants.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';
import { store } from '../core/save';
import { UI_FRAMES, UI_INSETS } from './uiArt';

export const UI_DEPTH = 1000;

export function registerUiFrames(scene: Phaser.Scene): void {
  const tex = scene.textures.get('ui');
  for (const [k, [x, y, w, h]] of Object.entries(UI_FRAMES)) {
    if (!tex.has(`ui_${k}`)) tex.add(`ui_${k}`, 0, x, y, w, h);
  }
}

// 9-slice panel/button plate. Frames without insets fall back to a stretch.
export function uiPanel(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, frame = 'panel'
): Phaser.GameObjects.NineSlice {
  registerUiFrames(scene);
  const ins = UI_INSETS[frame] ?? [0, 0, 0, 0];
  return scene.add.nineslice(x, y, 'ui', `ui_${frame}`, w, h, ins[0], ins[1], ins[2], ins[3]);
}

// Map the old flat-color button hints onto kit plate variants.
function plateFor(color?: number): string {
  if (color === undefined) return 'btn_teal';
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  if (Math.max(r, g, b) < 96) return 'btn_dark';
  if (r > g && r > b) return 'btn_red';
  if (g >= r && g >= b) return 'btn_green';
  return 'btn_teal';
}

export function makeButton(
  scene: Phaser.Scene,
  x: number, y: number, w: number, h: number,
  label: string,
  onTap: () => void,
  opts: { color?: number; textColor?: string; fontSize?: string } = {}
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const plate = uiPanel(scene, 0, 0, w, h, plateFor(opts.color));
  c.add(plate);
  const t = scene.add.text(0, 0, label, {
    fontSize: opts.fontSize ?? '12px',
    color: opts.textColor ?? '#f4e8c8',
    fontFamily: 'monospace',
    fontStyle: 'bold',
    align: 'center',
  }).setOrigin(0.5);
  t.setShadow(0, 1, '#000000', 2);
  c.add(t);
  plate.setInteractive();
  plate.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
    ev.stopPropagation();
    onTap();
  });
  c.setData('label', t);
  return c;
}

export function hud(scene: Phaser.Scene, title: string): { refresh: () => void } {
  registerUiFrames(scene);
  scene.add.rectangle(GAME_WIDTH / 2, 27, GAME_WIDTH, 50, 0x0d1420, 0.95).setDepth(UI_DEPTH);
  uiPanel(scene, GAME_WIDTH / 2, 28, GAME_WIDTH + 10, 60, 'frame_thin').setDepth(UI_DEPTH);
  scene.add.text(GAME_WIDTH / 2, 10, title, {
    fontSize: '14px', color: '#f0d890', fontFamily: 'monospace', fontStyle: 'bold',
  }).setOrigin(0.5, 0).setShadow(0, 1, '#000000', 2).setDepth(UI_DEPTH + 1);

  const defs: [string, () => number][] = [
    ['ico_gold', () => store.state.gold],
    ['ico_wood', () => store.state.wood],
    ['ico_stone', () => store.state.stone],
    ['ico_gem', () => store.state.crystal],
  ];
  const texts: Phaser.GameObjects.Text[] = [];
  defs.forEach(([frame, _get], i) => {
    const x = 30 + i * 88;
    const [, , fw, fh] = UI_FRAMES[frame];
    scene.add.image(x, 38, 'ui', `ui_${frame}`)
      .setDisplaySize((18 * fw) / fh, 18).setDepth(UI_DEPTH + 1);
    texts.push(scene.add.text(x + 14, 38, '', {
      fontSize: '11px', color: '#e8c860', fontFamily: 'monospace',
    }).setOrigin(0, 0.5).setShadow(0, 1, '#000000', 2).setDepth(UI_DEPTH + 1));
  });
  const refresh = () => defs.forEach(([, get], i) => texts[i].setText(`${get()}`));
  refresh();
  return { refresh };
}

export function bottomNav(scene: Phaser.Scene, active: 'world' | 'kingdom'): void {
  uiPanel(scene, GAME_WIDTH / 2, GAME_HEIGHT - 25, GAME_WIDTH + 16, 68, 'panel').setDepth(UI_DEPTH);

  const kingdomLocked = store.state.onboard === 'chest' || store.state.onboard === 'freeHero' || store.state.onboard === 'firstBattle';

  const mk = (x: number, label: string, key: 'world' | 'kingdom', target: string, locked: boolean) => {
    const isActive = active === key;
    const b = makeButton(scene, x, GAME_HEIGHT - 27, 120, 34, locked ? `🔒 ${label}` : label, () => {
      if (locked) { toast(scene, 'Win your first battle to unlock the Kingdom'); return; }
      if (!isActive) scene.scene.start(target);
    }, { color: isActive ? 0x3a6acc : locked ? 0x141c30 : 0x1c2c4c, textColor: isActive ? '#ffffff' : '#c8bfa8' });
    if (locked) b.setAlpha(0.75);
    b.setDepth(UI_DEPTH + 1);
  };
  mk(GAME_WIDTH / 2 - 70, 'WORLD', 'world', 'WorldScene', false);
  mk(GAME_WIDTH / 2 + 70, 'KINGDOM', 'kingdom', 'KingdomScene', kingdomLocked);
}

export function toast(scene: Phaser.Scene, msg: string, color = '#f4e8c8'): void {
  const t = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 84, msg, {
    fontSize: '12px', color, fontFamily: 'monospace',
    align: 'center', wordWrap: { width: GAME_WIDTH - 80 },
  }).setOrigin(0.5, 1).setDepth(UI_DEPTH + 61);
  t.setShadow(0, 1, '#000000', 2);
  const bg = uiPanel(
    scene, GAME_WIDTH / 2, GAME_HEIGHT - 84 - t.height / 2,
    Math.max(90, t.width + 34), Math.max(30, t.height + 18), 'btn_dark'
  ).setDepth(UI_DEPTH + 60);
  scene.tweens.add({
    targets: [t, bg], y: '-=14', alpha: 0, delay: 2100, duration: 500,
    onComplete: () => { t.destroy(); bg.destroy(); },
  });
}

export function modal(
  scene: Phaser.Scene,
  title: string,
  onClose?: () => void
): { root: Phaser.GameObjects.Container; close: () => void } {
  registerUiFrames(scene);
  const root = scene.add.container(0, 0).setDepth(UI_DEPTH + 100);
  const dim = scene.add.graphics();
  dim.fillStyle(0x000000, 0.72);
  dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
  dim.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => ev.stopPropagation());
  root.add(dim);

  const pw = GAME_WIDTH - 18, ph = GAME_HEIGHT - 140;
  root.add(uiPanel(scene, GAME_WIDTH / 2, 62 + ph / 2, pw, ph, 'panel'));
  root.add(scene.add.text(GAME_WIDTH / 2, 82, title, {
    fontSize: '13px', color: '#f0d890', fontFamily: 'monospace', fontStyle: 'bold',
    align: 'center', wordWrap: { width: GAME_WIDTH - 110 },
  }).setOrigin(0.5, 0).setShadow(0, 1, '#000000', 2));
  root.add(scene.add.image(GAME_WIDTH / 2, 116, 'ui', 'ui_divider').setDisplaySize(280, 35));

  const close = () => { root.destroy(); onClose?.(); };
  const x = scene.add.image(GAME_WIDTH - 36, 92, 'ui', 'ui_closex').setDisplaySize(32, 32);
  x.setInteractive();
  x.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
    ev.stopPropagation();
    close();
  });
  root.add(x);
  return { root, close };
}

export function confirmDialog(scene: Phaser.Scene, title: string, message: string, yesLabel: string, onYes: () => void): void {
  const { root, close } = modal(scene, title);
  root.add(scene.add.text(GAME_WIDTH / 2, 150, message, {
    fontSize: '10px', color: '#ffe8e0', fontFamily: 'monospace', align: 'center', lineSpacing: 3,
    wordWrap: { width: GAME_WIDTH - 70 },
  }).setOrigin(0.5, 0));
  root.add(makeButton(scene, GAME_WIDTH / 2 - 70, 420, 116, 38, yesLabel, () => { close(); onYes(); }, { color: 0x8a3333 }));
  root.add(makeButton(scene, GAME_WIDTH / 2 + 70, 420, 116, 38, 'not yet', close, { color: 0x334455 }));
}

// Horizontal progress bar from the kit: ornate trough + stretched fill.
export function uiBar(
  scene: Phaser.Scene, x: number, y: number, w: number, pct: number,
  color: 'green' | 'blue' | 'gold' | 'purple' = 'green'
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const h = 22;
  c.add(uiPanel(scene, 0, 0, w, h, 'bar_trough'));
  const innerW = w - 12;
  const fw = Math.max(0, Math.min(1, pct)) * innerW;
  if (fw > 1) {
    const f = scene.add.image(-innerW / 2, 0, 'ui', `ui_fill_${color}`).setOrigin(0, 0.5);
    f.setDisplaySize(fw, h - 8);
    c.add(f);
  }
  return c;
}
