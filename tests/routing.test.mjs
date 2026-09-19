import test from "node:test";
import assert from "node:assert/strict";
import { osrmRouteLegs } from "../lib/osrm.ts";
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

test("unavailable road matrix uses conservative urban travel time", () => {
  const a = [37.6, 55.7], b = [37.7, 55.7];
  const fallback = fallbackTravel(24);
  assert.ok(fallback.distanceKm(a, b) > 9);
  assert.ok(fallback.durationMin(a, b) > 25);
  const matrix = travelFromTable([a, b], [[0, 10000], [10000, 0]], [[0, 300], [300, 0]], 24);
  assert.ok(matrix.durationMin(a, b) >= 28);
  assert.equal(matrix.durationMin(a, a), 0);
});
