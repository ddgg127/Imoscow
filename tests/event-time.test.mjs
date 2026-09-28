import test from "node:test";
import assert from "node:assert/strict";
import { eventTimeError, FIRST_EVENT_MINUTE, unavailableAtTime } from "../lib/event-time.ts";
import { parseTime } from "../lib/data-editor.ts";
import { prepareTemporalReplan } from "../lib/temporal-replan.ts";
import { resultFromRouteOrder } from "../lib/vrptw.ts";

test("event time accepts the 07:30 start and any later minute up to the shift end", () => {
  assert.equal(FIRST_EVENT_MINUTE, 450);
  for (const value of ["07:30", "08:00", "08:01", "13:10", "22:00"])
    assert.equal(eventTimeError(parseTime(value), null), null, value);
  assert.match(eventTimeError(parseTime("07:29"), null), /07:30/);
  assert.match(eventTimeError(parseTime("22:01"), null), /22:00/);
  assert.match(eventTimeError(parseTime("24:00"), null), /22:00/);
  assert.match(eventTimeError(parseTime("invalid"), null), /07:30/);
});

test("subsequent event can share the same minute but cannot precede the last event", () => {
  assert.equal(eventTimeError(parseTime("10:15"), parseTime("10:15")), null);
  assert.equal(eventTimeError(parseTime("10:16"), parseTime("10:15")), null);
  assert.match(eventTimeError(parseTime("10:14"), parseTime("10:15")), /10:15/);
});

test("engineer availability follows event time when playback is rewound and restored", () => {
  const changes = [
    { engineerId: "E", time: 600, unavailable: true },
    { engineerId: "E", time: 660, unavailable: false },
  ];
  assert.deepEqual(unavailableAtTime([], changes, 599), []);
  assert.deepEqual(unavailableAtTime([], changes, 600), ["E"]);
  assert.deepEqual(unavailableAtTime([], changes, 659), ["E"]);
  assert.deepEqual(unavailableAtTime([], changes, 660), []);
  assert.deepEqual(unavailableAtTime(["F"], [], 450), ["F"]);
});

test("event at service time freezes the active job, while the next job stays available", () => {
  const engineer = { id: "E", name: "Инженер", initials: "И", route: "R", jobs: 0, distance: "", load: 0, color: "#000", region: "Восток", start: [37.7, 55.7], skills: ["Ремонт"], equipment: ["Комплект"], transport: "Автомобиль", shiftStart: 480, shiftEnd: 1000 };
  const job = (id, windowStart) => ({ id, time: "", windowStart, windowEnd: windowStart + 120, serviceMinutes: 30, area: "", address: id, kind: "Ремонт", tone: "blue", region: "Восток", engineerId: null, baselineEngineerId: null, coordinates: [37.7, 55.7], risk: false, equipment: "Комплект", requiredTransport: "", priority: 1, source: "test", status: "Новая" });
  const jobs = [job("A", 480), job("B", 600)];
  const travel = { distanceKm: () => 0, durationMin: () => 0 };
  const plan = resultFromRouteOrder([engineer], jobs, [{ engineerId: "E", jobIds: ["A", "B"] }], { speedKmh: 24, travel });
  const atStart = prepareTemporalReplan(plan, [engineer], jobs, [], { type: "recalculate", time: 480, id: "plan" });
  assert.deepEqual([...atStart.lockedJobIds], ["A"]);
  assert.deepEqual(atStart.remainingJobs.map(item => item.id), ["B"]);
  const afterEnd = prepareTemporalReplan(plan, [engineer], jobs, [], { type: "recalculate", time: 550, id: "plan" });
  assert.deepEqual([...afterEnd.lockedJobIds], ["A"]);
  assert.deepEqual(afterEnd.remainingJobs.map(item => item.id), ["B"]);
});
