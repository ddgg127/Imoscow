import assert from "node:assert/strict";
import test from "node:test";
import { generateTzDataset, jobsToTzCsv, eventsToTzCsv } from "../lib/generator-files.ts";
import { compatible } from "../lib/vrptw.ts";

test("TZ generator honors exact counts, mean window and two priority levels", () => {
  for (const [engineers, jobs, windowMinutes, urgentShare, vehicleConstraintShare] of [
    [15, 100, 240, 15, 25],
    [15, 100, 100, 15, 25],
    [35, 200, 180, 15, 25],
    [25, 300, 360, 20, 30],
    [100, 100, 60, 0, 0],
  ]) {
    const data = generateTzDataset({ engineers, jobs, windowMinutes, speedKmh: 24, urgentShare, vehicleConstraintShare, seed: 42 });
    const widths = data.jobs.map(job => job.windowEnd - job.windowStart);
    assert.equal(data.jobs.length, jobs);
    assert.equal(data.engineers.length, engineers);
    assert.equal(new Set(data.jobs.map(job => job.id)).size, jobs);
    assert.equal(widths.reduce((sum, width) => sum + width, 0) / jobs, windowMinutes);
    assert.equal(data.stats.urgentJobsCount, Math.round(jobs * urgentShare / 100));
    assert.equal(data.stats.constrainedTransportJobsCount, Math.round(jobs * vehicleConstraintShare / 100));
    assert.ok(data.jobs.every(job => job.priority === (job.urgency === "urgent" ? 2 : 1)));
    assert.ok(data.jobs.every(job => job.windowStart >= 480 && job.windowEnd <= 1320));
    assert.ok(data.jobs.every(job => job.geocodeVerified && job.coordinates.length === 2));
    assert.ok(data.jobs.every(job => data.engineers.some(engineer => compatible(engineer, job))), "every generated job has a resource-compatible local engineer");
    assert.deepEqual(new Set(data.jobs.map(job => job.region)), new Set(data.engineers.map(engineer => engineer.region)));
    assert.equal(data.events.length, 3);
    assert.ok(data.events.some(event => event.type === "отмена заявки"));
    assert.ok(data.events.some(event => event.type === "недоступность инженера"));
    const urgentEvent = data.events.find(event => event.type === "срочная заявка");
    assert.equal(urgentEvent?.job?.priority, 2);
    assert.match(jobsToTzCsv(data.jobs), /Срочная|Обычная/);
    assert.match(eventsToTzCsv(data.events), /Срочная/);
    assert.deepEqual(generateTzDataset({ engineers, jobs, windowMinutes, speedKmh: 24, urgentShare, vehicleConstraintShare, seed: 42 }).jobs, data.jobs);
    assert.ok(new Set(data.jobs.map(job => job.equipment)).size >= 3, "jobs use more than a single tool");
    assert.ok(new Set(data.engineers.flatMap(engineer => engineer.equipment)).size >= 6, "engineers carry varied kits");
  }
});

test("TZ generator creates configurable replan events and extra skills", () => {
  const data = generateTzDataset({
    engineers: 18,
    jobs: 80,
    windowMinutes: 180,
    speedKmh: 24,
    cancelEvents: 2,
    unavailableEvents: 1,
    urgentEvents: 3,
    extraSkillShare: 22,
    seed: 7,
  });
  assert.equal(data.events.filter(event => event.type === "отмена заявки").length, 2);
  assert.equal(data.events.filter(event => event.type === "недоступность инженера").length, 1);
  assert.equal(data.events.filter(event => event.type === "срочная заявка").length, 3);
  assert.equal(new Set(data.events.map(event => event.time)).size, data.events.length);
  assert.ok(data.jobs.some(job => job.kind === "Монтаж СКС" || job.kind === "Видеонаблюдение" || job.kind === "Электропитание"));
  assert.ok(data.engineers.some(engineer => engineer.skills.some(skill => skill === "Монтаж СКС" || skill === "Видеонаблюдение" || skill === "Электропитание")));
  assert.ok(data.jobs.every(job => data.engineers.some(engineer => compatible(engineer, job))));
  assert.ok(new Set(data.events.filter(event => event.type === "срочная заявка").map(event => event.job?.id)).size === 3);
});
