import { readFileSync } from "node:fs";
import { compatible, fallbackTravel, resourceBlocker, simulate } from "../lib/vrptw.ts";

const SPEED = 24;
const travel = fallbackTravel(SPEED);
const EQUIP = {
  "Локальные работы": "Диагностический комплект",
  "Работы на подключение и дозаказы": "ONT",
  "Аварийные работы": "Рефлектометр",
};

function clock(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function load(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const engineers = data.engineers.map(item => ({
    id: item.id, initials: item.name.slice(0, 2), name: item.name, route: item.id, jobs: 0, distance: "0", load: 0,
    color: "#000", region: "Восток", start: [item.lon, item.lat],
    skills: item.skills, equipment: [...new Set(item.skills.map(skill => EQUIP[skill]))],
    transport: item.vehicle, shiftStart: clock(item.shiftStart), shiftEnd: clock(item.shiftEnd),
  }));
  const jobs = data.jobs.map(item => ({
    id: item.id, time: `${item.windowStart}–${item.windowEnd}`, windowStart: clock(item.windowStart), windowEnd: clock(item.windowEnd),
    area: "Москва", address: item.address, kind: item.skills[0], tone: "violet", region: "Восток",
    engineerId: null, baselineEngineerId: null, coordinates: [item.lon, item.lat], risk: false,
    equipment: EQUIP[item.skills[0]], requiredTransport: item.vehicle ?? "", priority: item.priority === "Срочная" ? 10 : 1,
    serviceMinutes: item.durationMin, source: "bench", status: "Новая", urgency: item.priority === "Срочная" ? "urgent" : "normal",
  }));
  return { name: file.split(/[\\/]/).at(-2), engineers, jobs, events: data.events };
}

function blank(engineers) {
  return new Map(engineers.map(engineer => [engineer.id, []]));
}

function place(engineer, route, job, scoreOf) {
  let best = null;
  for (let index = 0; index <= route.length; index++) {
    const next = [...route.slice(0, index), job, ...route.slice(index)];
    const plan = simulate(engineer, next, true, SPEED, travel);
    if (!plan) continue;
    const score = scoreOf(plan, route.length === 0);
    if (!best || score < best.score) best = { route: next, plan, score };
  }
  return best;
}

function kmOf(plan) { return plan.distanceKm; }
function waitOf(plan) { return plan.stops.reduce((sum, stop) => sum + Math.max(0, stop.start - stop.arrival), 0); }
function fieldOf(plan, opened) { return plan.distanceKm * 10 + waitOf(plan) * 0.35 + (opened ? 140 : 0); }

function insertOrdered(engineers, jobs, order, scoreOf = (plan, opened) => kmOf(plan) + (opened ? 14 : 0)) {
  const routes = blank(engineers);
  const ordered = [...jobs].sort(order);
  for (const job of ordered) {
    let chosen = null;
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const current = routes.get(engineer.id);
      const placed = place(engineer, current, job, scoreOf);
      if (placed && (!chosen || placed.score < chosen.score)) chosen = { engineer, ...placed };
    }
    if (chosen) routes.set(chosen.engineer.id, chosen.route);
  }
  return routes;
}

function appendOnly(engineers, jobs, order) {
  const routes = blank(engineers);
  for (const job of [...jobs].sort(order)) {
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const next = [...routes.get(engineer.id), job];
      if (simulate(engineer, next, true, SPEED, travel)) { routes.set(engineer.id, next); break; }
    }
  }
  return routes;
}

function globalCheapest(engineers, jobs, scoreOf = plan => plan.distanceKm) {
  const routes = blank(engineers);
  const open = new Set(jobs.map(job => job.id));
  const byId = new Map(jobs.map(job => [job.id, job]));
  while (open.size) {
    let best = null;
    for (const id of open) {
      const job = byId.get(id);
      for (const engineer of engineers) {
        if (!compatible(engineer, job)) continue;
        const current = routes.get(engineer.id);
        const before = current.length ? simulate(engineer, current, true, SPEED, travel) : null;
        const placed = place(engineer, current, job, plan => scoreOf(plan) - (before ? scoreOf(before) : 0) + (current.length ? 0 : 14));
        if (placed && (!best || placed.score < best.score)) best = { id, engineer, route: placed.route, score: placed.score };
      }
    }
    if (!best) break;
    routes.set(best.engineer.id, best.route);
    open.delete(best.id);
  }
  return routes;
}

