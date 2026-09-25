import assert from "node:assert/strict";
import { createSolverPayload } from "../lib/server-solver.ts";
import { mergeTemporalResult, prepareTemporalReplan } from "../lib/temporal-replan.ts";
import { fallbackTravel, resultFromRouteOrder } from "../lib/vrptw.ts";

const url = process.env.FIELD_FLOW_SOLVER_CHECK_URL ?? "http://127.0.0.1:8008/solve";
const engineers = [
  { id: "E1", name: "Первый", region: "Восток", start: [37.78, 55.71], skills: ["Локальные работы", "Аварийно-восстановительные работы"], equipment: ["Диагностический комплект", "Рефлектометр"], transport: "Автомобиль", shiftStart: 480, shiftEnd: 1320 },
  { id: "E2", name: "Второй", region: "Восток", start: [37.79, 55.72], skills: ["Локальные работы", "Аварийно-восстановительные работы"], equipment: ["Диагностический комплект", "Рефлектометр"], transport: "Автомобиль", shiftStart: 480, shiftEnd: 1320 },
];
const makeJob = (id, coordinates, windowStart, windowEnd, serviceMinutes, emergency = false) => ({ id, coordinates, windowStart, windowEnd, serviceMinutes, region: "Восток", kind: emergency ? "Аварийно-восстановительные работы" : "Локальные работы", equipment: emergency ? "Рефлектометр" : "Диагностический комплект", requiredTransport: "", priority: emergency ? 5 : 2, urgency: emergency ? "urgent" : "normal", workClass: emergency ? "emergency" : "repair", time: "", area: "", address: id, tone: "blue", engineerId: null, baselineEngineerId: null, risk: false, source: "test", status: "Новая" });
const jobs = [
  makeJob("started", [37.78, 55.71], 480, 600, 360),
  makeJob("later", [37.80, 55.73], 840, 1000, 60),
];
const travel = fallbackTravel(24);
const before = resultFromRouteOrder(engineers, jobs, [{ engineerId: "E1", jobIds: ["started", "later"] }], { speedKmh: 24, travel });
const emergency = makeJob("incident", [37.79, 55.72], 790, 900, 80, true);
const allJobs = [...jobs, emergency];
const event = { type: "new_job", time: 790, id: "incident" };
const prepared = prepareTemporalReplan(before, engineers, allJobs, [], event);
const payload = createSolverPayload(prepared.continuationEngineers, prepared.remainingJobs, 24, travel, emergency.id, undefined, event);
const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const output = await response.json();
if (!response.ok || output.engine !== "ortools") throw new Error(`Event solver check failed: ${response.status} ${JSON.stringify(output)}`);
const suffix = resultFromRouteOrder(prepared.continuationEngineers, prepared.remainingJobs, output.routes, { speedKmh: 24, travel });
const after = mergeTemporalResult(before, suffix, prepared, engineers, allJobs, 24, travel);
assert.deepEqual(after.routes.find(route => route.engineerId === "E1").stops[0], before.routes.find(route => route.engineerId === "E1").stops[0]);
assert.ok(after.jobs.find(job => job.id === "incident").engineerId);
console.log(JSON.stringify({ engine: output.engine, eventTime: event.time, locked: [...prepared.lockedJobIds], incidentEngineer: after.jobs.find(job => job.id === "incident").engineerId, assigned: after.metrics.assigned, status: output.status }, null, 2));
