import assert from "node:assert/strict";
import test from "node:test";
import { absenceImpact, engineerAbsenceMoment } from "../lib/engineer-absence.ts";

test("absence metric records report and actual exit time for service, travel and waiting", () => {
  const engineer = { id: "A", shiftStart: 480 };
  const plan = { routes: [{ engineerId: "A", stops: [
    { jobId: "done", arrival: 480, start: 480, end: 520 },
    { jobId: "next", arrival: 550, start: 570, end: 610 },
  ] }] };
  assert.deepEqual(engineerAbsenceMoment(plan, engineer, 530), { reportedAt: 530, effectiveAt: 530, phase: "travel", currentJobId: "next", completedBefore: 1 });
  assert.deepEqual(engineerAbsenceMoment(plan, engineer, 560), { reportedAt: 560, effectiveAt: 560, phase: "wait", currentJobId: "next", completedBefore: 1 });
  assert.deepEqual(engineerAbsenceMoment(plan, engineer, 580), { reportedAt: 580, effectiveAt: 610, phase: "service", currentJobId: "next", completedBefore: 1 });
});

test("dispatcher sees replacements, unserved work and locked visits separately", () => {
  const before = { routes: [{ engineerId: "A", stops: [
    { jobId: "done", end: 500 },
    { jobId: "ongoing", end: 560 },
    { jobId: "moved", end: 700 },
    { jobId: "missing", end: 800 },
  ] }] };
  const after = { jobs: [
    { id: "done", engineerId: "A" },
    { id: "ongoing", engineerId: "A" },
    { id: "moved", engineerId: "B" },
    { id: "missing", engineerId: null },
  ] };
  assert.deepEqual(absenceImpact(before, after, "A", 540, [{ id: "B", name: "Запасной инженер" }]), {
    reassigned: [{ jobId: "moved", engineerName: "Запасной инженер" }],
    unassigned: ["missing"],
    preserved: ["done", "ongoing"],
  });
});
