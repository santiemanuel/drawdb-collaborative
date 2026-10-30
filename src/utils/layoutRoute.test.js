import test from "node:test";
import assert from "node:assert/strict";
import { getLayoutRouteGeometry } from "./layoutRoute.js";

const route = {
  version: 1,
  signature: "current",
  paths: [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
  ],
};

test("ELK route consumes bend points and anchors along the main polyline", () => {
  const result = getLayoutRouteGeometry(route, "current");
  assert.equal(result.path, "M 0 0 L 100 0 L 100 100");
  assert.deepEqual(result.labelPoint, { x: 100, y: 0 });
  assert.ok(Math.abs(result.startCardinality.x - 28) < 1e-9);
  assert.equal(result.startCardinality.y, 0);
  assert.deepEqual(result.endCardinality, { x: 100, y: 72 });
});

test("all composite branches render while labels remain on the primary branch", () => {
  const result = getLayoutRouteGeometry(
    {
      ...route,
      paths: [
        ...route.paths,
        [
          { x: 0, y: 40 },
          { x: 100, y: 40 },
        ],
      ],
    },
    "current",
  );
  assert.match(result.path, /M 0 40 L 100 40$/);
  assert.deepEqual(result.labelPoint, { x: 100, y: 0 });
});

test("stale, legacy, incomplete, nonfinite and zero-length routes fall back", () => {
  assert.equal(getLayoutRouteGeometry(route, "changed"), null);
  assert.equal(getLayoutRouteGeometry(route, ""), null);
  for (const candidate of [
    null,
    { ...route, version: 2 },
    { ...route, paths: [] },
    { ...route, paths: new Array(2) },
    { ...route, paths: [[...new Array(2)]] },
    { ...route, paths: [[{ x: 0, y: 0 }]] },
    {
      ...route,
      paths: [
        [
          { x: NaN, y: 0 },
          { x: 1, y: 0 },
        ],
      ],
    },
    {
      ...route,
      paths: [
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      ],
    },
  ]) {
    assert.equal(getLayoutRouteGeometry(candidate, "current"), null);
  }
});

test("short routes and repeated points keep cardinalities inside the line", () => {
  const result = getLayoutRouteGeometry(
    {
      ...route,
      paths: [
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 9, y: 0 },
        ],
      ],
    },
    "current",
  );
  assert.deepEqual(result.startCardinality, { x: 3, y: 0 });
  assert.deepEqual(result.endCardinality, { x: 6, y: 0 });
});
