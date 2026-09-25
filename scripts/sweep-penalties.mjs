import { readFileSync } from "node:fs";
import { compatible, fallbackTravel, simulate } from "../lib/vrptw.ts";

const SPEED = 24;
const travel = fallbackTravel(SPEED);
const EQUIP = {
  "Локальные работы": "Диагностический комплект",
  "Работы на подключение и дозаказы": "ONT",
  "Аварийные работы": "Рефлектометр",
};

function clock(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function load(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  return {
    engineers: data.engineers.map(item => ({
      id: item.id, initials: item.id, name: item.name, route: item.id, jobs: 0, distance: "0", load: 0,
      color: "#000", region: "Восток", start: [item.lon, item.lat], skills: item.skills,
      equipment: [...new Set(item.skills.map(skill => EQUIP[skill]))], transport: item.vehicle,
      shiftStart: clock(item.shiftStart), shiftEnd: clock(item.shiftEnd),
    })),
    jobs: data.jobs.map(item => ({
      id: item.id, time: "", windowStart: clock(item.windowStart), windowEnd: clock(item.windowEnd),
      area: "Москва", address: item.address, kind: item.skills[0], tone: "violet", region: "Восток",
      engineerId: null, baselineEngineerId: null, coordinates: [item.lon, item.lat], risk: false,
      equipment: EQUIP[item.skills[0]], requiredTransport: item.vehicle ?? "",
      priority: item.priority === "Срочная" ? 10 : 1, serviceMinutes: item.durationMin, source: "bench", status: "Новая",
    })),
  };
}

function place(engineer, route, job, distanceWeight, vehicleCost) {
  const before = route.length ? simulate(engineer, route, true, SPEED, travel)?.distanceKm ?? 0 : 0;
  let best = null;
  for (let index = 0; index <= route.length; index++) {
    const next = [...route.slice(0, index), job, ...route.slice(index)];
    const plan = simulate(engineer, next, true, SPEED, travel);
    if (!plan) continue;
    const score = (plan.distanceKm - before) * distanceWeight + (route.length ? 0 : vehicleCost);
    if (!best || score < best.score) best = { route: next, score };
  }
  return best;
}

function regret(engineers, jobs, distanceWeight, vehicleCost) {
  const routes = new Map(engineers.map(engineer => [engineer.id, []]));
  const open = [...jobs];
  while (open.length) {
    let pick = null;
    for (let jobIndex = 0; jobIndex < open.length; jobIndex++) {
      const job = open[jobIndex];
      const costs = [];
      for (const engineer of engineers) {
        if (!compatible(engineer, job)) continue;
        const placed = place(engineer, routes.get(engineer.id), job, distanceWeight, vehicleCost);
        if (placed) costs.push({ engineer, ...placed });
      }
      if (!costs.length) continue;
      costs.sort((a, b) => a.score - b.score);
      const gap = (costs[1]?.score ?? costs[0].score + vehicleCost) - costs[0].score;
      if (!pick || gap > pick.gap) pick = { jobIndex, engineer: costs[0].engineer, route: costs[0].route, gap };
    }
    if (!pick) break;
    routes.set(pick.engineer.id, pick.route);
    open.splice(pick.jobIndex, 1);
  }
  const assigned = new Set([...routes.values()].flat().map(job => job.id));
  for (const job of jobs) {
    if (assigned.has(job.id)) continue;
    let best = null;
    for (const from of engineers) {
      const current = routes.get(from.id);
      for (let index = 0; index < current.length; index++) {
        const displaced = current[index];
        const without = current.filter((_, at) => at !== index);
        if (!compatible(from, job)) continue;
        const withJob = place(from, without, job, distanceWeight, vehicleCost);
        if (!withJob) continue;
        for (const to of engineers) {
          if (!compatible(to, displaced)) continue;
          const destination = to.id === from.id ? withJob.route : routes.get(to.id);
          const back = place(to, destination, displaced, distanceWeight, vehicleCost);
          if (!back) continue;
          const km = to.id === from.id ? back.score : withJob.score + back.score;
          if (!best || km < best.km) best = { from, to, fromRoute: to.id === from.id ? back.route : withJob.route, toRoute: back.route, km };
        }
      }
    }
    if (!best) continue;
    routes.set(best.from.id, best.fromRoute);
    if (best.to.id !== best.from.id) routes.set(best.to.id, best.toRoute);
    assigned.add(job.id);
  }
  return routes;
}

function measure(engineers, jobs, routes) {
  let assigned = 0;
  let urgent = 0;
  let fleet = 0;
  let km = 0;
  for (const engineer of engineers) {
    const route = routes.get(engineer.id);
    if (!route.length) continue;
    const plan = simulate(engineer, route, true, SPEED, travel);
    fleet += 1;
    km += plan.distanceKm;
    assigned += route.length;
    urgent += route.filter(job => job.priority >= 10).length;
  }
  return { assigned, urgent, fleet, km };
}

const sets = [
  "generator/datasets/bench-tight/dataset.json",
  "generator/datasets/bench-mixed/dataset.json",
  "generator/datasets/bench-transport/dataset.json",
  "generator/datasets/bench-wide/dataset.json",
].map(load);

const distanceWeights = [1, 5, 10, 15, 25];
const vehicleCosts = [0, 8, 40, 80, 140, 200, 350, 700, 1400, 2800];
const rows = [];
for (const distanceWeight of distanceWeights) {
  for (const vehicleCost of vehicleCosts) {
    const total = { distanceWeight, vehicleCost, assigned: 0, urgent: 0, fleet: 0, km: 0 };
    for (const set of sets) {
      const result = measure(set.engineers, set.jobs, regret(set.engineers, set.jobs, distanceWeight, vehicleCost));
      total.assigned += result.assigned;
      total.urgent += result.urgent;
      total.fleet += result.fleet;
      total.km += result.km;
    }
    rows.push(total);
    console.log(`${distanceWeight}\t${vehicleCost}\t${total.assigned}\t${total.urgent}\t${total.fleet}\t${total.km.toFixed(1)}`);
  }
}

rows.sort((a, b) => b.assigned - a.assigned || b.urgent - a.urgent || a.fleet - b.fleet || a.km - b.km);
console.log("BEST");
for (const row of rows.slice(0, 8)) {
  const kmEach = row.distanceWeight ? (row.vehicleCost / row.distanceWeight).toFixed(1) : "inf";
  console.log(`w${row.distanceWeight} c${row.vehicleCost} (${kmEach} км/инженер) ${row.assigned} urgent ${row.urgent} fleet ${row.fleet} km ${row.km.toFixed(1)}`);
}
