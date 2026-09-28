import test from "node:test";
import assert from "node:assert/strict";
import { mapJobsForRegion } from "../lib/map-region.ts";

test("regional map keeps complete cross-zone routes while excluding unrelated work", () => {
  const jobs = [
    { id: "local", region: "Восток", engineerId: "maria" },
    { id: "cross", region: "Югоцентр", engineerId: "maria" },
    { id: "other", region: "Югоцентр", engineerId: "other" },
    { id: "open", region: "Восток", engineerId: null },
    { id: "cancelled", region: "Восток", engineerId: "maria", cancelled: true },
  ];
  assert.deepEqual(mapJobsForRegion(jobs, "Восток").map(job => job.id), ["local", "cross", "open"]);
  assert.deepEqual(mapJobsForRegion(jobs, "Восток", "other").map(job => job.id), ["local", "cross", "other", "open"]);
  assert.equal(mapJobsForRegion(jobs, "Все зоны").length, 4);
});
