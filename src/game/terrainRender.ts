// Per-quadrant terrain compositor (dual-grid autotiling with full 8-neighbour
// awareness). Each 32px tile is drawn as four 16px quadrants chosen from the
// terrain's raw RPG-Maker A2 block — including the INNER-corner pieces the
// 16-tile bake couldn't represent, so concave corners now render correctly.

import Phaser from 'phaser';

// Terrain -> A2 block top-left (tile coords) in the atlas
export const BLOCK_POS: Record<string, [number, number]> = {
  water: [0, 1], forest: [2, 1], mountain: [4, 1], road: [6, 1],
  paved: [0, 4], sand: [2, 4], park: [4, 4], res: [6, 4],
  com: [0, 7], ind: [2, 7], civ: [4, 7], island: [6, 7],
};

// Terrain names used by the scenes -> block key (null renders plain grass)
export const TERRAIN_TO_BLOCK: Record<string, string | null> = {
  grass: null, town: null,
  water: 'water', forest: 'forest', mountain: 'mountain',
  path: 'road', paved: 'paved', sand: 'sand', park: 'park',
  res: 'res', com: 'com', ind: 'ind', civ: 'civ',
};

export const OBJ_FRAMES: Record<string, [number, number]> = {
  obj_chest: [0, 11], obj_cave1: [1, 11], obj_cave2: [2, 11],
  obj_volcano: [3, 11], obj_tree: [4, 11], obj_chest_rare: [5, 11],
  obj_rubble: [6, 11],
};

// Register every frame the compositor needs on the world-tileset texture.
export function registerTerrainFrames(scene: Phaser.Scene): void {
  const tex = scene.textures.get('world-tileset');
  const add = (name: string, px: number, py: number, w: number, h: number) => {
    if (!tex.has(name)) tex.add(name, 0, px, py, w, h);
  };
  add('t_grass', 0, 0, 32, 32);
  // grass texture variants — hash-picked per tile so the meadow never bands
  add('t_grass2', 4 * 32, 10 * 32, 32, 32);
  add('t_grass3', 5 * 32, 10 * 32, 32, 32);
  add('t_grass4', 6 * 32, 10 * 32, 32, 32);
  const cleanRow0 = ['water', 'forest', 'mountain', 'road', 'paved', 'sand', 'park'];
  cleanRow0.forEach((n, i) => add(`clean_${n}`, (i + 1) * 32, 0, 32, 32));
  ['res', 'com', 'ind', 'civ'].forEach((n, i) => add(`clean_${n}`, i * 32, 10 * 32, 32, 32));
  Object.entries(OBJ_FRAMES).forEach(([k, [c, r]]) => add(k, c * 32, r * 32, 32, 32));

  for (const [t, [bc, br]] of Object.entries(BLOCK_POS)) {
    const bx = bc * 32, by = br * 32;
    // inner-corner tile is A2 (1,0): its four 16px quadrants
    for (const [q, ox, oy] of [['TL', 0, 0], ['TR', 16, 0], ['BL', 0, 16], ['BR', 16, 16]] as const) {
      add(`${t}_i_${q}`, bx + 32 + ox, by + oy, 16, 16);
    }
    // main 64x64 grid (A2 rows 1-2): 4x4 of 16px quadrants
    for (let qy = 0; qy < 4; qy++) {
      for (let qx = 0; qx < 4; qx++) {
        add(`${t}_m_${qx}_${qy}`, bx + qx * 16, by + 32 + qy * 16, 16, 16);
      }
    }
  }
}

// Per-quadrant piece tables. c=center; h=piece when the VERTICAL neighbour
// is missing (top/bottom edge); v=piece when the HORIZONTAL neighbour is
// missing (left/right edge); o=outer corner when both are missing.
const QUAD_TABLE: Record<string, { dx: number; dy: number; c: [number, number]; h: [number, number]; v: [number, number]; o: [number, number] }> = {
  TL: { dx: 0, dy: 0, c: [1, 1], h: [1, 0], v: [0, 1], o: [0, 0] },
  TR: { dx: 16, dy: 0, c: [2, 1], h: [2, 0], v: [3, 1], o: [3, 0] },
  BR: { dx: 16, dy: 16, c: [2, 2], h: [2, 3], v: [3, 2], o: [3, 3] },
  BL: { dx: 0, dy: 16, c: [1, 2], h: [1, 3], v: [0, 2], o: [0, 3] },
};

// Draw one terrain tile at (px,py) on the render texture. `sameAt` reports
// whether the tile at grid (x,y) belongs to the same block (off-grid = true).
// NOTE: uses batchDrawFrame — callers must wrap tile loops in
// rt.beginDraw() ... rt.endDraw() (one GPU pass for the whole map).
export function drawTerrainTile(
  rt: Phaser.GameObjects.RenderTexture,
  block: string | null,
  x: number,
  y: number,
  px: number,
  py: number,
  sameAt: (x: number, y: number) => boolean,
  underlay = true
): void {
  if (underlay) {
    // deterministic per-tile variant: mostly plain, sometimes tufted
    const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const v = h % 7;
    const frame = v === 1 ? 't_grass2' : v === 3 ? 't_grass3' : v === 5 ? 't_grass4' : 't_grass';
    rt.batchDrawFrame('world-tileset', frame, px, py);
  }
  if (!block) return;

  // neighbour signs per quadrant: TL checks west/north/northwest, etc.
  const quads: [string, number, number][] = [
    ['TL', -1, -1],
    ['TR', 1, -1],
    ['BR', 1, 1],
    ['BL', -1, 1],
  ];
  for (const [q, sx, sy] of quads) {
    const t = QUAD_TABLE[q];
    const h = sameAt(x + sx, y);      // horizontal neighbour on this corner's side
    const v = sameAt(x, y + sy);      // vertical neighbour
    const d = sameAt(x + sx, y + sy); // diagonal
    let frame: string;
    if (h && v && d) frame = `${block}_m_${t.c[0]}_${t.c[1]}`;      // interior
    else if (h && v && !d) frame = `${block}_i_${q}`;               // inner corner
    else if (h && !v) frame = `${block}_m_${t.h[0]}_${t.h[1]}`;     // top/bottom edge
    else if (v && !h) frame = `${block}_m_${t.v[0]}_${t.v[1]}`;     // left/right edge
    else frame = `${block}_m_${t.o[0]}_${t.o[1]}`;                  // outer corner
    rt.batchDrawFrame('world-tileset', frame, px + t.dx, py + t.dy);
  }
}
