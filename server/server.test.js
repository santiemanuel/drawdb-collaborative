import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createDiagramStore, openDatabase } from "./database.js";
import { createApplication } from "./index.js";
import { isValidOperationPreview } from "./protocol.js";
import { createTableLockManager } from "./tableLocks.js";
import vm from "node:vm";

test("serves safely encoded backend configuration at runtime without caching", async (t) => {
  const backendUrl = 'https://backend.example.test/"quoted"';
  const gistBackendUrl = "https://gists.example.test";
  const application = createApplication({
    databasePath: ":memory:",
    backendUrl,
    gistBackendUrl,
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  t.after(async () => {
    await new Promise((resolve) => application.websocket.close(resolve));
    await new Promise((resolve) => application.server.close(resolve));
    application.database.close();
  });
  const response = await fetch(
    `http://127.0.0.1:${application.server.address().port}/config.js`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /javascript/);
  const context = { window: {} };
  vm.runInNewContext(await response.text(), context);
  assert.equal(context.window.__DRAWDB_CONFIG__.backendUrl, backendUrl);
  assert.equal(context.window.__DRAWDB_CONFIG__.gistBackendUrl, gistBackendUrl);
});

test("new upstream diagram fields survive API saves and collaborative snapshots", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  const { project, headers } = seedAccount(application);
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${application.server.address().port}`;
  const document = {
    database: "postgres",
    tables: [{ id: 0, width: 420, areaId: "area-1", fields: [] }],
    references: [
      {
        id: "route-roundtrip",
        startTableId: 0,
        endTableId: 0,
        startFieldId: 0,
        endFieldId: 0,
        layoutRoute: {
          version: 1,
          signature: "test-geometry",
          paths: [
            [
              { x: 420, y: 70 },
              { x: 460, y: 70 },
              { x: 460, y: 110 },
              { x: 420, y: 110 },
            ],
          ],
        },
      },
    ],
    areas: [{ id: "area-1", x: 0, y: 0, width: 800, height: 400 }],
    views: [{ id: "view-1", name: "active_users", baseTableId: 0 }],
    sqlHeader: "SET search_path TO public;",
  };
  const createdResponse = await fetch(`${base}/api/diagrams`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "upstream-fields",
      projectId: project.id,
      name: "Upstream fields",
      document,
    }),
  });
  assert.equal(createdResponse.status, 201);
  const socket = await openSocket(
    base.replace("http", "ws") + "/ws/diagrams/upstream-fields",
    headers,
  );
  t.after(async () => {
    socket.close();
    await new Promise((resolve) => application.websocket.close(resolve));
    await new Promise((resolve) => application.server.close(resolve));
    application.database.close();
  });
  const joined = waitForMessage(socket, (message) => message.type === "joined");
  socket.send(
    JSON.stringify({
      type: "join",
      diagramId: "upstream-fields",
      lastVersion: 1,
      participant: {
        clientId: "upgrade-client",
        displayName: "Upgrade",
        color: "#000",
      },
    }),
  );
  await joined;
  const updated = {
    ...document,
    sqlHeader: "SET search_path TO reporting;",
    views: [...document.views, { id: "view-2", name: "summary" }],
  };
  const applied = waitForMessage(
    socket,
    (message) => message.type === "operation_applied",
  );
  socket.send(
    JSON.stringify({
      type: "operation",
      diagramId: "upstream-fields",
      clientId: "upgrade-client",
      operationId: "upgrade-operation",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Updated fields", document: updated },
      },
    }),
  );
  assert.deepEqual((await applied).operation.payload.document, updated);
  const reloaded = await (
    await fetch(`${base}/api/diagrams/upstream-fields`, { headers })
  ).json();
  assert.deepEqual(reloaded.document, updated);
  assert.equal(reloaded.version, 2);
});

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 2_000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function openSocket(url, headers) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

test("camera awareness is room-scoped, validated, transient and available to late joiners", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  const { project, headers } = seedAccount(application);
  for (const id of ["camera-room", "other-room"]) {
    application.store.create({
      id,
      projectId: project.id,
      name: id,
      document: { tables: [] },
    });
  }
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `ws://127.0.0.1:${application.server.address().port}/ws/diagrams/`;
  const sockets = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.terminate());
    await new Promise((resolve) => application.websocket.close(resolve));
    await new Promise((resolve) => application.server.close(resolve));
    application.database.close();
  });
  const connect = async (diagramId, clientId) => {
    const socket = await openSocket(base + diagramId, headers);
    sockets.push(socket);
    const joined = waitForMessage(
      socket,
      (message) => message.type === "presence",
    );
    socket.send(
      JSON.stringify({
        type: "join",
        diagramId,
        lastVersion: 1,
        participant: { clientId, displayName: clientId, color: "#2563eb" },
      }),
    );
    return { socket, presence: await joined };
  };
  const { socket: presenter } = await connect("camera-room", "presenter");
  const { socket: viewer } = await connect("camera-room", "viewer");
  const { socket: outsider } = await connect("other-room", "outsider");
  const outsideMessages = [];
  outsider.on("message", (raw) => outsideMessages.push(JSON.parse(raw)));
  const camera = { x: 100, y: -250, zoom: 1.44, followingClientId: null };
  const received = waitForMessage(
    viewer,
    (message) => message.type === "viewport",
  );
  presenter.send(
    JSON.stringify({
      type: "viewport",
      diagramId: "camera-room",
      clientId: "forged-sender",
      viewport: { ...camera, extra: "not forwarded" },
    }),
  );
  const update = await received;
  assert.equal(update.clientId, "presenter");
  assert.deepEqual(update.viewport, camera);

  // The invalid update must not replace the cached camera in the presence snapshot.
  presenter.send(
    JSON.stringify({
      type: "viewport",
      diagramId: "camera-room",
      viewport: { ...camera, zoom: -1 },
    }),
  );
  const pong = waitForMessage(presenter, (message) => message.type === "pong");
  presenter.send(JSON.stringify({ type: "ping", diagramId: "camera-room" }));
  await pong;
  const { socket: late, presence } = await connect("camera-room", "late");
  assert.deepEqual(
    presence.participants.find((item) => item.clientId === "presenter")
      .viewport,
    camera,
  );
  assert.equal(application.store.get("camera-room").version, 1);
  assert.deepEqual(application.store.get("camera-room").document, {
    tables: [],
  });
  assert.equal(
    outsideMessages.some((message) => message.type === "viewport"),
    false,
  );

  const left = waitForMessage(
    late,
    (message) =>
      message.type === "presence" &&
      !message.participants.some((item) => item.clientId === "presenter"),
  );
  presenter.close();
  await left;
  const { presence: rejoined } = await connect("camera-room", "presenter");
  assert.equal(
    rejoined.participants.find((item) => item.clientId === "presenter")
      .viewport,
    null,
  );
});

