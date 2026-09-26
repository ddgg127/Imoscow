export type Pt = { x: number; y: number };
export type Stop = Pt & { id: string; label: string; urgent?: boolean; ready?: number; due?: number; only?: "e1" | "e2" };
export type Base = Pt & { id: "e1" | "e2" | "e3"; label: string };

export const KM_PER_PX = 0.04;
export const PX_PER_MIN = 12.5;
export const SERVICE_MIN = 25;
export const START_MIN = 8 * 60;
export const SHIFT_END = 18 * 60;
export const SHIFT_KM = 14;
export const SOLO_GAP_KM = 24;

export const PARK: Pt[] = [
  { x: 440, y: 250 },
  { x: 575, y: 262 },
  { x: 588, y: 380 },
  { x: 452, y: 392 },
];

export const E1: Base = { id: "e1", label: "Е1", x: 150, y: 300 };
export const E2: Base = { id: "e2", label: "Е2", x: 880, y: 170 };
export const E3: Base = { id: "e3", label: "Е3", x: 900, y: 575 };

export const DEFAULT_STOPS: Stop[] = [
  { id: "urg", label: "А", urgent: true, x: 110, y: 505, due: 9 * 60 + 30, only: "e1" },
  { id: "s1", label: "1", x: 326, y: 144, due: 13 * 60 + 30 },
  { id: "s2", label: "2", x: 399, y: 149 },
  { id: "s3", label: "3", x: 586, y: 163 },
  { id: "s4", label: "4", x: 659, y: 281 },
  { id: "s5", label: "5", x: 672, y: 397 },
  { id: "s6", label: "6", x: 500, y: 478 },
  { id: "s7", label: "7", x: 393, y: 535 },
  { id: "s8", label: "8", x: 278, y: 450 },
  { id: "s9", label: "9", x: 343, y: 343 },
  { id: "s10", label: "13", x: 162, y: 177, due: 16 * 60 },
  { id: "s11", label: "14", x: 447, y: 481 },
  { id: "s12", label: "15", x: 475, y: 213 },
  { id: "s13", label: "16", x: 218, y: 407 },
  { id: "f1", label: "10", x: 784, y: 303 },
  { id: "f2", label: "11", x: 960, y: 416 },
  { id: "f3", label: "12", x: 742, y: 454 },
];

export const STORY_SEED = 32921;
export const STORY_EVENT = 12 * 60 + 10;
export const STORY_NEW_JOB: Stop = { id: "new", label: "Н", x: 440, y: 100 };

function cross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const r = (p: Pt, q: Pt, s: Pt) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
  const d1 = r(c, d, a);
  const d2 = r(c, d, b);
  const d3 = r(a, b, c);
  const d4 = r(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function inside(p: Pt, poly: Pt[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function blocked(a: Pt, b: Pt) {
  for (let i = 0; i < PARK.length; i++) if (cross(a, b, PARK[i], PARK[(i + 1) % PARK.length])) return true;
  for (let t = 0.05; t < 1; t += 0.05) if (inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, PARK)) return true;
  return false;
}

const center = PARK.reduce((acc, pt) => ({ x: acc.x + pt.x / PARK.length, y: acc.y + pt.y / PARK.length }), { x: 0, y: 0 });
const CORNERS: Pt[] = PARK.map(pt => {
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  const len = Math.hypot(dx, dy);
  return { x: pt.x + (dx / len) * 16, y: pt.y + (dy / len) * 16 };
});

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

const roadCache = new Map<string, Pt[]>();
export function road(a: Pt, b: Pt): Pt[] {
  const key = `${a.x},${a.y}>${b.x},${b.y}`;
  const hit = roadCache.get(key);
  if (hit) return hit;
  let path: Pt[] = [a, b];
  if (blocked(a, b)) {
    const nodes = [a, b, ...CORNERS];
    const best = nodes.map(() => Number.POSITIVE_INFINITY);
    const prev = nodes.map(() => -1);
    const done = nodes.map(() => false);
    best[0] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || best[i] < best[u])) u = i;
      if (u < 0 || best[u] === Number.POSITIVE_INFINITY) break;
      done[u] = true;
      if (u === 1) break;
      for (let v = 0; v < nodes.length; v++) {
        if (done[v] || v === u || blocked(nodes[u], nodes[v])) continue;
        const next = best[u] + dist(nodes[u], nodes[v]);
        if (next < best[v]) {
          best[v] = next;
          prev[v] = u;
        }
      }
    }
    const out: Pt[] = [];
    for (let v = 1; v >= 0; v = prev[v]) out.unshift(nodes[v]);
    if (out.length >= 2) path = out;
  }
  roadCache.set(key, path);
  return path;
}

