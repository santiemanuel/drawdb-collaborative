import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLayoutChanges,
  isLayoutSnapshotCurrent,
  getSaveCompletionState,
} from "./layoutTransaction.js";

test("async layout rejects navigation, read-only transition and geometry edits", () => {
  const initial = { diagramId: "a", signature: "geometry" };
  const current = {
    diagramId: "a",
    readOnly: false,
    signature: () => "geometry",
  };
  assert.equal(isLayoutSnapshotCurrent(initial, current), true);
  for (const changed of [
    { ...current, diagramId: "b" },
    { ...current, readOnly: true },
    { ...current, signature: () => "changed" },
    null,
  ]) {
    assert.equal(isLayoutSnapshotCurrent(initial, changed), false);
  }
});

test("layout undo and redo restore coordinates and routes without clobbering other properties", () => {
  const route = {
    version: 1,
    paths: [
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
      ],
    ],
    signature: "s",
  };
  const entry = JSON.parse(
    JSON.stringify({
      elements: [{ id: 1, undo: { x: 0, y: 0 }, redo: { x: 100, y: 50 } }],
      routes: [{ id: 2, undo: null, redo: route }],
    }),
  );
  const tables = [
    { id: 1, x: 0, y: 0, name: "changed concurrently" },
    { id: 3, x: 5, y: 6 },
  ];
  const relationships = [{ id: 2, color: "new color", layoutRoute: null }];
  const redo = applyLayoutChanges(tables, relationships, entry, "redo");
  assert.equal(redo.tables[0].x, 100);
  assert.equal(redo.tables[0].name, "changed concurrently");
  assert.equal(redo.tables[1], tables[1]);
  assert.deepEqual(redo.relationships[0].layoutRoute, route);
  assert.equal(redo.relationships[0].color, "new color");
  assert.deepEqual(
    applyLayoutChanges(redo.tables, redo.relationships, entry, "undo"),
    { tables, relationships },
  );
});

test("old save completion cannot mark a newer diagram edit saved", () => {
  const buildDocument = () => {};
  const started = { loadedDiagramId: "a", buildDocument, title: "name" };
  assert.equal(getSaveCompletionState(started, { ...started }), "saved");
  assert.equal(
    getSaveCompletionState(started, { ...started, buildDocument: () => {} }),
    "resave",
  );
  assert.equal(
    getSaveCompletionState(started, { ...started, title: "renamed" }),
    "resave",
  );
  assert.equal(
    getSaveCompletionState(started, { ...started, loadedDiagramId: "b" }),
    "ignore",
  );
});

test("layout leases wait for their save, but release on a same-diagram failure", async () => {
  const { shouldReleaseLayoutLocks } = await import("./layoutTransaction.js");
  const held = { appliedAt: 20 };
  assert.equal(
    shouldReleaseLayoutLocks(held, { diagramId: "a", startedAt: 10 }, "a"),
    false,
  );
  assert.equal(
    shouldReleaseLayoutLocks(held, { diagramId: "a", startedAt: 20 }, "a"),
    true,
  );
  assert.equal(
    shouldReleaseLayoutLocks(
      held,
      { diagramId: "a", startedAt: 10, failed: true },
      "a",
    ),
    true,
  );
  assert.equal(
    shouldReleaseLayoutLocks(
      held,
      { diagramId: "b", startedAt: 30, failed: true },
      "a",
    ),
    false,
  );
});
