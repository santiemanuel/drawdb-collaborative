import test from "node:test";
import assert from "node:assert/strict";
import {
  layoutGeometry,
  geometrySignature,
  segmentHitsRect,
  routeAroundObstacles,
} from "./elkLayout.js";
const node = (id, extra = {}) => ({
  id,
  x: 0,
  y: 0,
  width: 220,
  height: 200,
  ports: [],
  ...extra,
});
const edge = (id, source, target, pairs = [{ startY: 68, endY: 105 }]) => ({
  id,
  source,
  target,
  pairs,
});
function placed(nodes, result) {
  const p = new Map(result.positions.map((n) => [n.id, n]));
  return nodes.map((n) => ({ ...n, ...p.get(n.id) }));
}
function noOverlap(nodes) {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j];
      assert.ok(
        !(
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
        ),
        `Overlap ${a.id}/${b.id}`,
      );
    }
}
function orthogonal(paths) {
  for (const points of paths)
    for (let i = 1; i < points.length; i++)
      assert.ok(
        Math.abs(points[i - 1].x - points[i].x) < 0.001 ||
          Math.abs(points[i - 1].y - points[i].y) < 0.001,
      );
}

test("ELK layered places a real port-connected chain and returns orthogonal routes", async () => {
  const nodes = [node(1), node(2, { width: 340, height: 330 }), node(3)];
  const edges = [edge("a", 1, 2), edge("b", 2, 3)];
  const r = await layoutGeometry(nodes, edges);
  const ns = placed(nodes, r);
  noOverlap(ns);
  assert.equal(r.routes.length, 2);
  assert.ok(ns[0].x < ns[1].x && ns[1].x < ns[2].x);
  for (const route of r.routes) {
    orthogonal(route.paths);
    const e = edges.find((e) => e.id === route.id),
      a = ns.find((n) => n.id === e.source),
      b = ns.find((n) => n.id === e.target);
    assert.deepEqual(route.paths[0][0], { x: a.x + a.width, y: a.y + 68 });
    assert.deepEqual(route.paths[0].at(-1), { x: b.x, y: b.y + 105 });
  }
  assert.equal(r.signature, geometrySignature(ns, edges));
});
test("cycles, self loops, parallel relationships and composite pairs retain distinct routes", async () => {
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [
    edge("ab", "a", "b"),
    edge("ba", "b", "a"),
    edge("bc", "b", "c"),
    edge("ca", "c", "a"),
    edge("self", "a", "a", [{ startY: 68, endY: 142 }]),
    edge("parallel", "a", "b"),
    edge("composite", "a", "c", [
      { startY: 68, endY: 68 },
      { startY: 105, endY: 142 },
    ]),
  ];
  const r = await layoutGeometry(nodes, edges);
  noOverlap(placed(nodes, r));
  assert.equal(r.routes.length, edges.length);
  assert.equal(r.routes.find((e) => e.id === "composite").paths.length, 2);
  for (const route of r.routes) orthogonal(route.paths);
});
test("disconnected components and isolated tables are deterministic without a 16:9 repack", async () => {
  const nodes = [node(4), node(3), node(2), node(1), node(5)];
  const edges = [edge("a", 1, 2), edge("b", 3, 4)];
  const a = await layoutGeometry(nodes, edges),
    b = await layoutGeometry([...nodes].reverse(), [...edges].reverse());
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.routes, b.routes);
  noOverlap(placed(nodes, a));
});
test("locked table remains fixed, movable table avoids it, fixed relationship is routed", async () => {
  const nodes = [node(1, { locked: true }), node(2, { x: 900, y: 700 })];
  const edges = [edge("x", 1, 2)];
  const r = await layoutGeometry(nodes, edges);
  assert.equal(r.positions.length, 1);
  assert.equal(r.positions[0].id, 2);
  noOverlap(placed(nodes, r));
  assert.equal(r.routes.length, 1);
  orthogonal(r.routes[0].paths);
});
test("notes and views act as blockers and complete ELK routes avoid their space", async () => {
  const nodes = [node(1), node(2)];
  const edges = [edge("x", 1, 2)];
  const obstacles = [{ x: 250, y: 0, width: 100, height: 250 }];
  const r = await layoutGeometry(nodes, edges, { obstacles });
  const ns = placed(nodes, r);
  noOverlap([...ns, ...obstacles]);
  for (const route of r.routes)
    for (const p of route.paths)
      for (let i = 1; i < p.length; i++)
        assert.ok(!segmentHitsRect(p[i - 1], p[i], obstacles[0]));
  assert.equal(r.signature, geometrySignature(ns, edges, obstacles));
});
test("hidden tables stay untouched and hidden relationships are not routed", async () => {
  const nodes = [node(1, { hidden: true, x: 99, y: 99 }), node(2)];
  const r = await layoutGeometry(nodes, [edge("x", 1, 2)]);
  assert.deepEqual(
    r.positions.map((p) => p.id),
    [2],
  );
  assert.equal(r.routes.length, 0);
});
test("all fixed nodes and empty diagrams make no changes", async () => {
  assert.deepEqual((await layoutGeometry([], [])).positions, []);
  assert.deepEqual(
    (await layoutGeometry([node(1, { locked: true })], [])).positions,
    [],
  );
});
test("route metadata invalidates on positions, dimensions, fields, connections or obstacles", () => {
  const nodes = [node(1, { ports: [{ id: "id", index: 0, y: 68 }] }), node(2)],
    edges = [edge("x", 1, 2)];
  const initial = geometrySignature(nodes, edges);
  for (const next of [
    [node(1, { x: 10 }), node(2)],
    [node(1, { height: 400 }), node(2)],
    [node(1, { ports: [{ id: "id", index: 0, y: 105 }] }), node(2)],
  ])
    assert.notEqual(geometrySignature(next, edges), initial);
  assert.notEqual(geometrySignature(nodes, [edge("x", 2, 1)]), initial);
  assert.notEqual(
    geometrySignature(nodes, edges, [{ x: 0, y: 0, width: 10, height: 10 }]),
    initial,
  );
});
test("fixed-edge rectilinear route goes around an intervening obstacle", () => {
  const r = { x: 100, y: 0, width: 100, height: 200 };
  const path = routeAroundObstacles({ x: 0, y: 100 }, { x: 300, y: 100 }, [r]);
  assert.ok(path);
  orthogonal([path]);
  for (let i = 1; i < path.length; i++)
    assert.ok(!segmentHitsRect(path[i - 1], path[i], r));
});
test("cancelled requests reject without running ELK", async () => {
  await assert.rejects(
    layoutGeometry([node(1)], [], { signal: { aborted: true } }),
    /cancelled/,
  );
});

test("tables in hidden areas retain coordinates and routes are excluded", async () => {
  const { getLayoutTables } = await import("./elkLayout.js");
  const original = [node(1, { areaId: "hidden", x: 700, y: 900 }), node(2)];
  const nodes = getLayoutTables(original, [{ id: "hidden", hidden: true }]);
  const result = await layoutGeometry(nodes, [edge("hidden", 1, 2)]);
  assert.equal(nodes[0].hidden, true);
  assert.equal(original[0].hidden, undefined);
  assert.deepEqual(
    result.positions.map((p) => p.id),
    [2],
  );
  assert.deepEqual(result.routes, []);
});
