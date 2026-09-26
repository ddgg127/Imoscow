import test from "node:test";
import assert from "node:assert/strict";
import { dragTime } from "../lib/time-drum-motion.ts";

test("manual drum drag follows the pointer and clamps without accumulated jumps", () => {
  assert.equal(dragTime(600, 32, 32, 30, false, 480, 1320), 570);
  assert.equal(dragTime(600, -64, 32, 30, false, 480, 1320), 660);
  assert.equal(dragTime(600, 32, 32, 30, true, 480, 1320), 595);
  assert.equal(dragTime(600, 1000, 32, 30, false, 480, 1320), 480);
});