test("diagram persistence enforces optimistic versions and operation IDs", () => {
  const database = openDatabase(":memory:");
  const store = createDiagramStore(database);

  const created = store.create({
    id: "diagram-1",
    name: "One",
    document: { tables: [] },
  });
  assert.equal(created.version, 1);

  const updated = store.updateSnapshot({
    id: "diagram-1",
    name: "Updated",
    document: { tables: [{ id: "table-1" }] },
    baseVersion: 1,
    operationId: "operation-1",
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.diagram.version, 2);

  const duplicate = store.updateSnapshot({
    id: "diagram-1",
    name: "Duplicate",
    document: {},
    baseVersion: 1,
    operationId: "operation-1",
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.diagram.name, "Updated");

  const conflict = store.updateSnapshot({
    id: "diagram-1",
    name: "Stale",
    document: {},
    baseVersion: 1,
    operationId: "operation-2",
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.diagram.version, 2);
  database.close();
});

test("validates ephemeral table movement previews", () => {
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: 0, x: 10, y: 20 },
    }),
    true,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "table-1", x: 120.5, y: -40 },
    }),
    true,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "../table", x: 1, y: 2 },
    }),
    false,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "table-1", x: Number.NaN, y: 2 },
    }),
    false,
  );
});

test("table edit leases are exclusive and expire", () => {
  let currentTime = 1_000;
  const locks = createTableLockManager({
    leaseMs: 100,
    now: () => currentTime,
  });
  const participantA = {
    clientId: "client-a",
    displayName: "A",
    color: "#000",
  };
  const participantB = {
    clientId: "client-b",
    displayName: "B",
    color: "#fff",
  };

  const acquired = locks.acquire("diagram-1", "table-1", participantA);
  assert.equal(acquired.granted, true);
  assert.equal(locks.owns("diagram-1", "table-1", "client-a"), true);

  const denied = locks.acquire("diagram-1", "table-1", participantB);
  assert.equal(denied.granted, false);
  assert.equal(denied.lock.clientId, "client-a");

  currentTime += 101;
  const acquiredAfterExpiry = locks.acquire(
    "diagram-1",
    "table-1",
    participantB,
  );
  assert.equal(acquiredAfterExpiry.granted, true);
  assert.notEqual(acquiredAfterExpiry.lock.token, acquired.lock.token);
});

