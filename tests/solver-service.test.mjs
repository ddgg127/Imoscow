import test from "node:test";
import assert from "node:assert/strict";
import { createSolverServiceClient, solverRetryDelay } from "../lib/solver-service.ts";

const base = "https://solver.test";
const payload = id => ({ jobs: [{ id }], timeLimitSeconds: 1 });
const health = () => Response.json({ status: "ok", solver: "ortools" });
const solved = () => Response.json({ engine: "ortools", routes: [], droppedJobIds: [], runtimeMs: 1 });
const tick = () => new Promise(resolve => setImmediate(resolve));

test("429 on a cold service is retried before any solve is sent", async () => {
  const calls = [], waits = [];
  let healthCalls = 0;
  const client = createSolverServiceClient({
    fetch: async (url, init) => {
      calls.push([url, init.method]);
      if (url.endsWith("/health")) return ++healthCalls === 1
        ? new Response("Render is starting", { status: 429, headers: { "retry-after": "2" } }) : health();
      return solved();
    },
    wait: async ms => { waits.push(ms); },
  });
  assert.equal((await client.solve(base, payload("one"))).engine, "ortools");
  assert.deepEqual(calls.map(([url]) => url), [base + "/health", base + "/health", base + "/solve"]);
  assert.deepEqual(waits, [2000]);
});

test("a temporary 429 during solve honors Retry-After and returns the real result", async () => {
  let solves = 0;
  const waits = [];
  const client = createSolverServiceClient({
    fetch: async url => url.endsWith("/health") ? health() : ++solves < 3
      ? new Response("Too many requests", { status: 429, headers: { "retry-after": "3" } }) : solved(),
    wait: async ms => { waits.push(ms); },
  });
  assert.equal((await client.solve(base, payload("one"))).engine, "ortools");
  assert.equal(solves, 3);
  assert.deepEqual(waits, [3000, 3000]);
});

test("persistent 429 stops after bounded retries and leaves the queue usable", async () => {
  let failing = true, solves = 0;
  const client = createSolverServiceClient({
    fetch: async url => url.endsWith("/health") ? health() : (solves++, failing ? new Response("rate limit", { status: 429 }) : solved()),
    wait: async () => {},
  });
  await assert.rejects(client.solve(base, payload("one")), /временно ограничил запросы/);
  assert.equal(solves, 5);
  failing = false;
  assert.equal((await client.solve(base, payload("two"))).engine, "ortools");
});

test("invalid input and a non-OR-Tools response are never retried or substituted", async () => {
  let solves = 0;
  const client = createSolverServiceClient({
    fetch: async url => url.endsWith("/health") ? health() : (++solves === 1
      ? Response.json({ detail: "invalid time window" }, { status: 422 }) : Response.json({ engine: "heuristic-server", routes: [] })),
    wait: async () => assert.fail("should not retry invalid input"),
  });
  await assert.rejects(client.solve(base, payload("one")), /invalid time window/);
  assert.equal(solves, 1);
  await assert.rejects(client.solve(base, payload("two")), /не подтвердил движок OR-Tools/);
});

test("concurrent callers share identical work and different solves never overlap", async () => {
  let active = 0, peak = 0, solves = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createSolverServiceClient({ fetch: async url => {
    if (url.endsWith("/health")) return health();
    solves++; active++; peak = Math.max(peak, active);
    if (solves === 1) await gate;
    active--;
    return solved();
  } });
  const one = client.solve(base, payload("one"));
  const duplicate = client.solve(base, payload("one"));
  const two = client.solve(base, payload("two"));
  await tick();
  assert.equal(solves, 1);
  release();
  await Promise.all([one, duplicate, two]);
  assert.equal(solves, 2);
  assert.equal(peak, 1);
});

test("queued main planning precedes background analyses", async () => {
  const ids = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createSolverServiceClient({ fetch: async (url, init) => {
    if (url.endsWith("/health")) return health();
    ids.push(JSON.parse(init.body).jobs[0].id);
    if (ids.length === 1) await gate;
    return solved();
  } });
  const first = client.solve(base, payload("first"));
  await tick();
  const background = client.solve(base, { ...payload("analysis"), forcedAssignments: { job: "engineer" } });
  const main = client.solve(base, payload("main"));
  release();
  await Promise.all([first, background, main]);
  assert.deepEqual(ids, ["first", "main", "analysis"]);
});

test("closed queued requests do not reach the solver; aborting one subscriber keeps shared work alive", async () => {
  const ids = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createSolverServiceClient({ fetch: async (url, init) => {
    if (url.endsWith("/health")) return health();
    ids.push(JSON.parse(init.body).jobs[0].id);
    if (ids.length === 1) await gate;
    return solved();
  } });
  const abortFirst = new AbortController(), abortQueued = new AbortController();
  const first = client.solve(base, payload("one"), abortFirst.signal);
  const shared = client.solve(base, payload("one"));
  const queued = client.solve(base, payload("cancelled"), abortQueued.signal);
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const queuedRejected = assert.rejects(queued, { name: "AbortError" });
  await tick();
  abortFirst.abort(); abortQueued.abort();
  release();
  await Promise.all([firstRejected, queuedRejected, shared]);
  assert.deepEqual(ids, ["one"]);
});

test("Retry-After accepts seconds and dates without shortening the provider delay", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.equal(solverRetryDelay("120", 0, now), 120000);
  assert.equal(solverRetryDelay("Mon, 28 Sep 2026 12:01:00 GMT", 0, now), 60000);
  assert.equal(solverRetryDelay("nonsense", 2, now), 4000);
  assert.equal(solverRetryDelay(null, 0, now), 1000);
});

test("a timed out request releases the queue for the next calculation", async () => {
  let solves = 0;
  const client = createSolverServiceClient({ timeoutMs: 25, fetch: async (url, init) => {
    if (url.endsWith("/health")) return health();
    if (++solves > 1) return solved();
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  await assert.rejects(client.solve(base, payload("one")), /не ответил вовремя/);
  assert.equal((await client.solve(base, payload("two"))).engine, "ortools");
});
