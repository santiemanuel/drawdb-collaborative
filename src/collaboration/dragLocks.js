import { ObjectType } from "../data/constants.js";

// Subject areas carry their member tables, even when those tables are not selected.
export function tableIdsForDrag({
  element,
  type,
  selection,
  tables,
  areaIdOf,
}) {
  const selected = selection.some(
    (item) => item.type === type && item.id === element.id,
  );
  const dragSet = selected ? selection : [{ id: element.id, type }];
  const tableIds = new Set(
    dragSet
      .filter((item) => item.type === ObjectType.TABLE)
      .map((item) => item.id),
  );
  const areaIds = new Set(
    dragSet
      .filter((item) => item.type === ObjectType.AREA)
      .map((item) => item.id),
  );
  if (areaIds.size > 0) {
    tables.forEach((table) => {
      if (!table.locked && areaIds.has(areaIdOf(table))) tableIds.add(table.id);
    });
  }
  return [...tableIds];
}
