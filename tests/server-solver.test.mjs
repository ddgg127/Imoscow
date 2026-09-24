import test from "node:test";
import assert from "node:assert/strict";
import { createSolverPayload, heuristicServerResponse, travelFromSolverPayload } from "../lib/server-solver.ts";

const engineer = { id: "e1", name: "И", initials: "И", region: "Восток", route: "R", jobs: 0, distance: "0", load: 0, color: "#000", start: [0, 0], skills: ["Монтаж"], equipment: ["ONT"], transport: "Автомобиль", shiftStart: 480, shiftEnd: 720 };
const job = { id: "a", time: "08:00–10:00", windowStart: 480, windowEnd: 600, area: "ВАО", address: "A", kind: "Монтаж", tone: "blue", region: "Восток", engineerId: null, baselineEngineerId: null, coordinates: [1, 0], risk: false, equipment: "ONT", requiredTransport: "Автомобиль", priority: 1, serviceMinutes: 30, source: "Тест", status: "Новая" };
const travel = { distanceKm: (a, b) => Math.abs(a[0] - b[0]), durationMin: (a, b) => Math.abs(a[0] - b[0]) * 5 };

test("solver payload contains a dense reusable travel matrix", () => {
  const payload = createSolverPayload([engineer], [job], 24, travel);
  assert.equal(payload.matrix.points.length, 2);
  assert.deepEqual(payload.matrix.distancesKm, [[0, 1], [1, 0]]);
  assert.equal(travelFromSolverPayload(payload).durationMin([0, 0], [1, 0]), 5);
});

test("solver payload keeps walking and cycling network matrices separate", () => {
  const walk = { ...engineer, id: "walk", transport: "Пешком" };
  const bike = { ...engineer, id: "bike", transport: "Велосипед" };
  const modeTravel = {
    ...travel,
    forTransport: mode => mode === "Пешком"
      ? { distanceKm: (a, b) => Math.abs(a[0] - b[0]) * 0.7, durationMin: (a, b) => Math.abs(a[0] - b[0]) * 12 }
      : mode === "Велосипед"
        ? { distanceKm: (a, b) => Math.abs(a[0] - b[0]) * 0.8, durationMin: (a, b) => Math.abs(a[0] - b[0]) * 4 }
        : travel,
  };
  const payload = createSolverPayload([walk, bike], [job], 24, modeTravel);
  assert.equal(payload.modeMatrices.walking.distancesKm[0][1], 0.7);
  assert.equal(payload.modeMatrices.cycling.distancesKm[0][1], 0.8);
  const restored = travelFromSolverPayload(payload);
  assert.equal(restored.forTransport("Пешком").distanceKm(walk.start, job.coordinates), 0.7);
  assert.equal(restored.forTransport("Велосипед").distanceKm(bike.start, job.coordinates), 0.8);
});

test("solver payload carries a forced assignment for counterfactual runs", () => {
  const payload = createSolverPayload([engineer], [job], 24, travel, undefined, { a: "e1" });
  assert.deepEqual(payload.forcedAssignments, { a: "e1" });
  assert.equal(payload.timeLimitSeconds, 8);
});

test("server fallback response is complete and reconstructable", () => {
  const response = heuristicServerResponse(createSolverPayload([engineer], [job], 24, travel));
  assert.equal(response.engine, "heuristic-server");
  assert.deepEqual(response.routes[0].jobIds, ["a"]);
  assert.deepEqual(response.droppedJobIds, []);
});
