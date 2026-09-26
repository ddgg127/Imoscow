import test from "node:test";
import assert from "node:assert/strict";
import { decodePolyline6, osrmRouteLegs, osrmTable } from "../lib/osrm.ts";
import { fallbackTravel, travelFromTable } from "../lib/vrptw.ts";

test("multi-stop road geometry comes from one ordered OSRM route request", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return new Response(JSON.stringify({ routes: [{ geometry: { coordinates: [[37.1, 55.1], [37.15, 55.15], [37.2, 55.1], [37.3, 55.2]] }, distance: 12500, duration: 1400 }] }), { status: 200 });
  };
  try {
    const result = await osrmRouteLegs([[37.1, 55.1], [37.2, 55.1], [37.3, 55.2]]);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /route\/v1\/driving\/37\.1,55\.1;37\.2,55\.1;37\.3,55\.2/);
    assert.deepEqual(result.geometry.coordinates[1], [37.15, 55.15]);
    assert.equal(result.distanceMeters, 12500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("long route recovers ordered road bends from smaller graph requests", async () => {
  const originalFetch = globalThis.fetch;
  const points = Array.from({ length: 10 }, (_, index) => [37.1 + index * 0.01, 55.1]);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const value = String(url);
    calls.push(value);
    if (!value.includes("valhalla1")) return new Response("long route unavailable", { status: 400 });
    const locations = JSON.parse(options.body).locations;
    if (locations.length > 5) return new Response("too many stops", { status: 400 });
    const legs = locations.slice(1).map((point, index) => ({ shape: encodePolyline6([
      [locations[index].lon, locations[index].lat],
      [(locations[index].lon + point.lon) / 2, 55.12],
      [point.lon, point.lat],
    ]) }));
    return new Response(JSON.stringify({ trip: { legs, summary: { length: 10, time: 900 } } }), { status: 200 });
  };
  try {
    const result = await osrmRouteLegs(points);
    assert.equal(result.provider, "valhalla");
    assert.ok(result.geometry.coordinates.some(point => point[1] === 55.12), "route follows returned bends");
    assert.deepEqual(result.geometry.coordinates[0], points[0]);
    assert.ok(Math.abs(result.geometry.coordinates.at(-1)[0] - points.at(-1)[0]) < 1e-6);
    assert.equal(result.geometry.coordinates.at(-1)[1], points.at(-1)[1]);
    assert.equal(calls.filter(url => url.includes("valhalla1")).length, 4, "one full attempt and three ordered chunks");
  } finally { globalThis.fetch = originalFetch; }
});

test("road geometry falls back to FOSSGIS and uses the pedestrian network", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).includes("router.project-osrm.org")) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ routes: [{ geometry: { coordinates: [[37.61, 55.71], [37.62, 55.72]] }, distance: 1000, duration: 600 }] }), { status: 200 });
  };
  try {
    const car = await osrmRouteLegs([[37.61, 55.71], [37.62, 55.72], [37.63, 55.73]]);
    assert.equal(car.provider, "osrm");
    assert.ok(calls.some(url => url.includes("routing.openstreetmap.de/routed-car/route/v1/driving")));
    calls.length = 0;
    await osrmRouteLegs([[37.81, 55.71], [37.82, 55.72], [37.83, 55.73]], "walking");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /routing\.openstreetmap\.de\/routed-foot\/route\/v1\/driving/);
  } finally { globalThis.fetch = originalFetch; }
});

function encodePolyline6(points) {
  let lastLat = 0, lastLon = 0;
  let output = "";
  for (const [lon, lat] of points) {
    for (const delta of [Math.round(lat * 1e6) - lastLat, Math.round(lon * 1e6) - lastLon]) {
      let value = delta < 0 ? ~(delta << 1) : delta << 1;
      while (value >= 0x20) { output += String.fromCharCode((0x20 | (value & 0x1f)) + 63); value >>= 5; }
      output += String.fromCharCode(value + 63);
    }
    lastLat = Math.round(lat * 1e6);
    lastLon = Math.round(lon * 1e6);
  }
  return output;
}

