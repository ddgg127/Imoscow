// Manual integration check: run while solver_service is listening on port 8008.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { generateTzDataset } from "../lib/generator-files.ts";
import { LocalRoadGraph } from "../lib/local-road-graph.ts";
import { createSolverPayload } from "../lib/server-solver.ts";
import { fallbackTravel, resultFromRouteOrder } from "../lib/vrptw.ts";

const graphPath = process.env.ROAD_GRAPH_PATH ?? new URL("../public/road-graph.json.gz", import.meta.url);
const graph = new LocalRoadGraph(JSON.parse(gunzipSync(readFileSync(graphPath))));
for (const [engineers, jobs] of [[35, 200], [15, 150], [25, 300], [100, 100]]) {
  const dataset = generateTzDataset({ engineers, jobs, windowMinutes: 240, speedKmh: 24, urgentShare: 15, vehicleConstraintShare: 25, seed: 42 });
  const travel = fallbackTravel(24);
  const payload = createSolverPayload(dataset.engineers, dataset.jobs, 24, travel);
  const response = await fetch("http://127.0.0.1:8008/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`${engineers}/${jobs}: ${response.status} ${await response.text()}`);
  const solved = await response.json();
  assert.equal(solved.engine, "ortools");
  const result = resultFromRouteOrder(dataset.engineers, dataset.jobs, solved.routes, { speedKmh: 24, travel });
  const served = new Set(result.routes.flatMap(route => route.stops.map(stop => stop.jobId)));
  assert.equal(served.size, result.metrics.assigned);
  assert.equal(result.metrics.assigned + result.metrics.unassigned, jobs);
  const jobById = new Map(dataset.jobs.map(job => [job.id, job]));
  for (const route of result.routes) {
    const engineer = dataset.engineers.find(item => item.id === route.engineerId);
    const mode = engineer.transport === "Автомобиль" ? "driving" : engineer.transport === "Велосипед" ? "cycling" : "walking";
    let road;
    try { road = graph.route([engineer.start, ...route.stops.map(stop => jobById.get(stop.jobId).coordinates)], mode); }
    catch (error) { throw new Error(`${engineers}/${jobs} ${route.engineerId} ${mode} ${route.stops.map(stop => stop.jobId).join(",")}: ${error.message}`); }
    assert.equal(road.legEnds.length, route.stops.length + 1);
    assert.ok(road.geometry.coordinates.length >= 2);
  }
  const urgent = dataset.jobs.filter(job => job.priority === 2);
  const missedUrgent = urgent.filter(job => !served.has(job.id));
  console.log(JSON.stringify({ scenario: `${engineers}/${jobs}`, assigned: result.metrics.assigned, urgent: urgent.length, missedUrgent: missedUrgent.map(job => job.id), activeRoutes: result.routes.length, roadRoutes: result.routes.length, solverMs: solved.runtimeMs }));
}
