import test from "node:test";
import assert from "node:assert/strict";
import { executionAtTime, matchesEditorQuery, parseTime, validateEditedData } from "../lib/data-editor.ts";
import { roadLegForJob } from "../lib/route-leg.ts";
import { engineerSpeedKmh, transportTravelMinutes } from "../lib/transport-speed.ts";
import { csvJobs, csvEngineers } from "../lib/csv-data.generated.ts";
import { baselinePlan, fallbackTravel } from "../lib/vrptw.ts";

test("a selected stop shows only its incoming road segment and origin", () => {
  const engineer = { ...csvEngineers[0], start: [37.0, 55.0] };
  const jobs = [
    { ...csvJobs[0], id: "a", coordinates: [37.1, 55.0] },
    { ...csvJobs[1], id: "b", coordinates: [37.2, 55.0] },
  ];
  const plan = { engineerId: engineer.id, distanceKm: 10, durationMinutes: 100, load: 20, stops: [
    { jobId: "a", arrival: 500, start: 500, end: 530, distanceKm: 5, onTime: true },
    { jobId: "b", arrival: 550, start: 550, end: 580, distanceKm: 5, onTime: true },
  ] };
  const road = [[37.0, 55.0], [37.05, 55.01], [37.1, 55.0], [37.15, 55.01], [37.2, 55.0]];
  const first = roadLegForJob(engineer, plan, jobs, road, "a");
  const second = roadLegForJob(engineer, plan, jobs, road, "b");
  assert.deepEqual(first.coordinates, road.slice(0, 3));
  assert.deepEqual(second.coordinates, road.slice(2));
  assert.match(first.originLabel, /База/);
  assert.equal(second.originLabel, "Заявка № a");
});

test("execution state follows arrival and completion, with manual completion preserved", () => {
  const job = { ...csvJobs[0], executionStatus: "not_started" };
  const stop = { arrival: 500, end: 560 };
  assert.equal(executionAtTime(job, stop, 499), "not_started");
  assert.equal(executionAtTime(job, stop, 500), "in_progress");
  assert.equal(executionAtTime(job, stop, 559), "in_progress");
  assert.equal(executionAtTime(job, stop, 560), "completed");
  assert.equal(executionAtTime({ ...job, executionStatus: "completed" }, stop, 480), "completed");
});

test("manually completed work is excluded from a new baseline plan", () => {
  const engineer = { ...csvEngineers[0], skills: [csvJobs[0].kind], equipment: [csvJobs[0].equipment], transport: "Автомобиль" };
  const job = { ...csvJobs[0], region: engineer.region, coordinates: engineer.start, executionStatus: "completed" };
  const plan = baselinePlan([engineer], [job], 24, fallbackTravel(24));
  assert.equal(plan.metrics.assigned, 0);
  assert.equal(plan.metrics.total, 0);
});

test("editor rejects invalid windows, duplicate ids and bad coordinates", () => {
  const jobs = [{ ...csvJobs[0] }, { ...csvJobs[1] }];
  const engineers = [{ ...csvEngineers[0] }];
  assert.equal(validateEditedData(jobs, engineers), null);
  assert.match(validateEditedData([{ ...jobs[0], windowEnd: jobs[0].windowStart }, jobs[1]], engineers), /окно/);
  assert.match(validateEditedData([jobs[0], { ...jobs[1], id: jobs[0].id }], engineers), /ID/);
  assert.match(validateEditedData(jobs, [{ ...engineers[0], start: [0, 0] }]), /координаты/);
  assert.equal(parseTime("09:45"), 585);
});

test("editor searches all job and engineer fields, including times and resource lists", () => {
  const job = { ...csvJobs[0], windowStart: 585, equipment: "ONT", serviceMinutes: 47, source: "ручной импорт", executionStatus: "in_progress" };
  assert.equal(matchesEditorQuery(job, "09:45 ONT"), true);
  assert.equal(matchesEditorQuery(job, "47 ручной"), true);
  assert.equal(matchesEditorQuery(job, "начата"), true);
  assert.equal(matchesEditorQuery(job, "несуществующий ресурс"), false);
  const engineer = { ...csvEngineers[0], skills: ["Аварийно-восстановительные работы"], equipment: ["Рефлектометр"], shiftEnd: 1080 };
  assert.equal(matchesEditorQuery(engineer, "рефлектометр 18:00"), true);
  assert.equal(matchesEditorQuery(engineer, "недоступен", true), true);
});

test("transport speeds change feasible arrival in the same baseline route", () => {
  const speed = 24;
  const car = engineerSpeedKmh("Автомобиль", undefined, speed);
  const walk = engineerSpeedKmh("Пешком", undefined, speed);
  const bike = engineerSpeedKmh("Велосипед", undefined, speed);
  assert.ok(transportTravelMinutes("Пешком", 10, 25, walk, speed) > transportTravelMinutes("Велосипед", 10, 25, bike, speed));
  assert.ok(transportTravelMinutes("Велосипед", 10, 25, bike, speed) > transportTravelMinutes("Автомобиль", 10, 25, car, speed));
  const start = [37.5, 55.7], destination = [37.57, 55.7];
  const template = { ...csvEngineers[0], region: "Восток", start, skills: ["Локальные работы"], equipment: ["ONT"], shiftStart: 480, shiftEnd: 720 };
  const job = { ...csvJobs[0], region: "Восток", coordinates: destination, kind: "Локальные работы", equipment: "ONT", allowedTransports: ["Автомобиль", "Пешком"], windowStart: 480, windowEnd: 510, serviceMinutes: 20 };
  const travel = fallbackTravel(24);
  const carPlan = baselinePlan([{ ...template, transport: "Автомобиль" }], [job], 24, travel);
  const walkPlan = baselinePlan([{ ...template, transport: "Пешком" }], [job], 24, travel);
  assert.equal(carPlan.metrics.assigned, 1);
  assert.equal(walkPlan.metrics.assigned, 0);
});
