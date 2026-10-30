// Pure geometry layer. ELK is loaded only when the user requests a layout.
const GAP = 72;
const CLEARANCE = 18;
const finite = (n) => Number.isFinite(n);
const keyOf = (id) => `${typeof id}:${String(id)}`;
const sorted = (items) =>
  [...items].sort((a, b) => keyOf(a.id).localeCompare(keyOf(b.id)));

export function geometrySignature(nodes, edges, obstacles = []) {
  const text = JSON.stringify({
    nodes: sorted(nodes).map((n) => [
      n.id,
      n.x,
      n.y,
      n.width,
      n.height,
      !!n.locked,
      !!n.hidden,
      n.ports,
    ]),
    edges: sorted(edges).map((e) => [e.id, e.source, e.target, e.pairs]),
    obstacles: obstacles
      .map(({ x, y, width, height }) => [x, y, width, height])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
  // Two independent 32-bit accumulators keep route metadata small, deterministic,
  // and invalidate when any table/field/obstacle geometry changes.
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${text.length}`;
}

export function simplifyOrthogonal(points) {
  const out = [];
  for (const p of points) {
    if (!finite(p.x) || !finite(p.y))
      throw new Error("Layout returned invalid coordinates");
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    while (out.length > 1) {
      const prev = out[out.length - 2],
        tail = out[out.length - 1];
      if (
        (prev.x === tail.x &&
          tail.x === p.x &&
          (tail.y - prev.y) * (p.y - tail.y) >= 0) ||
        (prev.y === tail.y &&
          tail.y === p.y &&
          (tail.x - prev.x) * (p.x - tail.x) >= 0)
      )
        out.pop();
      else break;
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

export function segmentHitsRect(a, b, r) {
  const eps = 0.001;
  if (Math.abs(a.x - b.x) < eps) {
    return (
      a.x > r.x + eps &&
      a.x < r.x + r.width - eps &&
      Math.max(a.y, b.y) > r.y + eps &&
      Math.min(a.y, b.y) < r.y + r.height - eps
    );
  }
  if (Math.abs(a.y - b.y) < eps) {
    return (
      a.y > r.y + eps &&
      a.y < r.y + r.height - eps &&
      Math.max(a.x, b.x) > r.x + eps &&
      Math.min(a.x, b.x) < r.x + r.width - eps
    );
  }
  return true;
}

class Heap {
  data = [];
  push(item) {
    const a = this.data;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].score <= item.score) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.data,
      root = a[0],
      last = a.pop();
    if (!a.length) return root;
    let i = 0;
    while (i * 2 + 1 < a.length) {
      let c = i * 2 + 1;
      if (c + 1 < a.length && a[c + 1].score < a[c].score) c++;
      if (a[c].score >= last.score) break;
      a[i] = a[c];
      i = c;
    }
    a[i] = last;
    return root;
  }
}

// Used for edges incident to fixed nodes, whose positions Layered cannot enforce.
// A rectilinear visibility grid routes around all visible tables and extra objects.
export function routeAroundObstacles(
  start,
  end,
  rects,
  { budget = 45000, deadline = Infinity } = {},
) {
  const obstacles = rects.map((r) => ({
    x: r.x - CLEARANCE,
    y: r.y - CLEARANCE,
    width: r.width + CLEARANCE * 2,
    height: r.height + CLEARANCE * 2,
  }));
  const xs = [
    ...new Set([
      start.x,
      end.x,
      ...obstacles.flatMap((r) => [r.x, r.x + r.width]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...obstacles.flatMap((r) => [r.y, r.y + r.height]),
    ]),
  ].sort((a, b) => a - b);
  const sx = xs.indexOf(start.x),
    sy = ys.indexOf(start.y),
    ex = xs.indexOf(end.x),
    ey = ys.indexOf(end.y);
  const heap = new Heap(),
    costs = new Map(),
    parents = new Map();
  const id = (x, y, d) => `${x}:${y}:${d}`;
  const startId = id(sx, sy, 0);
  costs.set(startId, 0);
  heap.push({ x: sx, y: sy, d: 0, cost: 0, score: 0, key: startId });
  let expanded = 0,
    found;
  while (heap.data.length && expanded++ < budget) {
    if (expanded % 32 === 0 && Date.now() >= deadline) return null;
    const c = heap.pop();
    if (c.cost !== costs.get(c.key)) continue;
    if (c.x === ex && c.y === ey) {
      found = c;
      break;
    }
    const from = { x: xs[c.x], y: ys[c.y] };
    for (const [dx, dy, d] of [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 2],
      [0, -1, 2],
    ]) {
      const nx = c.x + dx,
        ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= xs.length || ny >= ys.length) continue;
      const to = { x: xs[nx], y: ys[ny] };
      if (obstacles.some((r) => segmentHitsRect(from, to, r))) continue;
      const cost =
        c.cost +
        Math.abs(to.x - from.x) +
        Math.abs(to.y - from.y) +
        (c.d && c.d !== d ? 24 : 0);
      const nextId = id(nx, ny, d);
      if (cost >= (costs.get(nextId) ?? Infinity)) continue;
      costs.set(nextId, cost);
      parents.set(nextId, c);
      heap.push({
        x: nx,
        y: ny,
        d,
        cost,
        key: nextId,
        score: cost + Math.abs(to.x - end.x) + Math.abs(to.y - end.y),
      });
    }
  }
  if (!found) return null;
  const points = [];
  let c = found;
  while (c) {
    points.push({ x: xs[c.x], y: ys[c.y] });
    c = parents.get(c.key);
  }
  return simplifyOrthogonal(points.reverse());
}

function validRect(r) {
  return (
    r &&
    [r.x, r.y, r.width, r.height].every(finite) &&
    r.width > 0 &&
    r.height > 0
  );
}
function overlaps(a, b, gap = 0) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}
// Browser calculations run in a dedicated same-origin worker. The bundled
// in-process implementation is reserved for Node geometry tests.
async function createEngine() {
  if (typeof window !== "undefined") {
    if (typeof Worker === "undefined")
      throw new Error(
        "This browser does not support background layout workers",
      );
    const [{ default: ELK }, { default: workerUrl }] = await Promise.all([
      import("elkjs/lib/elk-api.js"),
      import("elkjs/lib/elk-worker.min.js?worker&url"),
    ]);
    const elk = new ELK({
      workerFactory: () => new Worker(workerUrl),
      algorithms: ["layered"],
    });
    return { elk, terminate: () => elk.terminateWorker() };
  }
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  return { elk: new ELK(), terminate: () => {} };
}

export async function layoutGeometry(
  rawNodes,
  rawEdges,
  { obstacles = [], signal, timeoutMs = 20000 } = {},
) {
  if (signal?.aborted) throw new Error("Layout cancelled");
  const nodes = sorted(rawNodes).filter((n) => !n.hidden);
  if (nodes.length > 600)
    throw new Error(
      "Automatic layout supports up to 600 visible tables at once",
    );
  if (nodes.some((n) => !validRect(n)))
    throw new Error("Tables have invalid layout dimensions");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = sorted(rawEdges).filter(
    (e) => byId.has(e.source) && byId.has(e.target),
  );
  if (edges.reduce((count, e) => count + e.pairs.length, 0) > 2400)
    throw new Error(
      "Automatic layout supports up to 2400 field connections at once",
    );
  const movable = nodes.filter((n) => !n.locked),
    fixed = nodes.filter((n) => n.locked);
  if (!movable.length)
    return {
      positions: [],
      routes: [],
      signature: geometrySignature(rawNodes, rawEdges, obstacles),
      warnings: [],
    };
  const obstaclesValid = obstacles.filter(validRect);
  const children = movable.map((n, i) => ({
    id: `node${i}`,
    width: n.width,
    height: n.height,
    ports: [],
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
  }));
  const childById = new Map(movable.map((n, i) => [n.id, children[i]]));
  const elkEdges = [],
    edgeMeta = new Map();
  for (const [edgeIndex, e] of edges.entries()) {
    const source = childById.get(e.source),
      target = childById.get(e.target);
    if (!source || !target) continue;
    for (const [pairIndex, pair] of e.pairs.entries()) {
      const edgeId = `edge${edgeIndex}_${pairIndex}`;
      const sp = `${edgeId}_s`,
        tp = `${edgeId}_t`;
      source.ports.push({
        id: sp,
        x: source.width,
        y: pair.startY,
        width: 0,
        height: 0,
        layoutOptions: { "elk.port.side": "EAST" },
      });
      target.ports.push({
        id: tp,
        x: 0,
        y: pair.endY,
        width: 0,
        height: 0,
        layoutOptions: { "elk.port.side": "WEST" },
      });
      elkEdges.push({ id: edgeId, sources: [sp], targets: [tp] });
      edgeMeta.set(edgeId, { relationshipId: e.id, pairIndex });
    }
  }
  const { elk, terminate } = await createEngine();
  let timer, onAbort;
  const graph = {
    id: "root",
    children,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(GAP),
      "elk.layered.spacing.nodeNodeBetweenLayers": "140",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "16",
      "elk.layered.spacing.edgeNodeBetweenLayers": "30",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "18",
      "elk.spacing.componentComponent": "100",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.randomSeed": "1",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.thoroughness": "10",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
      "elk.separateConnectedComponents": "true",
    },
  };
  let result;
  try {
    result = await Promise.race([
      signal?.aborted
        ? Promise.reject(new Error("Layout cancelled"))
        : elk.layout(graph),
      new Promise((_, reject) => {
        if (!signal) return;
        onAbort = () => reject(new Error("Layout cancelled"));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Automatic layout timed out; try a smaller diagram"),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    terminate();
  }
  if (signal?.aborted) throw new Error("Layout cancelled");
  const originalByElkId = new Map(
    children.map((n, i) => [n.id, movable[i].id]),
  );
  const rawPositions = result.children.map((n) => ({
    id: originalByElkId.get(n.id),
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
  }));
  const blockers = [...fixed, ...obstaclesValid];
  // Preserve ELK's complete geometry. Translating the whole movable group avoids
  // locked tables/notes/views without destroying ranks or routed bend points.
  let shiftX = 0,
    shiftY = 0;
  const occupiedBounds = {
    x: 0,
    y: 0,
    width: result.width ?? 0,
    height: result.height ?? 0,
  };
  if (blockers.some((r) => overlaps(occupiedBounds, r, 36))) {
    const blockRight = Math.max(...blockers.map((r) => r.x + r.width));
    shiftX = blockRight + 100 - Math.min(...rawPositions.map((p) => p.x));
  }
  const positions = rawPositions.map((p) => ({
    id: p.id,
    x: p.x + shiftX,
    y: p.y + shiftY,
  }));
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const finalNodes = rawNodes.map((n) => ({ ...n, ...positionById.get(n.id) }));
  const finalById = new Map(finalNodes.map((n) => [n.id, n]));
  const signature = geometrySignature(finalNodes, rawEdges, obstacles);
  const routeById = new Map();
  for (const edge of result.edges ?? []) {
    const meta = edgeMeta.get(edge.id);
    if (!meta) continue;
    const sections = edge.sections ?? [];
    if (sections.length !== 1) continue;
    const s = sections[0];
    const points = simplifyOrthogonal(
      [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({
        x: p.x + shiftX,
        y: p.y + shiftY,
      })),
    );
    if (!routeById.has(meta.relationshipId))
      routeById.set(meta.relationshipId, []);
    routeById.get(meta.relationshipId)[meta.pairIndex] = points;
  }
  const rects = [...finalNodes.filter((n) => !n.hidden), ...obstaclesValid];
  const warnings = [];
  const fallbackDeadline = Date.now() + 1500;
  for (const e of edges) {
    if (!byId.get(e.source).locked && !byId.get(e.target).locked) continue;
    const s = finalById.get(e.source),
      t = finalById.get(e.target);
    const paths = [];
    for (const pair of e.pairs) {
      // Yield between fixed-edge paths; no obstacle search may monopolize the UI.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw new Error("Layout cancelled");
      const right = t.x + t.width / 2 >= s.x + s.width / 2;
      const start = { x: right ? s.x + s.width : s.x, y: s.y + pair.startY };
      const end = { x: right ? t.x : t.x + t.width, y: t.y + pair.endY };
      const startStub = { x: start.x + (right ? 1 : -1) * 36, y: start.y };
      const endStub = { x: end.x + (right ? -1 : 1) * 36, y: end.y };
      const blockedStub = rects.some(
        (r) =>
          (r !== s && segmentHitsRect(start, startStub, r)) ||
          (r !== t && segmentHitsRect(endStub, end, r)),
      );
      const route =
        blockedStub || Date.now() >= fallbackDeadline
          ? null
          : routeAroundObstacles(startStub, endStub, rects, {
              deadline: Math.min(fallbackDeadline, Date.now() + 30),
            });
      if (!route) {
        warnings.push(
          `Unable to route fixed relationship ${String(e.id)} within the obstacle routing budget`,
        );
        break;
      }
      paths.push(simplifyOrthogonal([start, ...route, end]));
    }
    if (paths.length === e.pairs.length) routeById.set(e.id, paths);
  }
  const routes = edges.flatMap((e) => {
    const paths = routeById.get(e.id);
    return paths?.length === e.pairs.length &&
      Array.from(paths).every((p) => p?.length > 1)
      ? [{ id: e.id, paths, signature }]
      : [];
  });
  return { positions, routes, signature, warnings };
}

// Match Canvas visibility exactly; membership is explicit, not geometric.
export function getLayoutTables(tables, areas = []) {
  const hiddenAreas = new Set(areas.filter((a) => a.hidden).map((a) => a.id));
  return tables.map((table) =>
    hiddenAreas.has(table.areaId) ? { ...table, hidden: true } : table,
  );
}
