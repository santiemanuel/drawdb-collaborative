/** Read persisted ELK routes defensively; old/stale documents use manual routing. */
export function getLayoutRouteGeometry(route, signature) {
  if (
    !signature ||
    route?.version !== 1 ||
    route.signature !== signature ||
    !Array.isArray(route.paths) ||
    route.paths.length === 0 ||
    Array.from(route.paths).some(
      (points) =>
        !Array.isArray(points) ||
        points.length < 2 ||
        Array.from(points).some(
          (point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y),
        ),
    )
  ) {
    return null;
  }

  const main = route.paths[0];
  const length = main
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - main[index].x, point.y - main[index].y),
      0,
    );
  if (!Number.isFinite(length) || length === 0) return null;
  const pointAt = (distance) => {
    let remaining = Math.max(0, Math.min(distance, length));
    for (let index = 1; index < main.length; index++) {
      const start = main[index - 1];
      const end = main[index];
      const segment = Math.hypot(end.x - start.x, end.y - start.y);
      if (segment === 0) continue;
      if (remaining <= segment) {
        const ratio = remaining / segment;
        return {
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
        };
      }
      remaining -= segment;
    }
    return main[main.length - 1];
  };
  const inset = Math.min(28, length / 3);
  return {
    path: route.paths
      .map((points) =>
        points
          .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
          .join(" "),
      )
      .join(" "),
    labelPoint: pointAt(length / 2),
    startCardinality: pointAt(inset),
    endCardinality: pointAt(length - inset),
  };
}
