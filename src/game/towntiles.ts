// Town rendering for the Tiny Tales world-map art: every tile of a real
// building footprint renders as a small house, with one consistent house
// colour per contiguous building (region).

import { hashStr } from '../core/rng';

// Frames registered on the world-tileset texture (row 13 of the atlas)
export const TOWN_FRAMES: Record<string, [number, number]> = {
  house_red: [0, 13],
  house_orange: [1, 13],
  house_blue: [2, 13],
  house_teal: [3, 13],
};

const COLORS = ['red', 'orange', 'blue', 'teal'];

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

export function townFrame(_grid: string[][], regions: number[][], x: number, y: number): string {
  const region = regions[y][x];
  return `house_${COLORS[hashStr(`bldg${region}`) % COLORS.length]}`;
}
