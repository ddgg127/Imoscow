import assert from "node:assert/strict";

const origin = (process.argv[2] ?? "http://127.0.0.1:3005").replace(/\/$/, "");
let ready;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(`${origin}/api/solver`, { signal: AbortSignal.timeout(5000) });
    ready = await response.json();
    if (response.ok && ready.status === "ok") break;
  } catch { /* Startup is bounded by the loop. */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.equal(ready?.status, "ok", "deployed solver is not healthy");
assert.equal(ready.solver, "ortools");
if (process.env.GITHUB_SHA) assert.equal(ready.deployment, process.env.GITHUB_SHA);
const page = await fetch(origin);
assert.equal(page.status, 200);
assert.match(await page.text(), /FieldFlow/);
const points = [[37.70,55.70],[37.71,55.70],[37.72,55.70],[37.73,55.70]];
const payload = {
  engineers: [{ id: "qa-engineer", region: "Восток", start: points[0], skills: ["Монтаж"], equipment: ["ONT"], transport: "Автомобиль", shiftStart: 480, shiftEnd: 720 }],
  jobs: [1,2,3].map(i => ({ id: `qa-${i}`, region: "Восток", coordinates: points[i], kind: "Монтаж", equipment: "ONT", priority: 1, windowStart: 480, windowEnd: 690, serviceMinutes: 20 })),
  speedKmh: 24, timeLimitSeconds: 1,
  matrix: { points, distancesKm: points.map((_,i)=>points.map((_,j)=>Math.abs(i-j))), durationsMin: points.map((_,i)=>points.map((_,j)=>Math.abs(i-j)*10)) },
};
const results = await Promise.all([1,2].map(async () => {
  const response = await fetch(`${origin}/api/solver`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(180000) });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.engine, "ortools");
  assert.deepEqual([...value.routes.flatMap(route=>route.jobIds)].sort(), ["qa-1","qa-2","qa-3"]);
  assert.deepEqual(value.droppedJobIds, []);
  return value;
}));
assert.equal(results[0].runtimeMs, results[1].runtimeMs, "duplicate requests ran separately");
console.log(JSON.stringify({ origin, deployment: ready.deployment, status: "ok", concurrentRequests: 2, assigned: 3, engine: results[0].engine }));
