// Camera awareness is transient; it never changes the diagram or its version.
export function isValidViewport(viewport) {
  return (
    viewport !== null &&
    typeof viewport === "object" &&
    !Array.isArray(viewport) &&
    Number.isFinite(viewport.x) &&
    Number.isFinite(viewport.y) &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom >= 0.02 &&
    viewport.zoom <= 5 &&
    (viewport.followingClientId === null ||
      (typeof viewport.followingClientId === "string" &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(viewport.followingClientId)))
  );
}

// Also handles simultaneous follows and indirect cycles (A -> B -> C -> A).
export function canFollowParticipant(clientId, targetId, viewports) {
  const visited = new Set([clientId]);
  let current = targetId;
  while (current) {
    if (visited.has(current)) return false;
    visited.add(current);
    current = viewports[current]?.followingClientId;
  }
  return Boolean(targetId);
}
