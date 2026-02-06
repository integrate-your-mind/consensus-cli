import test from "node:test";
import assert from "node:assert/strict";
import { cellKey, unpackCell } from "../../public/src/lib/layout.ts";

test("cellKey does not wrap for large coordinates (no 16-bit truncation)", async () => {
  const a = cellKey(0, 0);
  const b = cellKey(65536, 0);
  assert.notEqual(a, b);
});

test("unpackCell round-trips large signed coordinates", async () => {
  const key = cellKey(-123456, 789012);
  assert.deepEqual(unpackCell(key), { cx: -123456, cy: 789012 });
});

