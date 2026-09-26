import type { Coordinate, TravelMode } from "./map-providers.ts";

export type PackedRoadGraph = { version: 1; source: string; nodes: Coordinate[]; edges: Array<[number, number, number, number]> };
export type LocalRoadRoute = { geometry: { type: "LineString"; coordinates: Coordinate[] }; legEnds: number[]; distanceMeters: number; durationSeconds: number; provider: "local-car" | "local-walk" | "local-bike" | "walking-estimate" | "local-road-estimate" };

const CAR = 1;
const FOOT = 2;
const BIKE = 4;
const GRID = 200;
const MAX_SNAP_METERS = 2200;

function meters(aLon: number, aLat: number, bLon: number, bLat: number) {
  const dy = (aLat - bLat) * 111_195;
  const dx = (aLon - bLon) * 111_195 * Math.cos((aLat + bLat) * Math.PI / 360);
  return Math.hypot(dx, dy);
}

class MinHeap {
  private items: Array<{ node: number; g: number; f: number }> = [];
  get length() { return this.items.length; }
  push(node: number, g: number, f: number) {
    const items = this.items;
    let index = items.length;
    items.push({ node, g, f });
    while (index) {
      const parent = (index - 1) >> 1;
      if (items[parent].f <= f) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = { node, g, f };
  }
  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (!last || !items.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= items.length) break;
      const right = left + 1;
      const child = right < items.length && items[right].f < items[left].f ? right : left;
      if (items[child].f >= last.f) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
}

export class LocalRoadGraph {
  private lon: Float64Array;
  private lat: Float64Array;
  private offsets: Uint32Array;
  private targets: Uint32Array;
  private masks: Uint8Array;
  private lengths: Float32Array;
  private nodeModes: Uint8Array;
  private grids = new Map<number, number[]>();
  private snapCache = new Map<string, Map<number, { node: number; distance: number }>>();
  private parents: Record<number, Int32Array>;
  private distances: Float64Array;
  private previous: Int32Array;
  private seen: Uint32Array;
  private query = 0;
  private pathCache = new Map<string, { nodes: number[]; distance: number }>();

  constructor(data: PackedRoadGraph) {
    if (data.version !== 1 || !data.nodes.length) throw new Error("Некорректный локальный дорожный граф");
    const count = data.nodes.length;
    this.lon = new Float64Array(count);
    this.lat = new Float64Array(count);
    this.parents = Object.fromEntries([CAR, FOOT, BIKE].map(mode => [mode, Int32Array.from({ length: count }, (_, index) => index)]));
    this.nodeModes = new Uint8Array(count);
    this.distances = new Float64Array(count);
    this.previous = new Int32Array(count);
    this.seen = new Uint32Array(count);
    data.nodes.forEach(([lon, lat], index) => {
      this.lon[index] = lon;
      this.lat[index] = lat;
      const key = this.gridKey(Math.floor(lon * GRID), Math.floor(lat * GRID));
      const bucket = this.grids.get(key);
      if (bucket) bucket.push(index);
      else this.grids.set(key, [index]);
    });
    this.offsets = new Uint32Array(count + 1);
    for (const [a, b, forward, backward] of data.edges) {
      this.nodeModes[a] |= forward | backward;
      this.nodeModes[b] |= forward | backward;
      if (forward) this.offsets[a + 1]++;
      if (backward) this.offsets[b + 1]++;
      for (const mode of [CAR, FOOT, BIKE]) if ((forward | backward) & mode) this.union(this.parents[mode], a, b);
    }
    for (let index = 1; index < this.offsets.length; index++) this.offsets[index] += this.offsets[index - 1];
    this.targets = new Uint32Array(this.offsets[count]);
    this.masks = new Uint8Array(this.offsets[count]);
    this.lengths = new Float32Array(this.offsets[count]);
    const cursor = this.offsets.slice(0, count);
    for (const [a, b, forward, backward] of data.edges) {
      const length = meters(this.lon[a], this.lat[a], this.lon[b], this.lat[b]);
      if (forward) { const index = cursor[a]++; this.targets[index] = b; this.masks[index] = forward; this.lengths[index] = length; }
      if (backward) { const index = cursor[b]++; this.targets[index] = a; this.masks[index] = backward; this.lengths[index] = length; }
    }
  }

