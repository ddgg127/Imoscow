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
