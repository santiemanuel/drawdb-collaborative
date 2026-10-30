// Screen-local touch navigation. Pan is the diagram point at viewport center.
export function touchPoint(event, bounds) {
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}
export function beginNavigation(points, transform, size) {
  const [a, b] = points;
  if (!a) return null;
  const center = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
  return {
    center,
    distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
    transform: { zoom: transform.zoom, pan: { ...transform.pan } },
    size: { ...size },
  };
}
export function moveNavigation(start, points) {
  if (!start || !points.length) return null;
  const [a, b] = points;
  const center = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
  const distance = b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  const zoom = Math.max(
    0.02,
    Math.min(
      5,
      start.transform.zoom *
        (b && start.distance > 0 ? distance / start.distance : 1),
    ),
  );
  const anchor = {
    x:
      start.transform.pan.x +
      (start.center.x - start.size.x / 2) / start.transform.zoom,
    y:
      start.transform.pan.y +
      (start.center.y - start.size.y / 2) / start.transform.zoom,
  };
  return {
    zoom,
    pan: {
      x: anchor.x - (center.x - start.size.x / 2) / zoom,
      y: anchor.y - (center.y - start.size.y / 2) / zoom,
    },
  };
}