test("WebSocket table locks reject concurrent edits", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  const { project, headers } = seedAccount(application);
  application.store.create({
    id: "diagram-lock-test",
    projectId: project.id,
    name: "Lock test",
    document: { tables: [{ id: 0, x: 0, y: 0 }] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  const url = `ws://127.0.0.1:${port}/ws/diagrams/diagram-lock-test`;
  const clientA = await openSocket(url, headers);
  const clientB = await openSocket(url, headers);
  t.after(async () => {
    clientA.close();
    clientB.close();
    await new Promise((resolve) => application.websocket.close(resolve));
    await new Promise((resolve) => application.server.close(resolve));
    application.database.close();
  });

  const join = async (socket, clientId) => {
    const joined = waitForMessage(
      socket,
      (message) => message.type === "joined",
    );
    socket.send(
      JSON.stringify({
        type: "join",
        diagramId: "diagram-lock-test",
        lastVersion: 1,
        participant: { clientId, displayName: clientId, color: "#000" },
      }),
    );
    await joined;
  };
  await join(clientA, "client-a");
  await join(clientB, "client-b");

  const grantedA = waitForMessage(
    clientA,
    (message) => message.type === "table_lock_granted",
  );
  const releasedState = waitForMessage(
    clientB,
    (message) =>
      message.type === "table_lock_state" && message.locks.length === 0,
  );
  clientA.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-a",
    }),
  );
  const lockA = (await grantedA).lock;

  const deniedB = waitForMessage(
    clientB,
    (message) => message.type === "table_lock_denied",
  );
  clientB.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-b",
    }),
  );
  assert.equal((await deniedB).lock.clientId, "client-a");

  const previewRejected = waitForMessage(
    clientB,
    (message) =>
      message.type === "error" &&
      message.message === "A table edit lock is required",
  );
  clientB.send(
    JSON.stringify({
      type: "operation_preview",
      diagramId: "diagram-lock-test",
      operation: {
        type: "table.move",
        payload: { id: 0, x: 10, y: 20 },
      },
    }),
  );
  await previewRejected;

  clientA.send(
    JSON.stringify({
      type: "table_lock_release",
      diagramId: "diagram-lock-test",
      tableId: 0,
      token: lockA.token,
    }),
  );
  await releasedState;
  const grantedB = waitForMessage(
    clientB,
    (message) => message.type === "table_lock_granted",
  );
  clientB.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-b-after-release",
    }),
  );
  assert.equal((await grantedB).lock.clientId, "client-b");
});

function seedAccount(application) {
  const user = application.access.upsertGoogle({
    sub: "test-subject",
    email: "owner@example.test",
    name: "Test owner",
    email_verified: true,
  });
  const session = application.access.createSession(user.id);
  const project = application.access.createProject("Test project", user.id);
  return {
    project,
    headers: {
      Cookie: `drawdb_session=${session}`,
      Origin: "http://localhost:3000",
    },
  };
}
