import test from "node:test";
import assert from "node:assert/strict";
import {
  touchPoint,
  beginNavigation,
  moveNavigation,
} from "./touchNavigation.js";
const size = { x: 400, y: 600 };
const transform = { zoom: 2, pan: { x: 10, y: 20 } };
test("touch coordinates are local to canvas, including mobile header offset", () => {
  assert.deepEqual(
    touchPoint({ clientX: 120, clientY: 180 }, { left: 20, top: 80 }),
    { x: 100, y: 100 },
  );
});
test("one finger pans without changing zoom", () => {
  const start = beginNavigation([{ x: 100, y: 100 }], transform, size);
  assert.deepEqual(moveNavigation(start, [{ x: 140, y: 160 }]), {
    zoom: 2,
    pan: { x: -10, y: -10 },
  });
  assert.deepEqual(transform, { zoom: 2, pan: { x: 10, y: 20 } });
});
test("pinch keeps the diagram anchor under the moving midpoint", () => {
  const start = beginNavigation(
    [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ],
    transform,
    size,
  );
  const next = moveNavigation(start, [
    { x: 100, y: 220 },
    { x: 300, y: 220 },
  ]);
  assert.equal(next.zoom, 4);
  assert.deepEqual(next.pan, { x: -15, y: -10 });
});
test("pinch clamps scale and handles coincident fingers safely", () => {
  const start = beginNavigation(
    [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ],
    transform,
    size,
  );
  assert.equal(
    moveNavigation(start, [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
    ]).zoom,
    5,
  );
  assert.equal(
    moveNavigation(start, [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]).zoom,
    0.02,
  );
  const same = beginNavigation(
    [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ],
    transform,
    size,
  );
  assert.equal(
    moveNavigation(same, [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]).zoom,
    2,
  );
});
test("finger changes can rebase without jumps; empty sequences are inert", () => {
  const points = [{ x: 80, y: 90 }];
  assert.deepEqual(
    moveNavigation(beginNavigation(points, transform, size), points),
    transform,
  );
  assert.equal(beginNavigation([], transform, size), null);
  assert.equal(moveNavigation(null, points), null);
  assert.equal(
    moveNavigation(beginNavigation(points, transform, size), []),
    null,
  );
});
