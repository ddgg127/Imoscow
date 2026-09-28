import test from "node:test";
import assert from "node:assert/strict";
import { createTimeDrumMotion, dragTime } from "../lib/time-drum-motion.ts";

test("manual drum drag follows the pointer and clamps without accumulated jumps", () => {
  assert.equal(dragTime(600, 32, 32, 30, false, 480, 1320), 570);
  assert.equal(dragTime(600, -64, 32, 30, false, 480, 1320), 660);
  assert.equal(dragTime(600, 32, 32, 30, true, 480, 1320), 595);
  assert.equal(dragTime(600, 1000, 32, 30, false, 480, 1320), 480);
});

function harness(time = 600) {
  let nextId = 0;
  const pending = new Map();
  const painted = [];
  const published = [];
  const motion = createTimeDrumMotion({ time, start: 450, end: 1320,
    requestFrame: callback => { pending.set(++nextId, callback); return nextId; },
    cancelFrame: id => pending.delete(id),
    paint: value => painted.push(value),
    publish: (value, final) => published.push({ value, final }),
  });
  const frame = timestamp => {
    const callbacks = [...pending.values()]; pending.clear();
    callbacks.forEach(callback => callback(timestamp));
  };
  return { motion, frame, painted, published, pending };
}

test("drag coalesces pointer bursts, paints fractional positions and commits the exact release", () => {
  const h = harness();
  h.motion.begin();
  for (let n = 0; n < 20; n++) h.motion.set(600 + n / 10);
  assert.equal(h.pending.size, 1);
  h.frame(0);
  assert.equal(h.painted.at(-1), 601.9);
  for (let t = 16; t <= 160; t += 16) { h.motion.set(600 + t / 100); h.frame(t); }
  assert.ok(h.painted.length > h.published.length * 2, "visual frames must not wait for whole-plan updates");
  h.motion.set(650.125);
  h.motion.finish();
  assert.equal(h.pending.size, 0);
  assert.deepEqual(h.published.at(-1), { value: 650.125, final: true });
  assert.equal(h.painted.at(-1), 650.125);
});

test("delayed parent updates cannot pull an active drag back", () => {
  const h = harness();
  h.motion.begin(); h.motion.set(640.5); h.frame(0);
  h.motion.sync(610, 450, 1320);
  assert.equal(h.painted.at(-1), 640.5);
  h.motion.set(645.75);
  h.motion.sync(620, 450, 1320);
  h.frame(16); h.motion.finish();
  assert.deepEqual(h.published.at(-1), { value: 645.75, final: true });
  h.motion.sync(700, 450, 1320);
  assert.equal(h.painted.at(-1), 700, "external time changes work again after release");
});

test("wheel motion eases instead of jumping and accumulates successive wheel targets", () => {
  const h = harness();
  h.motion.set(h.motion.getTarget() + 30, true); h.frame(0);
  assert.ok(h.painted.at(-1) > 600 && h.painted.at(-1) < 630);
  h.motion.set(h.motion.getTarget() + 30, true);
  assert.equal(h.motion.getTarget(), 660);
  h.motion.sync(602, 450, 1320);
  for (let t = 16; t <= 1000; t += 16) h.frame(t);
  assert.ok(h.painted.every((value, index, all) => value <= 660 && (!index || value >= all[index - 1])));
  assert.deepEqual(h.published.at(-1), { value: 660, final: true });
  assert.equal(h.pending.size, 0);
});

test("wheel reversal and timeline limits never overshoot or leave a pending frame", () => {
  const h = harness(480);
  h.motion.set(1000, true); h.frame(0);
  const reversal = h.motion.getTime();
  h.motion.set(0, true);
  const first = h.painted.length;
  for (let t = 16; t <= 1000; t += 16) h.frame(t);
  const reversed = h.painted.slice(first);
  assert.ok(reversed.every((value, index) => value >= 450 && value <= reversal && (!index || value <= reversed[index - 1])));
  assert.equal(h.motion.getTime(), 450);
  h.motion.set(2000); h.motion.finish();
  assert.equal(h.motion.getTime(), 1320);
  assert.equal(h.pending.size, 0);
});

test("motion uses elapsed time at different refresh rates and stops cleanly on unmount", () => {
  const samples = [16, 32].map(interval => {
    const h = harness(); h.motion.set(660, true); h.frame(0);
    for (let t = interval; t <= 320; t += interval) h.frame(t);
    const value = h.motion.getTime();
    h.motion.dispose(); const count = h.published.length;
    h.frame(1000); h.motion.set(800); h.motion.finish();
    assert.equal(h.published.length, count);
    assert.equal(h.pending.size, 0);
    return value;
  });
  assert.ok(Math.abs(samples[0] - samples[1]) < 0.000001);
});
