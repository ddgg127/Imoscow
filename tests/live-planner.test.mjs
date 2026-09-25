import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { unforeseenEvent, mergeTemporalResult, prepareTemporalReplan } from "../lib/temporal-replan.ts";
import { compatible, fallbackTravel, optimizeVrptw, simulate } from "../lib/vrptw.ts";

const EQUIP = {
  "Локальные работы": "Диагностический комплект",
  "Работы на подключение и дозаказы": "ONT",
  "Аварийные работы": "Рефлектометр",
};
const SKILLS = Object.keys(EQUIP);

function clock(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function loadBench(name) {
  const data = JSON.parse(readFileSync(new URL(`../generator/datasets/${name}/dataset.json`, import.meta.url), "utf8"));
  const engineers = data.engineers.map(item => ({
    id: item.id, initials: item.id.slice(0, 2), name: item.name, route: item.id, jobs: 0, distance: "0", load: 0,
    color: "#000", region: "Восток", start: [item.lon, item.lat], skills: item.skills,
    equipment: [...new Set(item.skills.map(skill => EQUIP[skill]))], transport: item.vehicle,
    shiftStart: clock(item.shiftStart), shiftEnd: clock(item.shiftEnd),
  }));
  const jobs = data.jobs.map(item => ({
    id: item.id, time: `${item.windowStart}–${item.windowEnd}`, windowStart: clock(item.windowStart), windowEnd: clock(item.windowEnd),
    area: "Москва", address: item.address, kind: item.skills[0], tone: "violet", region: "Восток",
    engineerId: null, baselineEngineerId: null, coordinates: [item.lon, item.lat], risk: false,
    equipment: EQUIP[item.skills[0]], requiredTransport: item.vehicle ?? "", priority: item.priority === "Срочная" ? 10 : 1,
    serviceMinutes: item.durationMin, source: name, status: "Новая",
  }));
  return { engineers, jobs, events: data.events };
}

function assertFeasible(engineers, result) {
  const seen = new Set();
  for (const route of result.routes) {
    const engineer = engineers.find(item => item.id === route.engineerId);
    const jobs = route.stops.map(stop => result.jobs.find(job => job.id === stop.jobId));
    assert.equal(simulate(engineer, jobs, true, 24, fallbackTravel(24))?.stops.length, jobs.length);
    for (const job of jobs) {
      assert.equal(seen.has(job.id), false);
      seen.add(job.id);
      assert.equal(compatible(engineer, job), true);
      assert.equal(job.engineerId, engineer.id);
    }
  }
  for (const job of result.jobs) {
    if (job.engineerId || job.cancelled) continue;
    assert.match(job.unassignedReason ?? "", /\S/);
  }
}

test("bench sets give mixed skills, transports and overlapping windows", () => {
  const packed = ["bench-tight", "bench-mixed", "bench-transport", "bench-wide"].map(loadBench);
  for (const set of packed) {
    assert.ok(set.engineers.length >= 24 && set.jobs.length >= 80);
    assert.equal(new Set(set.jobs.map(job => job.kind)).size, 3);
    assert.ok(new Set(set.engineers.flatMap(engineer => engineer.skills)).size === 3);
    assert.ok(set.engineers.some(engineer => engineer.skills.length >= 2));
    assert.ok(new Set(set.engineers.map(engineer => engineer.transport)).size >= 3);
    const widths = new Set(set.jobs.map(job => job.windowEnd - job.windowStart));
    assert.ok(widths.size >= 5);
    const overlaps = set.jobs.filter(job => set.jobs.some(other => other.id !== job.id && other.windowStart < job.windowEnd && job.windowStart < other.windowEnd));
    assert.ok(overlaps.length > set.jobs.length * 0.5);
    assert.deepEqual(set.events.map(event => event.type), ["отмена заявки", "недоступность инженера", "срочная заявка"]);
  }
});

test("regret planner covers the tight live set and explains every miss", () => {
  const { engineers, jobs } = loadBench("bench-tight");
  const result = optimizeVrptw(engineers, jobs, { speedKmh: 24, travel: fallbackTravel(24), zoneBudget: 4 });
  assertFeasible(engineers, result);
  assert.ok(result.metrics.assigned >= 76, `assigned ${result.metrics.assigned}`);
  assert.equal(result.metrics.assigned + result.metrics.unassigned, jobs.length);
});

test("an unforeseen cancel is applied only after the plan exists", () => {
  const { engineers, jobs } = loadBench("bench-tight");
  const sliceE = engineers.slice(0, 12);
  const sliceJ = jobs.slice(0, 30);
  const before = optimizeVrptw(sliceE, sliceJ, { speedKmh: 24, travel: fallbackTravel(24), zoneBudget: 2 });
  const event = unforeseenEvent(before, sliceE, sliceJ);
  assert.equal(before.jobs.some(job => job.id === event.id && job.cancelled), false);
  const nextJobs = sliceJ.map(job => job.id === event.id ? { ...job, cancelled: true } : job);
  const prepared = prepareTemporalReplan(before, sliceE, nextJobs, [], event);
  assert.equal(prepared.lockedJobIds.has(event.id), false);
  const suffix = optimizeVrptw(prepared.continuationEngineers, prepared.remainingJobs, { speedKmh: 24, travel: fallbackTravel(24), zoneBudget: 2 });
  const after = mergeTemporalResult(before, suffix, prepared, sliceE, nextJobs, 24, fallbackTravel(24));
  assert.equal(after.jobs.find(job => job.id === event.id).engineerId, null);
  for (const id of prepared.lockedJobIds) {
    const oldStop = before.routes.flatMap(route => route.stops).find(stop => stop.jobId === id);
    const newStop = after.routes.flatMap(route => route.stops).find(stop => stop.jobId === id);
    assert.equal(newStop.start, oldStop.start);
  }
});

test("stress: 40 engineers and 160 jobs with 15-minute windows still stay feasible", () => {
  const engineers = Array.from({ length: 40 }, (_, index) => ({
    id: `S${index}`, initials: "S", name: `Инженер ${index}`, route: `S${index}`, jobs: 0, distance: "0", load: 0, color: "#000",
    region: "Восток", start: [37.4 + (index % 8) * 0.03, 55.6 + Math.floor(index / 8) * 0.02],
    skills: SKILLS.slice(0, 1 + (index % 3)), equipment: SKILLS.slice(0, 1 + (index % 3)).map(skill => EQUIP[skill]),
    transport: ["Автомобиль", "Пешеход", "Велосипед", "Общественный транспорт"][index % 4],
    shiftStart: 8 * 60, shiftEnd: 20 * 60,
  }));
  const jobs = Array.from({ length: 160 }, (_, index) => {
    const skill = SKILLS[index % 3];
    const start = 8 * 60 + (index % 20) * 15;
    return {
      id: `Q${index}`, time: "", windowStart: start, windowEnd: start + 15, area: "стресс", address: `точка ${index}`,
      kind: skill, tone: "violet", region: "Восток", engineerId: null, baselineEngineerId: null,
      coordinates: [37.45 + (index % 16) * 0.02, 55.62 + Math.floor(index / 16) * 0.015], risk: false,
      equipment: EQUIP[skill], requiredTransport: index % 7 === 0 ? engineers[index % 40].transport : "",
      priority: index % 5 === 0 ? 10 : 1, serviceMinutes: 20, source: "stress", status: "Новая",
    };
  });
  const result = optimizeVrptw(engineers, jobs, { speedKmh: 24, travel: fallbackTravel(24), zoneBudget: 1 });
  assertFeasible(engineers, result);
  assert.equal(result.metrics.total, 160);
  assert.ok(result.jobs.filter(job => !job.engineerId).every(job => job.unassignedReason));
});
