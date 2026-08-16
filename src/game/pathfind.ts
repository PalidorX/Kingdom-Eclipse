// Small A* over the kingdom grid. 4-directional, weighted tiles so walkers
// prefer laid paths over cutting across grass.

export interface PathPoint { x: number; y: number }

export function findPath(
  cols: number,
  rows: number,
  walkable: (x: number, y: number) => boolean,
  cost: (x: number, y: number) => number,
  sx: number, sy: number,
  tx: number, ty: number
): PathPoint[] | null {
  if (sx === tx && sy === ty) return [];
  if (!walkable(tx, ty)) return null;
  const key = (x: number, y: number) => y * cols + x;
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const open: { x: number; y: number; f: number }[] = [];
  const h = (x: number, y: number) => Math.abs(x - tx) + Math.abs(y - ty);
  g.set(key(sx, sy), 0);
  open.push({ x: sx, y: sy, f: h(sx, sy) });

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === tx && cur.y === ty) {
      const out: PathPoint[] = [];
      let k = key(tx, ty);
      while (k !== key(sx, sy)) {
        out.push({ x: k % cols, y: Math.floor(k / cols) });
        k = came.get(k)!;
      }
      return out.reverse();
    }
    const cg = g.get(key(cur.x, cur.y))!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (!walkable(nx, ny) && !(nx === tx && ny === ty)) continue;
      const nk = key(nx, ny);
      const ng = cg + cost(nx, ny);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, key(cur.x, cur.y));
        open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}