function regret(engineers, jobs, pool) {
  const routes = blank(engineers);
  let open = pool ? [...jobs].sort(pool) : [...jobs];
  while (open.length) {
    const slice = pool ? open.slice(0, Math.min(12, open.length)) : open;
    let pick = null;
    for (const job of slice) {
      const costs = [];
      for (const engineer of engineers) {
        if (!compatible(engineer, job)) continue;
        const current = routes.get(engineer.id);
        const before = current.length ? simulate(engineer, current, true, SPEED, travel)?.distanceKm ?? 0 : 0;
        const placed = place(engineer, current, job, plan => plan.distanceKm - before + (current.length ? 0 : 8));
        if (placed) costs.push({ engineer, route: placed.route, score: placed.score });
      }
      if (!costs.length) continue;
      costs.sort((a, b) => a.score - b.score);
      const gap = (costs[1]?.score ?? costs[0].score + 12) - costs[0].score;
      if (!pick || gap > pick.gap) pick = { job, gap, ...costs[0] };
    }
    if (!pick) break;
    routes.set(pick.engineer.id, pick.route);
    open = open.filter(job => job.id !== pick.job.id);
  }
  return routes;
}

function relocateOnce(engineers, jobs, routes) {
  const assigned = new Set([...routes.values()].flat().map(job => job.id));
  const loose = jobs.filter(job => !assigned.has(job.id));
  for (const job of loose) {
    let best = null;
    for (const from of engineers) {
      const current = routes.get(from.id);
      for (let index = 0; index < current.length; index++) {
        const displaced = current[index];
        const without = current.filter((_, i) => i !== index);
        if (!compatible(from, job)) continue;
        const withJob = place(from, without, job, plan => plan.distanceKm);
        if (!withJob) continue;
        for (const to of engineers) {
          if (!compatible(to, displaced)) continue;
          const dest = to.id === from.id ? withJob.route : routes.get(to.id);
          const back = place(to, dest, displaced, plan => plan.distanceKm);
          if (!back) continue;
          const km = (to.id === from.id ? back.plan.distanceKm : withJob.plan.distanceKm + back.plan.distanceKm);
          if (!best || km < best.km) best = { from, to, fromRoute: to.id === from.id ? back.route : withJob.route, toRoute: back.route, km };
        }
      }
    }
    if (!best) continue;
    routes.set(best.from.id, best.fromRoute);
    if (best.to.id !== best.from.id) routes.set(best.to.id, best.toRoute);
  }
  return routes;
}

const byRelease = (a, b) => (a.windowStart + a.serviceMinutes) - (b.windowStart + b.serviceMinutes) || b.priority - a.priority;
const byEnd = (a, b) => a.windowEnd - b.windowEnd || b.priority - a.priority;
const byStart = (a, b) => a.windowStart - b.windowStart || b.priority - a.priority;
const byPriority = (a, b) => b.priority - a.priority || byRelease(a, b);
const byPriorityEnd = (a, b) => b.priority - a.priority || a.windowEnd - b.windowEnd;
const bySlack = (a, b) => (a.windowEnd - a.windowStart - a.serviceMinutes) - (b.windowEnd - b.windowStart - b.serviceMinutes) || b.priority - a.priority;
const byService = (a, b) => a.serviceMinutes - b.serviceMinutes || byRelease(a, b);
const byLong = (a, b) => b.serviceMinutes - a.serviceMinutes;
const byLate = (a, b) => b.windowEnd - a.windowEnd;
const inputOrder = () => 0;

