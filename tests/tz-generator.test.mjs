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
    assert.equal(data.events[2].job.priority, 2);
    assert.match(jobsToTzCsv(data.jobs), /Срочная|Обычная/);
    assert.match(eventsToTzCsv(data.events), /Срочная/);
    assert.deepEqual(generateTzDataset({ engineers, jobs, windowMinutes, speedKmh: 24, urgentShare, vehicleConstraintShare, seed: 42 }).jobs, data.jobs);
  }
});
