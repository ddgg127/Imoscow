import test from "node:test";
import assert from "node:assert/strict";
import { reassignmentNotifications, readJournal } from "../lib/notification-journal.ts";
import { getJobState } from "../lib/job-presentation.ts";
import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";
import { executionAtTime } from "../lib/data-editor.ts";

test("job status distinguishes waiting before a plan and unassigned after a zero-route plan", () => {
  const job = { ...csvJobs[0], engineerId: null, executionStatus: "not_started" };
  assert.equal(getJobState(job, false), "waiting");
  assert.equal(getJobState(job, true), "unassigned");
  assert.equal(getJobState({ ...job, executionStatus: "completed" }, true), "completed");
  assert.equal(getJobState({ ...job, cancelled: true, executionStatus: "completed" }, true), "cancelled");
  const assigned = { ...job, engineerId: "e1" };
  const stop = { arrival: 500, start: 530, end: 560 };
  for (const [time, expected] of [[500,"waiting"], [530,"in_progress"], [560,"completed"], [520,"waiting"]]) {
    assert.equal(getJobState({ ...assigned, executionStatus: executionAtTime(assigned, stop, time) }, true), expected);
  }
});

test("journal groups transfers and missing replacements, skipping cancelled and completed work", () => {
  const engineers = [{ ...csvEngineers[0], id: "e1", name: "Мария" }, { ...csvEngineers[1], id: "e2", name: "Иван" }];
  const before = ["a","b","c","d","e","f"].map(id => ({ ...csvJobs[0], id, engineerId: "e1", executionStatus: "not_started" }));
  before.find(job => job.id === "f").executionStatus = "completed";
  const after = before.map(job => ({ ...job, engineerId: job.id === "c" ? null : job.id === "e" ? "e1" : "e2", cancelled: job.id === "d" }));
  const notices = reassignmentNotifications(before, after, engineers, 600);
  assert.equal(notices.length, 2);
  assert.deepEqual(notices.map(entry => entry.kind), ["reassigned", "unassigned"]);
  assert.equal(notices[0].time, 600);
  assert.match(notices[0].message, /№a, №b · Мария → Иван/);
  assert.deepEqual(notices[0].engineerIds, ["e1", "e2"]);
  assert.match(notices[1].message, /№c.*нет доступного назначения/);
  assert.deepEqual(reassignmentNotifications(after, after, engineers, 500), []);
});

test("journal round trip preserves event time and rejects broken browser storage", () => {
  const events = ["cancelled","left","emergency","reassigned"].map((kind,index) => ({ kind, id: `event-${index}`, time: 600+index, title: kind, message: "Запись", recordedAt: "2026-09-28T10:00:00.000Z", engineerIds: ["e1"] }));
  assert.deepEqual(readJournal(JSON.stringify(events)), events);
  assert.deepEqual(readJournal("broken"), []);
  assert.deepEqual(readJournal('{}'), []);
  assert.deepEqual(readJournal(JSON.stringify([...events, null, { ...events[0], time: -1 }, { ...events[0], recordedAt: "invalid" }, { ...events[0], engineerIds: [123] }])), events);
});