const algorithms = [
  ["a01-release-km", (e, j) => insertOrdered(e, j, byRelease)],
  ["a02-window-end", (e, j) => insertOrdered(e, j, byEnd)],
  ["a03-window-start", (e, j) => insertOrdered(e, j, byStart)],
  ["a04-urgent-then-release", (e, j) => insertOrdered(e, j, byPriority)],
  ["a05-urgent-then-end", (e, j) => insertOrdered(e, j, byPriorityEnd)],
  ["a06-tight-slack", (e, j) => insertOrdered(e, j, bySlack)],
  ["a07-short-service", (e, j) => insertOrdered(e, j, byService)],
  ["a08-long-first", (e, j) => insertOrdered(e, j, byLong)],
  ["a09-latest-first", (e, j) => insertOrdered(e, j, byLate)],
  ["a10-input-order", (e, j) => insertOrdered(e, j, inputOrder)],
  ["a11-baseline-append", (e, j) => appendOnly(e, j, inputOrder)],
  ["a12-append-release", (e, j) => appendOnly(e, j, byRelease)],
  ["a13-release-wait", (e, j) => insertOrdered(e, j, byRelease, plan => waitOf(plan) * 10 + plan.distanceKm)],
  ["a14-release-fieldflow", (e, j) => insertOrdered(e, j, byRelease, (plan, opened) => fieldOf(plan, opened))],
  ["a15-end-fieldflow", (e, j) => insertOrdered(e, j, byEnd, (plan, opened) => fieldOf(plan, opened))],
  ["a16-urgent-fieldflow", (e, j) => insertOrdered(e, j, byPriority, (plan, opened) => fieldOf(plan, opened))],
  ["a17-few-engineers", (e, j) => insertOrdered(e, j, byRelease, (plan, opened) => (opened ? 1000 : 0) + plan.distanceKm)],
  ["a18-time-heavy", (e, j) => insertOrdered(e, j, bySlack, plan => plan.durationMinutes + plan.distanceKm)],
  ["a19-nearest", (e, j) => insertOrdered(e, j, byStart, plan => plan.stops.at(-1).distanceKm + (plan.stops.length === 1 ? 6 : 0))],
  ["a20-global-cheapest", (e, j) => globalCheapest(e, j)],
  ["a21-global-fieldflow", (e, j) => globalCheapest(e, j, plan => plan.distanceKm * 10 + waitOf(plan) * 0.35)],
  ["a22-regret", (e, j) => regret(e, j)],
  ["a23-regret-release-pool", (e, j) => regret(e, j, byRelease)],
  ["a24-regret-urgent-pool", (e, j) => regret(e, j, byPriority)],
  ["a25-release-plus-relocate", (e, j) => relocateOnce(e, j, insertOrdered(e, j, byRelease))],
  ["a26-regret-plus-relocate", (e, j) => relocateOnce(e, j, regret(e, j, byRelease))],
  ["a27-urgent-regret-then-release", (e, j) => {
    const urgent = j.filter(job => job.priority >= 10);
    const rest = j.filter(job => job.priority < 10);
    const routes = regret(e, urgent);
    return insertOrderedInto(e, rest, byRelease, routes);
  }],
  ["a28-scarce-skill-first", (e, j) => insertOrdered(e, j, (a, b) => e.filter(x => compatible(x, a)).length - e.filter(x => compatible(x, b)).length || byRelease(a, b))],
  ["a29-overlap-first", (e, j) => insertOrdered(e, j, (a, b) => overlapCount(j, b) - overlapCount(j, a) || byRelease(a, b))],
  ["a30-release-then-regret-tail", (e, j) => {
    const head = [...j].sort(byRelease).slice(0, Math.ceil(j.length * 0.55));
    const tail = j.filter(job => !head.includes(job));
    const routes = insertOrdered(e, head, byRelease);
    return regretInto(e, tail, routes);
  }],
];

function overlapCount(jobs, job) {
  return jobs.reduce((sum, other) => sum + (other.id !== job.id && other.windowStart < job.windowEnd && job.windowStart < other.windowEnd ? 1 : 0), 0);
}

function insertOrderedInto(engineers, jobs, order, routes) {
  for (const job of [...jobs].sort(order)) {
    let chosen = null;
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const placed = place(engineer, routes.get(engineer.id), job, plan => plan.distanceKm + (routes.get(engineer.id).length ? 0 : 14));
      if (placed && (!chosen || placed.score < chosen.score)) chosen = { engineer, route: placed.route, score: placed.score };
    }
    if (chosen) routes.set(chosen.engineer.id, chosen.route);
  }
  return routes;
}

