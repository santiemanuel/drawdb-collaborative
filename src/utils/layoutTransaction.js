// Keep asynchronous layout guards and undo payload application independent of React.
export function isLayoutSnapshotCurrent(initial, current) {
  return Boolean(
    current &&
      !current.readOnly &&
      current.diagramId === initial.diagramId &&
      current.signature() === initial.signature,
  );
}

export function applyLayoutChanges(tables, relationships, entry, direction) {
  const changes = new Map(entry.elements.map((e) => [e.id, e[direction]]));
  const routes = new Map(entry.routes.map((e) => [e.id, e[direction]]));
  return {
    tables: tables.map((table) =>
      changes.has(table.id) ? { ...table, ...changes.get(table.id) } : table,
    ),
    relationships: relationships.map((rel) =>
      routes.has(rel.id) ? { ...rel, layoutRoute: routes.get(rel.id) } : rel,
    ),
  };
}

export function getSaveCompletionState(started, latest) {
  if (started.loadedDiagramId !== latest.loadedDiagramId) return "ignore";
  return started.buildDocument === latest.buildDocument &&
    started.title === latest.title
    ? "saved"
    : "resave";
}

export function shouldReleaseLayoutLocks(held, outcome, diagramId) {
  return Boolean(
    held &&
      outcome?.diagramId === diagramId &&
      (outcome.failed || outcome.startedAt >= held.appliedAt),
  );
}
