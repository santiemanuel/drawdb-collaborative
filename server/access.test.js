/* global process */
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createApplication } from "./index.js";
import { digest } from "./access.js";

const origin = "http://localhost:3000";
async function fixture(t, authOptions = {}) {
  const app = createApplication({
    databasePath: ":memory:",
    authOptions: { appUrl: origin, ...authOptions },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    for (const ws of app.websocket.clients) ws.terminate();
    await new Promise((r) => app.server.close(r));
    app.websocket.close();
    app.database.close();
  });
  const user = (sub) =>
    app.access.upsertGoogle({ sub, email: `${sub}@example.com`, name: sub });
  const owner = user("owner"),
    editor = user("editor"),
    viewer = user("viewer"),
    stranger = user("stranger");
  const sessions = Object.fromEntries(
    [owner, editor, viewer, stranger].map((u) => [
      u.id,
      app.access.createSession(u.id),
    ]),
  );
  const project = app.access.createProject("Private project", owner.id);
  for (const [u, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ])
    app.database
      .prepare("INSERT INTO project_members VALUES(?,?,?)")
      .run(project.id, u.id, role);
  const diagram = app.store.create({
    id: "test-diagram",
    name: "Private schema",
    document: { tables: [] },
    projectId: project.id,
  });
  const request = (path, { user: who, ...options } = {}) =>
    fetch(url + path, {
      ...options,
      headers: {
        Origin: origin,
        ...(who ? { Cookie: `drawdb_session=${sessions[who.id]}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  return {
    ...app,
    url,
    owner,
    editor,
    viewer,
    stranger,
    project,
    diagram,
    sessions,
    request,
  };
}

test("REST hides private and legacy diagrams and enforces project roles", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/diagrams")).status, 401);
  for (const who of [null, f.stranger])
    assert.equal(
      (await f.request("/api/diagrams/test-diagram", { user: who })).status,
      404,
    );
  assert.equal(
    (await f.request("/api/diagrams/test-diagram", { user: f.viewer })).status,
    200,
  );
  const body = JSON.stringify({
    name: "changed",
    document: { tables: [] },
    baseVersion: 1,
  });
  assert.equal(
    (
      await f.request("/api/diagrams/test-diagram", {
        method: "PUT",
        user: f.viewer,
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/diagrams/test-diagram", {
        method: "PUT",
        user: f.editor,
        body,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request("/api/diagrams/test-diagram", {
        method: "DELETE",
        user: f.editor,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/projects", {
        method: "POST",
        user: f.owner,
        body: JSON.stringify({ name: "Bad origin" }),
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  f.store.create({ id: "legacy", name: "Legacy", document: {} });
  assert.equal(
    (await f.request("/api/diagrams/legacy", { user: f.owner })).status,
    404,
  );
  assert.equal(
    (
      await f.request("/api/projects/" + f.project.id, {
        method: "DELETE",
        user: f.owner,
      })
    ).status,
    409,
  );
});

test("public links are revocable read-only capabilities and expose no membership", async (t) => {
  const f = await fixture(t);
  const share = await (
    await f.request(`/api/projects/${f.project.id}/share`, {
      method: "POST",
      user: f.owner,
    })
  ).json();
  const publicData = await (
    await f.request(`/api/public/${share.token}`)
  ).json();
  assert.equal(publicData.project.name, "Private project");
  assert.equal(JSON.stringify(publicData).includes("owner@example"), false);
  assert.equal(
    (await f.request(`/api/diagrams/test-diagram?share=${share.token}`)).status,
    200,
  );
  assert.equal(
    (
      await f.request(`/api/diagrams/test-diagram?share=${share.token}`, {
        method: "PUT",
        body: JSON.stringify({ name: "Bad", document: {}, baseVersion: 1 }),
      })
    ).status,
    403,
  );
  await f.request(`/api/projects/${f.project.id}/share`, {
    method: "DELETE",
    user: f.owner,
  });
  assert.equal(
    (await f.request(`/api/diagrams/test-diagram?share=${share.token}`)).status,
    404,
  );
});

test("invitations bind verified identity email and never transfer ownership", async (t) => {
  const f = await fixture(t);
  const response = await f.request(
    `/api/projects/${f.project.id}/invitations`,
    {
      method: "POST",
      user: f.owner,
      body: JSON.stringify({ email: "new@example.com", role: "editor" }),
    },
  );
  assert.equal(response.status, 201);
  const wrong = f.access.upsertGoogle({
    sub: "wrong",
    email: "wrong@example.com",
    name: "Wrong",
  });
  assert.equal(f.access.role(f.project.id, wrong.id), null);
  const accepted = f.access.upsertGoogle({
    sub: "new",
    email: "NEW@example.com",
    name: "New",
  });
  assert.equal(f.access.role(f.project.id, accepted.id), "editor");
  assert.equal(f.access.project(f.project.id).owner_id, f.owner.id);
});

test("sessions expire and logout revokes the server record", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await (await f.request("/api/auth/me", { user: f.owner })).json()).user.id,
    f.owner.id,
  );
  await f.request("/api/auth/logout", { method: "POST", user: f.owner });
  assert.equal(
    (await (await f.request("/api/auth/me", { user: f.owner })).json()).user,
    null,
  );
  f.database
    .prepare("UPDATE sessions SET expires_at=0 WHERE token_hash=?")
    .run(digest(f.sessions[f.editor.id]));
  assert.equal(
    (await (await f.request("/api/auth/me", { user: f.editor })).json()).user,
    null,
  );
});

test("OAuth rejects state replay, uses PKCE, and verifies Google's email", async (t) => {
  let tokenRequest;
  const f = await fixture(t, {
    googleClientId: "test-id",
    googleClientSecret: "test-secret",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/token")) {
        tokenRequest = options;
        return Response.json({ access_token: "test-only" });
      }
      return Response.json({
        sub: "google-user",
        email: "login@example.com",
        email_verified: true,
        name: "Google User",
      });
    },
  });
  const login = await f.request("/auth/google?returnTo=https://evil.example", {
    redirect: "manual",
  });
  const google = new URL(login.headers.get("location"));
  assert.equal(google.searchParams.get("code_challenge_method"), "S256");
  const state = google.searchParams.get("state");
  const path = `/auth/google/callback?state=${state}&code=test-code`;
  assert.equal((await f.request(path, { redirect: "manual" })).status, 400);
  const result = await f.request(path, {
    redirect: "manual",
    headers: { Cookie: `drawdb_oauth_state=${state}` },
  });
  assert.equal(result.headers.get("location"), "/projects");
  assert.match(result.headers.get("set-cookie"), /HttpOnly/);
  assert.ok(tokenRequest.body.get("code_verifier"));
  assert.equal(
    (
      await f.request(path, {
        redirect: "manual",
        headers: { Cookie: `drawdb_oauth_state=${state}` },
      })
    ).status,
    400,
  );
});

async function connect(f, who, share) {
  const ws = new WebSocket(
    f.url.replace("http:", "ws:") +
      `/ws/diagrams/test-diagram${share ? `?share=${share}` : ""}`,
    {
      headers: {
        Origin: origin,
        ...(who ? { Cookie: `drawdb_session=${f.sessions[who.id]}` } : {}),
      },
    },
  );
  await once(ws, "open");
  return ws;
}
function nextMessage(ws) {
  return once(ws, "message").then(([m]) => JSON.parse(m));
}

test("websocket enforces viewer access, authoritative name, and live revocation", async (t) => {
  const f = await fixture(t);
  const ws = await connect(f, f.viewer);
  const joined = nextMessage(ws);
  ws.send(
    JSON.stringify({
      type: "join",
      diagramId: "test-diagram",
      lastVersion: 1,
      participant: {
        clientId: "viewer-client",
        displayName: "Spoofed Admin",
        color: "blue",
      },
    }),
  );
  await joined;
  const messages = [];
  ws.on("message", (m) => messages.push(JSON.parse(m)));
  ws.send(
    JSON.stringify({
      type: "operation",
      diagramId: "test-diagram",
      clientId: "viewer-client",
      operationId: "op",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Forbidden", document: {} },
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(f.store.get("test-diagram").name, "Private schema");
  assert.ok(messages.some((m) => m.type === "error"));
  const closed = once(ws, "close");
  f.database
    .prepare("DELETE FROM project_members WHERE user_id=?")
    .run(f.viewer.id);
  ws.send(JSON.stringify({ type: "ping", diagramId: "test-diagram" }));
  const [code] = await closed;
  assert.equal(code, 1008);
});

async function join(ws, id) {
  const joined = nextMessage(ws);
  ws.send(
    JSON.stringify({
      type: "join",
      diagramId: "test-diagram",
      lastVersion: 1,
      participant: { clientId: id, displayName: "Fake name", color: "blue" },
    }),
  );
  await joined;
}
function operation(ws, id, version = 1) {
  ws.send(
    JSON.stringify({
      type: "operation",
      diagramId: "test-diagram",
      clientId: id,
      operationId: `op-${version}`,
      baseVersion: version,
      operation: {
        type: "snapshot.replace",
        payload: { name: `Version ${version + 1}`, document: { tables: [] } },
      },
    }),
  );
}

test("revoked viewers receive no outgoing updates and downgraded editors cannot write", async (t) => {
  const f = await fixture(t),
    viewer = await connect(f, f.viewer),
    editor = await connect(f, f.editor);
  await join(viewer, "viewer-one");
  await join(editor, "editor-one");
  const received = [];
  viewer.on("message", (m) => received.push(JSON.parse(m)));
  f.database
    .prepare("DELETE FROM project_members WHERE user_id=?")
    .run(f.viewer.id);
  const closed = once(viewer, "close");
  operation(editor, "editor-one");
  assert.equal((await closed)[0], 1008);
  assert.equal(
    received.some((m) => m.type === "operation_applied"),
    false,
  );
  assert.equal(f.store.get("test-diagram").version, 2);
  f.database
    .prepare("UPDATE project_members SET role='viewer' WHERE user_id=?")
    .run(f.editor.id);
  const downgraded = once(editor, "close");
  operation(editor, "editor-one", 2);
  assert.equal((await downgraded)[0], 1008);
  assert.equal(f.store.get("test-diagram").version, 2);
});

test("public websocket tokens rotate and websocket upgrades reject cross-origin requests", async (t) => {
  const f = await fixture(t);
  const share = await (
    await f.request(`/api/projects/${f.project.id}/share`, {
      method: "POST",
      user: f.owner,
    })
  ).json();
  const guest = await connect(f, null, share.token);
  await join(guest, "guest");
  const denied = nextMessage(guest);
  operation(guest, "guest");
  assert.equal((await denied).type, "error");
  const closed = once(guest, "close");
  await f.request(`/api/projects/${f.project.id}/share`, {
    method: "POST",
    user: f.owner,
  });
  guest.send(JSON.stringify({ type: "ping", diagramId: "test-diagram" }));
  assert.equal((await closed)[0], 1008);
  const evil = new WebSocket(
    f.url.replace("http:", "ws:") + "/ws/diagrams/test-diagram",
    {
      headers: {
        Origin: "https://evil.example",
        Cookie: `drawdb_session=${f.sessions[f.owner.id]}`,
      },
    },
  );
  const error = await once(evil, "error");
  assert.match(error[0].message, /403/);
});

test("OAuth rejects unverified email and HTTPS sets Secure session cookies", async (t) => {
  let verified = false;
  const f = await fixture(t, {
    appUrl: "https://erd.example",
    googleClientId: "test",
    googleClientSecret: "test",
    fetchImpl: async (url) =>
      url.endsWith("/token")
        ? Response.json({ access_token: "test" })
        : Response.json({
            sub: "test",
            email: "test@example.com",
            email_verified: verified,
            name: "Test",
          }),
  });
  const login = async () => {
    const start = await f.request("/auth/google", { redirect: "manual" });
    const state = new URL(start.headers.get("location")).searchParams.get(
      "state",
    );
    return f.request(`/auth/google/callback?state=${state}&code=code`, {
      redirect: "manual",
      headers: { Cookie: `drawdb_oauth_state=${state}` },
    });
  };
  const rejected = await login();
  assert.equal(rejected.headers.get("location"), "/projects?authError=failed");
  assert.equal(
    f.database
      .prepare("SELECT count(*) AS count FROM users WHERE google_sub='test'")
      .get().count,
    0,
  );
  verified = true;
  const accepted = await login();
  assert.match(accepted.headers.get("set-cookie"), /Secure/);
  assert.match(accepted.headers.get("set-cookie"), /HttpOnly/);
  assert.match(accepted.headers.get("set-cookie"), /SameSite=Lax/);
});

test("membership revocation and downgrade cancel stale invitations", async (t) => {
  const f = await fixture(t);
  const invite = () =>
    f.request(`/api/projects/${f.project.id}/invitations`, {
      method: "POST",
      user: f.owner,
      body: JSON.stringify({ email: f.editor.email, role: "editor" }),
    });
  await invite();
  await f.request(`/api/projects/${f.project.id}/members/${f.editor.id}`, {
    method: "PATCH",
    user: f.owner,
    body: JSON.stringify({ role: "viewer" }),
  });
  f.access.upsertGoogle({
    sub: "editor",
    email: f.editor.email,
    name: "Editor",
  });
  assert.equal(f.access.role(f.project.id, f.editor.id), "viewer");
  await invite();
  await f.request(`/api/projects/${f.project.id}/members/${f.editor.id}`, {
    method: "DELETE",
    user: f.owner,
  });
  f.access.upsertGoogle({
    sub: "editor",
    email: f.editor.email,
    name: "Editor",
  });
  assert.equal(f.access.role(f.project.id, f.editor.id), null);
});

test("production requires explicit HTTPS APP_URL before opening the database", async () => {
  const { validateAuthConfig } = await import("./auth.js");
  const saved = process.env.APP_URL;
  delete process.env.APP_URL;
  try {
    assert.throws(
      () => validateAuthConfig({ nodeEnv: "production" }),
      /APP_URL is required/,
    );
    assert.throws(
      () =>
        validateAuthConfig({
          nodeEnv: "production",
          appUrl: "http://localhost:3000",
        }),
      /must use HTTPS/,
    );
    assert.throws(
      () =>
        validateAuthConfig({
          nodeEnv: "production",
          appUrl: "https://erd.example/path",
        }),
      /only the public/,
    );
    assert.equal(
      validateAuthConfig({
        nodeEnv: "production",
        appUrl: "https://erd.example",
      }),
      "https://erd.example",
    );
  } finally {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  }
});