function regretInto(engineers, jobs, routes) {
  let open = [...jobs];
  while (open.length) {
    let pick = null;
    for (const job of open) {
      const costs = [];
      for (const engineer of engineers) {
        if (!compatible(engineer, job)) continue;
        const current = routes.get(engineer.id);
        const placed = place(engineer, current, job, plan => plan.distanceKm + (current.length ? 0 : 8));
        if (placed) costs.push({ engineer, route: placed.route, score: placed.score });
      }
      if (!costs.length) continue;
      costs.sort((a, b) => a.score - b.score);
      const gap = (costs[1]?.score ?? costs[0].score + 12) - costs[0].score;
      if (!pick || gap > pick.gap) pick = { job, gap, ...costs[0] };
    }
    if (!pick) break;
    routes.set(pick.engineer.id, pick.route);
    open = open.filter(job => job.id !== pick.job.id);
  }
  return routes;
}

function score(engineers, jobs, routes) {
  let assigned = 0;
  let urgent = 0;
  let km = 0;
  let fleet = 0;
  const urgentTotal = jobs.filter(job => job.priority >= 10).length;
  for (const engineer of engineers) {
    const route = routes.get(engineer.id);
    if (!route.length) continue;
    const plan = simulate(engineer, route, true, SPEED, travel);
    if (!plan) throw new Error(`infeasible ${engineer.id}`);
    fleet += 1;
    km += plan.distanceKm;
    assigned += plan.stops.length;
    urgent += route.filter(job => job.priority >= 10).length;
  }
  const seen = new Set([...routes.values()].flat().map(job => job.id));
  if (seen.size !== assigned) throw new Error("duplicate assignment");
  return { assigned, total: jobs.length, urgent, urgentTotal, fleet, km, missed: jobs.length - assigned };
}

function rank(rows) {
  return [...rows].sort((a, b) => b.assigned - a.assigned || b.urgent - a.urgent || a.fleet - b.fleet || a.km - b.km);
}

const files = [
  "generator/datasets/bench-tight/dataset.json",
  "generator/datasets/bench-mixed/dataset.json",
  "generator/datasets/bench-transport/dataset.json",
  "generator/datasets/bench-wide/dataset.json",
];
const points = new Map(algorithms.map(([id]) => [id, 0]));
const totals = new Map(algorithms.map(([id]) => [id, { assigned: 0, total: 0, urgent: 0, urgentTotal: 0, fleet: 0, km: 0 }]));

for (const file of files) {
  const set = load(file);
  const rows = [];
  for (const [id, run] of algorithms) {
    const started = performance.now();
    const routes = run(set.engineers, set.jobs);
    const result = score(set.engineers, set.jobs, routes);
    result.id = id;
    result.ms = Math.round(performance.now() - started);
    rows.push(result);
    const acc = totals.get(id);
    acc.assigned += result.assigned; acc.total += result.total; acc.urgent += result.urgent;
    acc.urgentTotal += result.urgentTotal; acc.fleet += result.fleet; acc.km += result.km;
  }
  const ordered = rank(rows);
  ordered.forEach((row, index) => points.set(row.id, points.get(row.id) + (algorithms.length - index)));
  console.log(`\n${set.name} ${set.engineers.length}x${set.jobs.length}`);
  for (const row of ordered.slice(0, 8)) console.log(`${row.id}  ${row.assigned}/${row.total} urgent ${row.urgent}/${row.urgentTotal} fleet ${row.fleet} km ${row.km.toFixed(1)} ${row.ms}ms`);
  const sample = set.jobs[0];
  if (!resourceBlocker(set.engineers, sample)) throw new Error("resource reason missing");
}

const board = [...points].map(([id, pts]) => ({ id, pts, ...totals.get(id) })).sort((a, b) => b.pts - a.pts || b.assigned - a.assigned || b.urgent - a.urgent || a.fleet - b.fleet || a.km - b.km);
console.log("\nLEADERBOARD");
for (const row of board) console.log(`${row.pts}\t${row.id}\t${row.assigned}/${row.total}\turgent ${row.urgent}/${row.urgentTotal}\tfleet ${row.fleet}\tkm ${row.km.toFixed(1)}`);