export function polyLength(pts: Pt[]) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

export function legLength(a: Pt, b: Pt) {
  return polyLength(road(a, b));
}

export function crossings(poly: Pt[]) {
  const found: Pt[] = [];
  for (let i = 1; i < poly.length; i++) {
    for (let j = i + 2; j < poly.length; j++) {
      const a = poly[i - 1];
      const b = poly[i];
      const c = poly[j - 1];
      const d = poly[j];
      if (!cross(a, b, c, d)) continue;
      const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
      found.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return found;
}

export function clock(minutes: number) {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function reverse(order: string[], i: number, j: number) {
  return [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
}

export type InsertStep = {
  id: string;
  engineer: "e1" | "e2";
  at: number;
  e1: string[];
  e2: string[];
  regret: number;
  cost: number;
  e1Cost: number;
  e2Cost: number;
  regrets: Record<string, number>;
};

export type Move = {
  kind: "better" | "worse" | "late" | "reject";
  i: number;
  j: number;
  before: string[];
  after: string[];
  km: number;
  tryKm: number;
  bestKm: number;
  temp: number;
  chance: number;
  late: string | null;
  p: number;
  bestOrder: string[];
};

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function buildStory(stops: Stop[] = DEFAULT_STOPS, seed = STORY_SEED) {
  const byId = new Map(stops.map(stop => [stop.id, stop]));

  const routePolyline = (base: Pt, order: string[]): Pt[] => {
    const pts: Pt[] = [base];
    let from: Pt = base;
    for (const id of order) {
      const to = byId.get(id)!;
      road(from, to).slice(1).forEach(pt => pts.push(pt));
      from = to;
    }
    return pts;
  };

  const routeKm = (base: Pt, order: string[]) => {
    let total = 0;
    let from: Pt = base;
    for (const id of order) {
      const to = byId.get(id)!;
      total += legLength(from, to);
      from = to;
    }
    return total * KM_PER_PX;
  };

  const schedule = (base: Pt, order: string[], startMin = START_MIN) => {
    const out: Array<{ id: string; arrive: number; start: number; leave: number }> = [];
    let now = startMin;
    let from: Pt = base;
    for (const id of order) {
      const to = byId.get(id)!;
      now += legLength(from, to) / PX_PER_MIN;
      const arrive = now;
      const start = Math.max(arrive, to.ready ?? 0);
      out.push({ id, arrive, start, leave: start + SERVICE_MIN });
      now = start + SERVICE_MIN;
      from = to;
    }
    return out;
  };

  const feasible = (base: Pt, order: string[]) => {
    const plan = schedule(base, order);
    for (const item of plan) {
      const stop = byId.get(item.id)!;
      if (stop.due !== undefined && item.start > stop.due) return false;
    }
    return !plan.length || plan[plan.length - 1].leave <= SHIFT_END;
  };

  const greedy: string[] = (() => {
    const left = new Set(stops.map(stop => stop.id));
    const order: string[] = [];
    let from: Pt = E1;
    while (left.size) {
      let bestId = "";
      let bestD = Number.POSITIVE_INFINITY;
      for (const id of left) {
        const d = legLength(from, byId.get(id)!);
        if (d < bestD) {
          bestD = d;
          bestId = id;
        }
      }
      order.push(bestId);
      left.delete(bestId);
      from = byId.get(bestId)!;
    }
    return order;
  })();

  const insertCost = (base: Pt, order: string[], id: string, at: number) => {
    const next = order.slice();
    next.splice(at, 0, id);
    if (!feasible(base, next)) return Number.POSITIVE_INFINITY;
    return routeKm(base, next) - routeKm(base, order);
  };

  const insertion: InsertStep[] = (() => {
    const steps: InsertStep[] = [];
    let e1: string[] = [];
    let e2: string[] = [];
    const left = new Set(stops.map(stop => stop.id));
    while (left.size) {
      let pick: InsertStep | null = null;
      const regrets: Record<string, number> = {};
      for (const id of left) {
        const stop = byId.get(id)!;
        const bestFor = (engineer: "e1" | "e2") => {
          const base = engineer === "e1" ? E1 : E2;
          const order = engineer === "e1" ? e1 : e2;
          if (stop.only && stop.only !== engineer) return null;
          let best: { engineer: "e1" | "e2"; at: number; cost: number } | null = null;
          for (let at = 0; at <= order.length; at++) {
            const cost = insertCost(base, order, id, at) + (order.length ? 0 : SHIFT_KM);
            if (cost === Number.POSITIVE_INFINITY) continue;
            if (!best || cost < best.cost) best = { engineer, at, cost };
          }
          return best;
        };
        const options = [bestFor("e1"), bestFor("e2")].filter((item): item is { engineer: "e1" | "e2"; at: number; cost: number } => Boolean(item));
        options.sort((a, b) => a.cost - b.cost);
        const best = options[0];
        if (!best) continue;
        const regret = (options[1]?.cost ?? best.cost + SOLO_GAP_KM) - best.cost;
        regrets[id] = regret;
        const e1Cost = options.find(item => item.engineer === "e1")?.cost ?? Number.POSITIVE_INFINITY;
        const e2Cost = options.find(item => item.engineer === "e2")?.cost ?? Number.POSITIVE_INFINITY;
        if (!pick || regret > pick.regret) pick = { id, engineer: best.engineer, at: best.at, e1, e2, regret, cost: best.cost, e1Cost, e2Cost, regrets };
      }
      if (!pick) break;
      if (pick.engineer === "e1") {
        e1 = e1.slice();
        e1.splice(pick.at, 0, pick.id);
      } else {
        e2 = e2.slice();
        e2.splice(pick.at, 0, pick.id);
      }
      steps.push({ ...pick, e1, e2 });
      left.delete(pick.id);
    }
    return steps;
  })();

  const insertedE1 = insertion.length ? insertion[insertion.length - 1].e1 : [];
  const insertedE2 = insertion.length ? insertion[insertion.length - 1].e2 : [];

  const lateStop = (base: Pt, order: string[]) => {
    for (const item of schedule(base, order)) {
      const stop = byId.get(item.id)!;
      if (stop.due !== undefined && item.start > stop.due) return item.id;
    }
    return null;
  };

  const greedyTwoOpt = (start: string[], base: Pt = E1) => {
    let order = start.slice();
    let km = routeKm(base, order);
    const moves: Move[] = [];
    for (let guard = 0; guard < 40; guard++) {
      let found: { i: number; j: number; next: string[]; km: number } | null = null;
      for (let i = 0; i < order.length - 1 && !found; i++) {
        for (let j = i + 1; j < order.length && !found; j++) {
          const next = reverse(order, i, j);
          if (!feasible(base, next)) continue;
          const nextKm = routeKm(base, next);
          if (nextKm + 1e-6 < km) found = { i, j, next, km: nextKm };
        }
      }
      if (!found) break;
      moves.push({ kind: "better", i: found.i, j: found.j, before: order, after: found.next, km: found.km, tryKm: found.km, bestKm: found.km, temp: 0, chance: 0, late: null, p: 0, bestOrder: found.next });
      order = found.next;
      km = found.km;
    }
    return { order, km, moves };
  };

  const twoOpt = greedyTwoOpt(insertedE1);
  const e2Final = greedyTwoOpt(insertedE2, E2).order;

  const stuck = (() => {
    const order = twoOpt.order;
    const baseKm = routeKm(E1, order);
    const worse: Array<{ i: number; j: number; delta: number; late: string | null }> = [];
    const late: Array<{ i: number; j: number; delta: number; late: string | null }> = [];
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = reverse(order, i, j);
        const missed = lateStop(E1, next);
        const delta = routeKm(E1, next) - baseKm;
        if (missed) late.push({ i, j, delta, late: missed });
        else worse.push({ i, j, delta, late: null });
      }
    }
    worse.sort((a, b) => a.delta - b.delta);
    late.sort((a, b) => a.delta - b.delta);
    const picks = [worse[0], late[0], worse[1], worse[2], late[1]].filter(Boolean);
    return { picks, total: worse.length + late.length };
  })();

  const anneal = (() => {
    const random = lcg(seed);
    let current = twoOpt.order.slice();
    let currentKm = routeKm(E1, current);
    let best = current;
    let bestKm = currentKm;
    const deltas: number[] = [];
    for (let n = 0; n < 60; n++) {
      const i = Math.floor(random() * (current.length - 1));
      const j = i + 1 + Math.floor(random() * (current.length - i - 1));
      const next = reverse(current, i, j);
      if (!feasible(E1, next)) continue;
      const delta = routeKm(E1, next) - currentKm;
      if (delta > 0) deltas.push(delta);
    }
    const mu = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
    const P0 = 0.5;
    const P_STOP = 0.01;
    const budget = 260;
    const tau = budget / 4;
    const log: Move[] = [];
    for (let k = 0; k < budget; k++) {
      const p = P0 * Math.exp(-k / tau);
      if (p < P_STOP) break;
      const temp = -mu / Math.log(p);
      const i = Math.floor(random() * (current.length - 1));
      const j = i + 1 + Math.floor(random() * (current.length - i - 1));
      const next = reverse(current, i, j);
      const nextKm = routeKm(E1, next);
      const missed = lateStop(E1, next);
      if (missed) {
        log.push({ kind: "late", i, j, before: current, after: next, km: currentKm, tryKm: nextKm, bestKm, temp, chance: 0, late: missed, p, bestOrder: best });
        continue;
      }
      const delta = nextKm - currentKm;
      const chance = delta <= 0 ? 1 : Math.exp(-delta / temp);
      if (delta <= 0 || random() < chance) {
        const prev = current;
        current = next;
        currentKm = nextKm;
        if (currentKm + 1e-9 < bestKm) {
          best = current;
          bestKm = currentKm;
        }
        log.push({ kind: delta <= 1e-9 ? "better" : "worse", i, j, before: prev, after: current, km: currentKm, tryKm: nextKm, bestKm, temp, chance, late: null, p, bestOrder: best });
      } else {
        log.push({ kind: "reject", i, j, before: current, after: next, km: currentKm, tryKm: nextKm, bestKm, temp, chance, late: null, p, bestOrder: best });
      }
    }
    const polish = greedyTwoOpt(best);
    return { log, best: polish.order, bestKm: polish.km, rawBest: best, rawBestKm: bestKm, polishMoves: polish.moves, mu, startTemp: log[0]?.temp ?? 1 };
  })();

  const replan = (newJob: Stop, eventMin: number) => {
    const all = new Map(byId);
    all.set(newJob.id, newJob);
    const sim = (base: Pt, order: string[], startMin: number) => {
      const out: Array<{ id: string; arrive: number; start: number; leave: number }> = [];
      let now = startMin;
      let from: Pt = base;
      for (const id of order) {
        const to = all.get(id)!;
        now += legLength(from, to) / PX_PER_MIN;
        const start = Math.max(now, to.ready ?? 0);
        out.push({ id, arrive: now, start, leave: start + SERVICE_MIN });
        now = start + SERVICE_MIN;
        from = to;
      }
      return out;
    };
    const km = (base: Pt, order: string[]) => {
      let total = 0;
      let from: Pt = base;
      for (const id of order) {
        const to = all.get(id)!;
        total += legLength(from, to);
        from = to;
      }
      return total * KM_PER_PX;
    };
    const crews = [
      { id: "e1" as const, base: E1 as Pt, order: anneal.best },
      { id: "e2" as const, base: E2 as Pt, order: e2Final },
    ].map(crew => {
      const plan = schedule(crew.base, crew.order);
      let locked = 0;
      while (locked < plan.length && plan[locked].start < eventMin) locked++;
      if (locked < plan.length) {
        const departure = locked ? plan[locked - 1].leave : START_MIN;
        if (departure < eventMin && eventMin < plan[locked].arrive) locked++;
      }
      const done = crew.order.slice(0, locked);
      const pending = crew.order.slice(locked);
      const anchor: Pt = locked ? byId.get(crew.order[locked - 1])! : crew.base;
      const free = Math.max(eventMin, locked ? plan[locked - 1].leave : START_MIN);
      return { ...crew, plan, done, pending, anchor, free };
    });
    type Option = { crew: "e1" | "e2"; at: number; extraKm: number; shift: number; arrive: number };
    const options: Option[] = [];
    for (const crew of crews) {
      const beforeKm = km(crew.anchor, crew.pending);
      for (let at = 0; at <= crew.pending.length; at++) {
        const ids = [...crew.pending.slice(0, at), newJob.id, ...crew.pending.slice(at)];
        const after = sim(crew.anchor, ids, crew.free);
        if (after[after.length - 1].leave > SHIFT_END) continue;
        if (after.some(item => {
          const due = all.get(item.id)!.due;
          return due !== undefined && item.start > due;
        })) continue;
        let shift = 0;
        for (const item of after) {
          if (item.id === newJob.id) continue;
          const old = crew.plan.find(stop => stop.id === item.id)!;
          shift = Math.max(shift, item.start - old.start);
        }
        const arrive = after.find(item => item.id === newJob.id)!.start;
        options.push({ crew: crew.id, at, extraKm: km(crew.anchor, ids) - beforeKm, shift, arrive });
      }
    }
    const shortest = options.slice().sort((a, b) => a.extraKm - b.extraKm)[0];
    const kept = options.filter(item => item.shift < 0.5).sort((a, b) => a.extraKm - b.extraKm)[0] ?? null;
    return { eventMin, newJob, crews, shortest, kept };
  };

  return { stops, byId, routePolyline, routeKm, schedule, feasible, lateStop, greedy, insertion, insertedE1, insertedE2, e2Final, twoOpt, stuck, anneal, replan };
}

export type Story = ReturnType<typeof buildStory>;
