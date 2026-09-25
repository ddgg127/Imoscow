import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";
import demoScenario from "../data/demo-scenario.json" with { type: "json" };
import { importPlanText } from "../lib/import-data.ts";
import { fallbackTravel, resultFromRouteOrder } from "../lib/vrptw.ts";
import { createSolverPayload } from "../lib/server-solver.ts";

const url = process.env.FIELD_FLOW_SOLVER_CHECK_URL ?? "http://127.0.0.1:8008/solve";
const travel = fallbackTravel(24);
const demo = process.argv.includes("--demo");
const imported = demo ? importPlanText(JSON.stringify(demoScenario), "demo-scenario.json", { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] }) : null;
const engineers = imported?.engineers ?? csvEngineers;
const jobs = imported?.jobs ?? csvJobs;
const payload = createSolverPayload(engineers, jobs, 24, travel);
console.log(JSON.stringify({ maxArcKm: Math.max(...payload.matrix.distancesKm.flat()), distinctPoints: payload.matrix.points.length }));
const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const output = await response.json();
if (!response.ok || output.engine !== "ortools") throw new Error(`OR-Tools full-data check failed: ${response.status} ${JSON.stringify(output)}`);
const result = resultFromRouteOrder(engineers, jobs, output.routes, { speedKmh: 24, travel });
console.log(JSON.stringify({ engine: output.engine, jobs: jobs.length, engineers: engineers.length, assigned: result.metrics.assigned, baselineAssigned: result.baseline.assigned, unassigned: result.metrics.unassigned, status: output.status, runtimeMs: output.runtimeMs }, null, 2));
