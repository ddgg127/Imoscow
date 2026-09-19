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

test("server fallback response is complete and reconstructable", () => {
  const response = heuristicServerResponse(createSolverPayload([engineer], [job], 24, travel));
  assert.equal(response.engine, "heuristic-server");
  assert.deepEqual(response.routes[0].jobIds, ["a"]);
  assert.deepEqual(response.droppedJobIds, []);
});
