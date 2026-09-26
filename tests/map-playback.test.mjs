import test from "node:test";
import assert from "node:assert/strict";
import { BackendRoutingProvider } from "../lib/map-providers.ts";
import { positionAtSimTime, roadLineFeatures } from "../lib/route-playback.ts";
import { csvEngineers, csvJobs, csvMeta } from "../lib/csv-data.generated.ts";
import { compatible } from "../lib/vrptw.ts";
import { prepareTemporalReplan } from "../lib/temporal-replan.ts";

test("map source contains the actual road polyline and selected engineer only", () => {
  const [first, second] = csvEngineers;
  const roads = { [first.id]: [[37.1, 55.1], [37.14, 55.13], [37.2, 55.1]], [second.id]: [[37.3, 55.2], [37.4, 55.2]] };
  const all = roadLineFeatures([first, second], roads);
  assert.equal(all.features.length, 2);
  assert.deepEqual(all.features[0].geometry.coordinates[1], [37.14, 55.13]);
  const selected = roadLineFeatures([first, second], roads, second.id);
  assert.deepEqual(selected.features.map(feature => feature.properties.id), [second.id]);
  assert.equal(roadLineFeatures([first], {}, first.id).features.length, 0, "never draw a fake straight line");
});

test("engineer moves continuously along bends, not a straight chord or teleport", () => {
  const engineer = { ...csvEngineers[0], start: [37.1, 55.1], shiftStart: 480 };
  const job = { ...csvJobs[0], id: "ROAD", coordinates: [37.2, 55.1] };
  const plan = { engineerId: engineer.id, stops: [{ jobId: job.id, arrival: 500, start: 500, end: 530, distanceKm: 12, onTime: true }], distanceKm: 12, durationMinutes: 50, load: 10 };
  const road = [[37.1, 55.1], [37.1, 55.15], [37.2, 55.15], [37.2, 55.1]];
  const positions = [480, 484, 488, 492, 496, 500].map(time => positionAtSimTime(engineer, plan, [job], road, time)?.point);
  assert.deepEqual(positions[0], engineer.start);
  assert.deepEqual(positions.at(-1), job.coordinates);
  assert.ok(positions.some(point => point[1] > 55.14), "marker must follow the road bend");
  for (let index = 1; index < positions.length; index++) {
    const [before, after] = [positions[index - 1], positions[index]];
    assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 0.061, "no frame jumps across the city");
  }
  assert.equal(positionAtSimTime(engineer, plan, [job], [], 490), null, "missing road must not synthesize motion");
});

test("browser routing retries public OSM graph after app proxy failure", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (String(url) === "/api/routing") return new Response("proxy offline", { status: 502 });
    return new Response(JSON.stringify({ routes: [{ geometry: { type: "LineString", coordinates: [[37.1, 55.1], [37.12, 55.13], [37.2, 55.1]] }, distance: 12000, duration: 900 }] }), { status: 200 });
  };
  try {
    const route = await new BackendRoutingProvider("osrm").buildRoute({ points: [[37.1, 55.1], [37.2, 55.1]], mode: "driving" });
    assert.equal(route.geometry.coordinates.length, 3);
    assert.ok(urls.some(url => url.includes("router.project-osrm.org/route")));
  } finally { globalThis.fetch = originalFetch; }
});

test("browser requests a road matrix when the app proxy is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (String(url) === "/api/routing/matrix") return new Response("proxy offline", { status: 502 });
    return new Response(JSON.stringify({ code: "Ok", distances: [[0, 1200], [1300, 0]], durations: [[0, 420], [450, 0]] }), { status: 200 });
  };
  try {
    const matrix = await new BackendRoutingProvider("osrm").buildMatrix([[37.1, 55.1], [37.2, 55.1]], "driving");
    assert.equal(matrix.provider, "browser-osrm");
    assert.equal(matrix.distances[1][0], 1300);
    assert.ok(urls.some(url => url.includes("router.project-osrm.org/table")));
  } finally { globalThis.fetch = originalFetch; }
});

test("transit outage uses a visibly labelled walkable estimate instead of an invented transit line", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url) === "/api/routing"
    ? new Response("offline", { status: 502 })
    : new Response(JSON.stringify({ routes: [{ geometry: { type: "LineString", coordinates: [[37.1, 55.1], [37.12, 55.12], [37.2, 55.1]] }, distance: 4100, duration: 2200 }] }), { status: 200 });
  try {
    const route = await new BackendRoutingProvider("osrm").buildRoute({ points: [[37.1, 55.1], [37.2, 55.1]], mode: "transit" });
    assert.equal(route.provider, "walking-estimate");
    assert.equal(route.geometry.coordinates.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("local starts and issued kits survive temporal replanning without resupply", () => {
  const locals = csvEngineers.filter(engineer => engineer.startMode === "local");
  assert.equal(locals.length, 3);
  assert.deepEqual(new Set(locals.map(engineer => engineer.startAddress.match(/Кашира|Домодедово|Ступино/)?.[0])), new Set(["Кашира", "Домодедово", "Ступино"]));
  assert.ok(locals.every(engineer => engineer.equipmentIssue === "preissued" && engineer.officeAddress));
  assert.ok(csvEngineers.filter(engineer => engineer.startMode === "office").every(engineer => engineer.equipmentIssue === "office_before_shift"));
  for (const [region, office] of Object.entries(csvMeta.offices)) {
    assert.equal(office.officeEngineers + office.localEngineers, csvEngineers.filter(engineer => engineer.region === region).length);
    const issued = Object.values(office.issuedEquipmentCounts).reduce((sum, count) => sum + count, 0);
    assert.equal(issued, csvEngineers.filter(engineer => engineer.region === region && engineer.startMode === "office").reduce((sum, engineer) => sum + new Set(engineer.equipment).size, 0));
  }
  const engineer = locals[0];
  const previous = { routes: [], jobs: [] };
  const prepared = prepareTemporalReplan(previous, [engineer], [], [], { type: "recalculate", time: 790, id: "event" });
  const continuation = prepared.continuationEngineers[0];
  assert.deepEqual(continuation.equipment, engineer.equipment);
  assert.deepEqual(continuation.start, engineer.start);
  assert.equal(continuation.shiftStart, 790);
  const missing = { ...csvJobs[0], region: engineer.region, kind: engineer.skills[0], equipment: "несуществующий комплект" };
  assert.equal(compatible(continuation, missing), false);
});
