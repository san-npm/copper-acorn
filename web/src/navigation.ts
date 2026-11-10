export type Point = [number, number];
export function inside([x, y]: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = polygon[i], [c, d] = polygon[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) result = !result;
  }
  return result;
}
export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function segmentDistance(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return distance(point, [a[0] + t * dx, a[1] + t * dy]);
}

export class Navigation {
  readonly step = 12;
  private columns: number;
  private rows: number;
  private open = new Set<number>();
  private surfaces: Point[][];
  private solids: Point[][];
  private radius: number;
  constructor(width: number, height: number, surfaces: Point[][], solids: Point[][], radius = 0) {
    this.surfaces = surfaces; this.solids = solids;
    this.radius = radius;
    this.columns = Math.ceil(width / this.step); this.rows = Math.ceil(height / this.step);
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.columns; x++) {
      if (this.walkable([x * this.step, y * this.step])) this.open.add(y * this.columns + x);
    }
  }
  walkable(point: Point) {
    const floor = (p: Point) => this.surfaces.some(surface => inside(p, surface));
    if (!floor(point) || this.solids.some(p => inside(point, p) || p.some((a, i) => segmentDistance(point, a, p[(i + 1) % p.length]) < this.radius))) return false;
    // Check the union so the shared shop/stair/courtyard seams remain passable.
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      if (!floor([point[0] + Math.cos(angle) * this.radius, point[1] + Math.sin(angle) * this.radius])) return false;
    }
    return true;
  }
  clear(a: Point, b: Point) {
    const samples = Math.max(1, Math.ceil(distance(a, b) / 4));
    for (let i = 0; i <= samples; i++) if (!this.walkable([a[0] + (b[0] - a[0]) * i / samples, a[1] + (b[1] - a[1]) * i / samples])) return false;
    return true;
  }
  path(start: Point, end: Point): Point[] | null {
    if (!this.walkable(start) || !this.walkable(end)) return null;
    if (this.clear(start, end)) return [end];
    const point = (id: number): Point => [(id % this.columns) * this.step, Math.floor(id / this.columns) * this.step];
    const nearest = (target: Point) => [...this.open].sort((a, b) => distance(point(a), target) - distance(point(b), target)).find(id => this.clear(target, point(id)));
    const first = nearest(start), last = nearest(end);
    if (first === undefined || last === undefined) return null;
    const frontier = new Set([first]), cost = new Map([[first, 0]]), previous = new Map<number, number>();
    while (frontier.size) {
      let current: number = [...frontier].reduce((a: number, b: number): number => cost.get(a)! + distance(point(a), point(last)) < cost.get(b)! + distance(point(b), point(last)) ? a : b);
      if (current === last) {
        const full: Point[] = [end, point(last)];
        while (previous.has(current)) { current = previous.get(current)!; full.push(point(current)); }
        full.push(start); full.reverse();
        const path: Point[] = []; let from = 0;
        while (from < full.length - 1) {
          let next = full.length - 1;
          while (next > from + 1 && !this.clear(full[from], full[next])) next--;
          path.push(full[next]); from = next;
        }
        return path;
      }
      frontier.delete(current);
      const [x, y] = point(current);
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        if (!dx && !dy) continue;
        const nx = x / this.step + dx, ny = y / this.step + dy;
        if (nx < 0 || ny < 0 || nx >= this.columns || ny >= this.rows) continue;
        const id = ny * this.columns + nx;
        if (!this.open.has(id) || !this.clear(point(current), point(id))) continue;
        const candidate = cost.get(current)! + Math.hypot(dx, dy) * this.step;
        if (candidate >= (cost.get(id) ?? Infinity)) continue;
        cost.set(id, candidate); previous.set(id, current); frontier.add(id);
      }
    }
    return null;
  }
}
