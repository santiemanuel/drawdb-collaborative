import {
  tableFieldHeight,
  tableHeaderHeight,
  noteWidth,
} from "../data/constants";
import {
  getRelatedFieldKeysByTable,
  getTableHeight,
  getTableWidth,
  getVisibleFieldEntries,
  getRelationshipFields,
  getFieldOffsetY,
  getCommentHeight,
} from "./utils";
import { getViewHeight, getViewWidth, resolveViewColumns } from "./views";
import { geometrySignature, layoutGeometry } from "./elkLayout.js";

export function getLayoutGeometry(tables, relationships, settings = {}) {
  const related = getRelatedFieldKeysByTable(relationships);
  const nodes = tables.map((table) => {
    const width = getTableWidth(table),
      entries = getVisibleFieldEntries(table, related.get(table.id));
    const fields = entries.map((e) => e.field);
    const height = getTableHeight(
      table,
      settings.showComments,
      related.get(table.id),
    );
    const ports = entries.map(({ field, originalIndex }, index) => ({
      id: field.id,
      index: originalIndex,
      y:
        tableHeaderHeight +
        getCommentHeight(table.comment, width, settings.showComments) +
        getFieldOffsetY(fields, index, width, settings.showComments) +
        tableFieldHeight / 2,
    }));
    return {
      id: table.id,
      x: table.x ?? 0,
      y: table.y ?? 0,
      width,
      height,
      locked: !!table.locked,
      hidden: !!table.hidden,
      ports,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const anchor = (node, fieldId) =>
    node?.ports.find((p) => p.id === fieldId || p.index === fieldId)?.y ??
    tableHeaderHeight / 2;
  const edges = relationships.map((r) => ({
    id: r.id,
    source: r.startTableId,
    target: r.endTableId,
    pairs: getRelationshipFields(r).map((pair) => ({
      startFieldId: pair.startFieldId,
      endFieldId: pair.endFieldId,
      startY: anchor(byId.get(r.startTableId), pair.startFieldId),
      endY: anchor(byId.get(r.endTableId), pair.endFieldId),
    })),
  }));
  return { nodes, edges };
}

export function getLayoutGeometrySignature(
  tables,
  relationships,
  settings,
  { obstacles = [] } = {},
) {
  const { nodes, edges } = getLayoutGeometry(tables, relationships, settings);
  return geometrySignature(nodes, edges, obstacles);
}

export async function autoArrange(
  tables,
  relationships,
  settings,
  options = {},
) {
  const { nodes, edges } = getLayoutGeometry(tables, relationships, settings);
  return layoutGeometry(nodes, edges, options);
}

// Keep obstacles identical to the rectangles used by the canvas and fit-to-view.
export function getLayoutObstacles(
  notes = [],
  views = [],
  tables = [],
  settings = {},
) {
  return [
    ...notes
      .filter((n) => !n.hidden)
      .map((n) => ({
        x: n.x,
        y: n.y,
        width: n.width ?? noteWidth,
        height: n.height,
      })),
    ...views
      .filter((v) => !v.hidden)
      .map((v) => ({
        x: v.x,
        y: v.y,
        width: getViewWidth(v),
        height: getViewHeight(
          v,
          resolveViewColumns(v, tables),
          settings.showComments,
        ),
      })),
  ].filter(
    (r) =>
      [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
      r.width > 0 &&
      r.height > 0,
  );
}

export { getLayoutTables } from "./elkLayout.js";
