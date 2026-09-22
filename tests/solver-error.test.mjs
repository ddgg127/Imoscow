import test from "node:test";
import assert from "node:assert/strict";
import { solverServiceError } from "../lib/solver-error.ts";

test("solver reports the specific FastAPI failure instead of a generic 422", () => {
  assert.match(solverServiceError(422, { detail: "matrix misses coordinate 37.12345,55.12345" }), /matrix misses coordinate/);
});

test("solver reports Pydantic field paths", () => {
  assert.match(solverServiceError(422, { detail: [{ loc: ["body", "jobs", 3, "priority"], msg: "Input should be less than or equal to 100" }] }), /jobs.3.priority/);
});

test("solver retains a fallback for non-JSON service failures", () => {
  assert.equal(solverServiceError(502, null), "OR-Tools service 502");
});
