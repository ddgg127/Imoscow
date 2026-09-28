import assert from "node:assert/strict";
import test from "node:test";
import { issueDailyEquipment } from "../lib/equipment-issue.ts";
import { fallbackTravel, resultFromRouteOrder } from "../lib/vrptw.ts";
import { mergeTemporalResult, prepareTemporalReplan } from "../lib/temporal-replan.ts";

const engineer = (id, equipment) => ({ id, name: id, initials: id, route: id, jobs: 0, distance: "0", load: 0, color: "#000", region: "Восток", start: [37.78, 55.71], skills: ["Ремонт"], equipment, transport: "Автомобиль", shiftStart: 480, shiftEnd: 1000 });
const job = (id, equipment, priority = 1) => ({ id, time: "08:00–16:00", windowStart: 480, windowEnd: 960, serviceMinutes: 30, area: "", address: id, kind: "Ремонт", tone: "blue", region: "Восток", engineerId: null, baselineEngineerId: null, coordinates: [37.78, 55.71], risk: false, equipment, requiredTransport: "", priority, source: "test", status: "Новая" });

test("pre-shift issue gives each engineer one type and reserves unique urgent equipment", () => {
  const jobs = [job("ordinary", "ONT"), job("rare", "Рефлектометр", 2)];
  const issued = issueDailyEquipment([engineer("unique", ["ONT"]), engineer("flex", ["ONT", "Рефлектометр"])], jobs);
  assert.deepEqual(issued.map(item => item.equipment), [["ONT"], ["Рефлектометр"]]);
  assert.deepEqual(issued[1].equipmentOptions, ["ONT", "Рефлектометр"]);
});

test("equipment choice counts work that fits the schedule, not just raw demand", () => {
  const tight = ["A1", "A2", "A3"].map(id => ({ ...job(id, "A"), windowEnd: 480, serviceMinutes: 60 }));
  const spaced = [{ ...job("B1", "B"), windowEnd: 550, serviceMinutes: 60 }, { ...job("B2", "B"), windowStart: 650, windowEnd: 700, serviceMinutes: 60 }];
  const [issued] = issueDailyEquipment([engineer("flex", ["A", "B"])], [...tight, ...spaced]);
  assert.deepEqual(issued.equipment, ["B"]);
});

test("one low-demand kit yields to a kit serving five compatible visits", () => {
  const oldKit = { ...job("A1", "A"), windowStart: 480, windowEnd: 540, serviceMinutes: 30 };
  const visits = Array.from({ length: 5 }, (_, index) => ({ ...job(`B${index + 1}`, "B"), windowStart: 480 + index * 70, windowEnd: 540 + index * 70, serviceMinutes: 30 }));
  assert.deepEqual(issueDailyEquipment([engineer("flex", ["A", "B"])], [oldKit, ...visits])[0].equipment, ["B"]);
});

test("pre-shift kit choice uses the loaded travel matrix", () => {
  const crew = [{ ...engineer("flex", ["A", "B"]), start: [0, 0] }];
  const jobs = [{ ...job("A1", "A"), coordinates: [0.1, 0], windowEnd: 500 }, { ...job("B1", "B"), coordinates: [0.2, 0], windowEnd: 500 }];
  const travel = { distanceKm: (_from, to) => to[0] === 0.1 ? 50 : 1, durationMin: (_from, to) => to[0] === 0.1 ? 80 : 5 };
  assert.deepEqual(issueDailyEquipment(crew, jobs, travel)[0].equipment, ["B"]);
});

test("kit exchange improves travel without dropping either equipment type", () => {
  const crew = [
    { ...engineer("west", ["A", "B"]), start: [0, 0] },
    { ...engineer("east", ["A", "B"]), start: [10, 0] },
  ];
  const jobs = [
    { ...job("B", "B"), coordinates: [10, 0], windowEnd: 720 },
    { ...job("A", "A"), coordinates: [0, 0], windowEnd: 900 },
  ];
  const travel = { distanceKm: (from, to) => Math.abs(from[0] - to[0]) * 10, durationMin: (from, to) => Math.abs(from[0] - to[0]) * 10 };
  const issued = issueDailyEquipment(crew, jobs, travel);
  assert.deepEqual(issued.map(item => item.equipment), [["A"], ["B"]]);
});

test("repeated pre-shift planning reselects kits from the full inventory when windows change", () => {
  const source = ["A1", "A2", "A3"].map(id => ({ ...job(id, "A"), windowEnd: 480, serviceMinutes: 60 }));
  source.push({ ...job("B1", "B"), windowEnd: 550, serviceMinutes: 60 }, { ...job("B2", "B"), windowStart: 650, windowEnd: 700, serviceMinutes: 60 });
  const first = issueDailyEquipment([engineer("flex", ["A", "B"])], source);
  const changedWindows = source.map(item => item.equipment === "A" ? { ...item, windowEnd: 960 } : item);
  const changed = issueDailyEquipment(first, changedWindows);
  const repeated = issueDailyEquipment(changed, changedWindows);
  const restored = issueDailyEquipment(repeated, source);
  assert.deepEqual(first[0].equipment, ["B"]);
  assert.deepEqual(changed[0].equipment, ["A"]);
  assert.deepEqual(repeated[0].equipment, ["A"]);
  assert.deepEqual(restored[0].equipment, ["B"]);
  assert.deepEqual(restored[0].equipmentOptions, ["A", "B"]);
});

test("outage cannot reissue a rare kit mid-shift, so future work stays unassigned", () => {
  const jobs = [job("rare", "Рефлектометр", 2)];
  const crew = issueDailyEquipment([engineer("rare-carrier", ["Рефлектометр"]), engineer("other", ["ONT", "Рефлектометр"])], jobs);
  // A manual pre-shift choice can leave the second engineer with only ONT.
  const fixed = [crew[0], { ...crew[1], equipment: ["ONT"], equipmentOptions: ["ONT"] }];
  const travel = fallbackTravel(24);
  const previous = resultFromRouteOrder(fixed, jobs, [{ engineerId: "rare-carrier", jobIds: ["rare"] }], { speedKmh: 24, travel });
  const prepared = prepareTemporalReplan(previous, fixed, jobs, ["rare-carrier"], { type: "engineer_unavailable", time: 479, id: "rare-carrier" });
  assert.deepEqual(prepared.continuationEngineers[0].equipment, ["ONT"]);
  const suffix = resultFromRouteOrder(prepared.continuationEngineers, prepared.remainingJobs, [], { speedKmh: 24, travel });
  const merged = mergeTemporalResult(previous, suffix, prepared, fixed, jobs, 24, travel);
  assert.equal(merged.jobs[0].engineerId, null);
  assert.equal(merged.jobs[0].risk, true);
});
