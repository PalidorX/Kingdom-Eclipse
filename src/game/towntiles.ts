// Structured town rendering: each contiguous OSM building footprint renders
// as a house — roof ridge on its north edge, roof body, an eave line, and a
// street-facing wall row with windows and a door. One roof colour per
// building (region), instead of a per-tile patchwork.

import { hashStr } from '../core/rng';

// Frames registered on the world-tileset texture (rows 13-14 of the atlas)
export const TOWN_FRAMES: Record<string, [number, number]> = {
  roof_blue_ridge: [0, 13], roof_blue_body: [1, 13], roof_blue_eave: [2, 13],
  roof_red_ridge: [3, 13], roof_red_body: [4, 13], roof_red_eave: [5, 13],
  wall_window: [6, 13], wall_door: [7, 13], wall_plain: [0, 14],
};

// Flood-fill contiguous 'town' areas -> region ids (one building = one region)
export function computeTownRegions(grid: string[][]): number[][] {
  const H = grid.length, W = grid[0]?.length ?? 0;
  const regions: number[][] = Array.from({ length: H }, () => Array(W).fill(-1));
  let next = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== 'town' || regions[y][x] !== -1) continue;
      const id = next++;
      const q: [number, number][] = [[x, y]];
      regions[y][x] = id;
      while (q.length) {
        const [cx, cy] = q.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (grid[ny][nx] === 'town' && regions[ny][nx] === -1) {
            regions[ny][nx] = id;
            q.push([nx, ny]);
          }
        }
      }
    }
  }
  return regions;
}

// Pick the frame for a town tile from its role within the building
export function townFrame(grid: string[][], regions: number[][], x: number, y: number): string {
  const H = grid.length, W = grid[0]?.length ?? 0;
  const town = (nx: number, ny: number) =>
    nx >= 0 && ny >= 0 && nx < W && ny < H && grid[ny][nx] === 'town';
  const region = regions[y][x];
  const color = hashStr(`bldg${region}`) % 2 ? 'blue' : 'red';

  const nEdge = !town(x, y - 1);
  const sEdge = !town(x, y + 1);
  const sIsWallRow = town(x, y + 1) && !town(x, y + 2); // row below is the wall row

  if (nEdge && sEdge) return `roof_${color}_eave`;       // 1-tall strip: just roof
  if (sEdge) {
    // street-facing wall row: a door roughly every 4th column, else windows
    return hashStr(`d${region}|${x}`) % 4 === 0 ? 'wall_door' : 'wall_window';
  }
  if (nEdge) return `roof_${color}_ridge`;
  if (sIsWallRow) return `roof_${color}_eave`;
  return `roof_${color}_body`;
}
