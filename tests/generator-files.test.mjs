import assert from "node:assert/strict";
import test from "node:test";
import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";
import { generateDataset, generatedCsv, generatedJson } from "../lib/generator-files.ts";
import { importPlanText } from "../lib/import-data.ts";
import { fallbackTravel, optimizeVrptw } from "../lib/vrptw.ts";

const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
const sample = generateDataset(csvJobs.slice(0, 12), csvEngineers.slice(0, 8), { jobs: 15, engineers: 10, windowMinutes: 180, speedKmh: 31 });

function verifyRoundTrip(fileName, text) {
  const imported = importPlanText(text, fileName, centers);
  assert.equal(imported.jobs.length, sample.jobs.length);
  assert.equal(imported.engineers.length, sample.engineers.length);
  assert.equal(imported.speedKmh, 31);
  for (let index = 0; index < sample.jobs.length; index++) {
    const actual = imported.jobs[index];
    const expected = sample.jobs[index];
    assert.equal(actual.id, expected.id);
    assert.deepEqual(actual.coordinates, expected.coordinates);
    assert.equal(actual.geocodeQuality, expected.geocodeQuality);
    assert.equal(actual.windowStart, expected.windowStart);
    assert.equal(actual.windowEnd, expected.windowEnd);
    assert.equal(actual.serviceMinutes, expected.serviceMinutes);
    assert.equal(actual.equipment, expected.equipment);
    assert.equal(actual.requiredTransport, expected.requiredTransport);
    assert.deepEqual(actual.allowedTransports, expected.allowedTransports);
  }
  for (let index = 0; index < sample.engineers.length; index++) {
    const actual = imported.engineers[index];
    const expected = sample.engineers[index];
    assert.equal(actual.id, expected.id);
    assert.deepEqual(actual.start, expected.start);
    assert.deepEqual(actual.skills, expected.skills);
    assert.deepEqual(actual.equipment, expected.equipment);
    assert.equal(actual.transport, expected.transport);
    assert.equal(actual.shiftStart, expected.shiftStart);
    assert.equal(actual.shiftEnd, expected.shiftEnd);
  }
  assert.ok(imported.jobs.every(job => job.geocodeVerified), "Generated coordinates remain usable for routing");
  const result = optimizeVrptw(imported.engineers, imported.jobs, { speedKmh: imported.speedKmh, travel: fallbackTravel(imported.speedKmh), zoneBudget: 80 });
  assert.equal(result.metrics.total, sample.jobs.length);
  return imported;
}

test("generator JSON is importable and routable without losing planning fields", () => {
  verifyRoundTrip("generated.json", generatedJson(sample));
});

test("generator CSV is importable and routable without losing planning fields", () => {
  verifyRoundTrip("generated.csv", generatedCsv(sample));
});
