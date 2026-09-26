import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { LocalRoadGraph } from "../lib/local-road-graph.ts";
import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";

test("local graph follows connected roads and preserves ordered stop boundaries", () => {
  const graph = new LocalRoadGraph({
    version: 1,
    source: "test",
    nodes: [[37, 55], [37.001, 55], [37.001, 55.001], [37, 55.001]],
    edges: [[0, 1, 7, 7], [1, 2, 7, 7], [2, 3, 2, 2]],
  });
  const route = graph.route([[37, 55], [37.001, 55.001], [37.001, 55]], "driving");
  assert.equal(route.provider, "local-car");
  assert.deepEqual(route.geometry.coordinates, [[37, 55], [37.001, 55], [37.001, 55.001], [37.001, 55]]);
  assert.deepEqual(route.legEnds, [0, 2, 3]);
  assert.ok(route.distanceMeters > 0);
  const walk = graph.route([[37, 55], [37, 55.001]], "walking");
  assert.equal(walk.provider, "local-walk");
  assert.deepEqual(walk.geometry.coordinates.at(-1), [37, 55.001]);
});

test("one-way car dead end keeps an explicitly estimated road line", () => {
  const graph = new LocalRoadGraph({
    version: 1,
    source: "test",
    nodes: [[37, 55], [37.001, 55]],
    edges: [[0, 1, 3, 2]],
  });
  const road = graph.route([[37.001, 55], [37, 55]], "driving");
  assert.equal(road.provider, "local-road-estimate");
  assert.deepEqual(road.legEnds, [0, 1]);
  assert.ok(road.distanceMeters > 0);
});

test("bundled graph covers every source job from a regional engineer", () => {
  const packed = JSON.parse(gunzipSync(readFileSync(new URL("../public/road-graph.json.gz", import.meta.url))));
  const graph = new LocalRoadGraph(packed);
  assert.ok(packed.nodes.length > 100_000, "routing data must be bundled with the site");
  for (const job of csvJobs) {
    const engineers = csvEngineers.filter(engineer => engineer.region === job.region);
    assert.ok(engineers.length, `no regional engineer for ${job.id}`);
    const nearest = engineers.reduce((best, engineer) => {
      const distance = Math.hypot(engineer.start[0] - job.coordinates[0], engineer.start[1] - job.coordinates[1]);
      return !best || distance < best.distance ? { engineer, distance } : best;
    }, null).engineer;
    const route = graph.route([nearest.start, job.coordinates], "driving");
    assert.equal(route.provider, "local-car", `job ${job.id}`);
    assert.ok(route.geometry.coordinates.length >= 2, `job ${job.id}`);
  }
});
