import assert from "node:assert/strict";
import test from "node:test";
import { ObjectType } from "../data/constants.js";
import { tableIdsForDrag } from "./dragLocks.js";

test("dragging an area locks its unselected members and keeps numeric table IDs", () => {
  const ids = tableIdsForDrag({
    element: { id: "area-1" },
    type: ObjectType.AREA,
    selection: [
      { id: "area-1", type: ObjectType.AREA },
      { id: 0, type: ObjectType.TABLE },
    ],
    tables: [
      { id: 0, areaId: "area-1" },
      { id: "member", areaId: "area-1" },
      { id: "fixed", areaId: "area-1", locked: true },
      { id: "outside", areaId: "area-2" },
    ],
    areaIdOf: (table) => table.areaId,
  });
  assert.deepEqual(ids, [0, "member"]);
});

test("clicking a new table does not lock the previous selection", () => {
  assert.deepEqual(
    tableIdsForDrag({
      element: { id: "new" },
      type: ObjectType.TABLE,
      selection: [{ id: "old", type: ObjectType.TABLE }],
      tables: [],
      areaIdOf: () => null,
    }),
    ["new"],
  );
});

test("dragging views alone requires no table leases", () => {
  assert.deepEqual(
    tableIdsForDrag({
      element: { id: 0 },
      type: ObjectType.VIEW,
      selection: [{ id: 0, type: ObjectType.VIEW }],
      tables: [{ id: 0, areaId: null }],
      areaIdOf: (table) => table.areaId,
    }),
    [],
  );
});