  private gridKey(x: number, y: number) { return x * 100_000 + y; }
  private find(parent: Int32Array, node: number): number {
    let root = node;
    while (parent[root] !== root) root = parent[root];
    while (parent[node] !== root) { const next = parent[node]; parent[node] = root; node = next; }
    return root;
  }
  private union(parent: Int32Array, a: number, b: number) {
    const left = this.find(parent, a), right = this.find(parent, b);
    if (left !== right) parent[right] = left;
  }
  private nearestByComponent(point: Coordinate, mode: number) {
    const cacheKey = `${mode}:${point[0].toFixed(6)},${point[1].toFixed(6)}`;
    const cached = this.snapCache.get(cacheKey);
    if (cached) return cached;
    const result = new Map<number, { node: number; distance: number }>();
    const x = Math.floor(point[0] * GRID), y = Math.floor(point[1] * GRID);
    for (let ring = 0; ring <= 4; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
        if (ring && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        for (const node of this.grids.get(this.gridKey(x + dx, y + dy)) ?? []) {
          if (!(this.nodeModes[node] & mode)) continue;
          const distance = meters(point[0], point[1], this.lon[node], this.lat[node]);
          if (distance > MAX_SNAP_METERS) continue;
          const component = this.find(this.parents[mode], node);
          const best = result.get(component);
          if (!best || distance < best.distance) result.set(component, { node, distance });
        }
      }
    }
    this.snapCache.set(cacheKey, result);
    return result;
  }
  private snaps(points: Coordinate[], mode: number) {
    const choices = points.map(point => this.nearestByComponent(point, mode));
    let best: { nodes: number[]; score: number } | null = null;
    for (const component of choices[0].keys()) {
      const options = choices.map(list => list.get(component));
      if (options.some(option => !option)) continue;
      const score = options.reduce((sum, option) => sum + option!.distance, 0);
      if (!best || score < best.score) best = { nodes: options.map(option => option!.node), score };
    }
    if (!best) throw new Error("Точки находятся вне связанного локального дорожного графа");
    return best.nodes;
  }
  private shortest(start: number, finish: number, mode: number) {
    if (start === finish) return { nodes: [start], distance: 0 };
    const key = `${mode}:${start}:${finish}`;
    const cached = this.pathCache.get(key);
    if (cached) return cached;
    if (++this.query === 0xffffffff) { this.seen.fill(0); this.query = 1; }
    const epoch = this.query;
    const heap = new MinHeap();
    this.seen[start] = epoch;
    this.distances[start] = 0;
    this.previous[start] = -1;
    heap.push(start, 0, meters(this.lon[start], this.lat[start], this.lon[finish], this.lat[finish]));
    while (heap.length) {
      const current = heap.pop();
      if (!current || current.g !== this.distances[current.node]) continue;
      if (current.node === finish) {
        const nodes: number[] = [];
        for (let node = finish; node !== -1; node = this.previous[node]) nodes.push(node);
        nodes.reverse();
        const value = { nodes, distance: current.g };
        if (this.pathCache.size > 4000) this.pathCache.clear();
        this.pathCache.set(key, value);
        return value;
      }
      for (let index = this.offsets[current.node]; index < this.offsets[current.node + 1]; index++) {
        if (!(this.masks[index] & mode)) continue;
        const next = this.targets[index];
        const g = current.g + this.lengths[index];
        if (this.seen[next] === epoch && g >= this.distances[next]) continue;
        this.seen[next] = epoch;
        this.distances[next] = g;
        this.previous[next] = current.node;
        heap.push(next, g, g + meters(this.lon[next], this.lat[next], this.lon[finish], this.lat[finish]));
      }
    }
    throw new Error("Между точками нет проезда по локальному дорожному графу");
  }
  route(points: Coordinate[], requested: TravelMode): LocalRoadRoute {
    if (points.length < 2) throw new Error("Нужны минимум две точки маршрута");
    const preferred = requested === "driving" ? CAR : requested === "cycling" ? BIKE : FOOT;
    let mode = preferred;
    let snapped: number[];
    try { snapped = this.snaps(points, preferred); }
    catch {
      if (preferred === CAR) throw new Error("Автодорожный граф не покрывает все точки маршрута");
      mode = CAR;
      snapped = this.snaps(points, CAR);
    }
    let distanceMeters = 0;
    const coordinates: Coordinate[] = [];
    const legEnds = [0];
    for (let index = 1; index < snapped.length; index++) {
      const leg = this.shortest(snapped[index - 1], snapped[index], mode);
      distanceMeters += leg.distance;
      for (const node of index === 1 ? leg.nodes : leg.nodes.slice(1)) coordinates.push([this.lon[node], this.lat[node]]);
      legEnds.push(Math.max(0, coordinates.length - 1));
    }
    if (coordinates.length === 1) coordinates.push([...coordinates[0]]);
    const provider = mode !== preferred ? "local-road-estimate" : requested === "transit" ? "walking-estimate" : requested === "walking" ? "local-walk" : requested === "cycling" ? "local-bike" : "local-car";
    const speedKmh = mode === CAR ? 30 : mode === BIKE ? 12 : 5;
    return { geometry: { type: "LineString", coordinates }, legEnds, distanceMeters, durationSeconds: distanceMeters / 1000 / speedKmh * 3600, provider };
  }
}