test("transit route uses Valhalla multimodal shape, never a straight-line substitute", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const road = [[37.601, 55.701], [37.603, 55.702], [37.604, 55.704]];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ trip: { legs: [{ shape: encodePolyline6(road) }], summary: { length: 1.2, time: 480 } } }), { status: 200 });
  };
  try {
    assert.deepEqual(decodePolyline6(encodePolyline6(road)), road);
    const result = await osrmRouteLegs([road[0], road.at(-1)], "transit");
    assert.equal(result.provider, "valhalla");
    assert.deepEqual(result.geometry.coordinates, road);
    assert.equal(JSON.parse(calls[0].options.body).costing, "multimodal");
    assert.match(calls[0].url, /valhalla1\.openstreetmap\.de\/route/);
  } finally { globalThis.fetch = originalFetch; }
});

test("missing transit graph is labelled as a pedestrian estimate", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).includes("valhalla1")) return new Response("missing transit graph", { status: 400 });
    return new Response(JSON.stringify({ routes: [{ geometry: { coordinates: [[37.605, 55.705], [37.607, 55.706], [37.615, 55.715]] }, distance: 1900, duration: 1200 }] }), { status: 200 });
  };
  try {
    const result = await osrmRouteLegs([[37.605, 55.705], [37.615, 55.715]], "transit");
    assert.equal(result.provider, "walking-estimate");
    assert.equal(result.geometry.coordinates.length, 3);
    assert.ok(calls.some(url => url.includes("routed-foot")));
    assert.ok(!calls.some(url => url.includes("router.project-osrm.org")));
  } finally { globalThis.fetch = originalFetch; }
});

test("walking matrix uses pedestrian graph rather than driving demo", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return new Response(JSON.stringify({ distances: [[0, 1200], [1200, 0]], durations: [[0, 900], [900, 0]] }), { status: 200 });
  };
  try {
    const matrix = await osrmTable([[37.711, 55.711], [37.712, 55.712]], "walking");
    assert.equal(matrix.distances[0][1], 1200);
    assert.match(calls[0], /routing\.openstreetmap\.de\/routed-foot\/table/);
    assert.ok(!calls.some(url => url.includes("router.project-osrm.org")));
  } finally { globalThis.fetch = originalFetch; }
});

test("configured OSRM server is preferred for route and matrix", async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.OSRM_CAR_URL;
  process.env.OSRM_CAR_URL = "https://routing.internal.example/";
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return new Response(JSON.stringify(String(url).includes("/table/")
      ? { distances: [[0, 1200], [1200, 0]], durations: [[0, 360], [360, 0]] }
      : { routes: [{ geometry: { coordinates: [[37.901, 55.901], [37.902, 55.902]] }, distance: 1200, duration: 360 }] }), { status: 200 });
  };
  try {
    await osrmRouteLegs([[37.901, 55.901], [37.902, 55.902]]);
    await osrmTable([[37.901, 55.901], [37.902, 55.902]]);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => url.startsWith("https://routing.internal.example/")));
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.OSRM_CAR_URL;
    else process.env.OSRM_CAR_URL = previous;
  }
});

test("unavailable road matrix uses conservative urban travel time", () => {
  const a = [37.6, 55.7], b = [37.7, 55.7];
  const fallback = fallbackTravel(24);
  assert.ok(fallback.distanceKm(a, b) > 9);
  assert.ok(fallback.durationMin(a, b) > 25);
  const matrix = travelFromTable([a, b], [[0, 10000], [10000, 0]], [[0, 300], [300, 0]], 24);
  assert.ok(matrix.durationMin(a, b) >= 28);
  assert.equal(matrix.durationMin(a, a), 0);
});
