import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { once } from "node:events";
import { createApplication } from "./index.js";
import { createEmailPolicy, validateAuthConfig } from "./auth.js";

function fileFixture(t, content = "allowed@example.com\n") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-allowlist-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "allowed-emails.txt");
  fs.writeFileSync(filename, content);
  return filename;
}

test("file allowlist trims blank lines and intersects inline exact-address list", (t) => {
  const filename = fileFixture(
    t,
    "\uFEFF# Existing proxy allowlist\r\n Allowed@Example.com \r\n\r\nother@example.com\n",
  );
  const allowed = createEmailPolicy({
    allowedEmailsFile: filename,
    allowedEmails: "allowed@example.com,inline-only@example.com",
  });
  assert.equal(allowed("ALLOWED@example.com"), true);
  assert.equal(allowed("other@example.com"), false);
  assert.equal(allowed("inline-only@example.com"), false);
  assert.equal(allowed("outsider@example.com"), false);
  fs.writeFileSync(filename, "replacement@example.com\n");
  assert.equal(allowed("allowed@example.com"), false);
});

test("configured missing, empty, malformed and non-file allowlists fail startup closed", (t) => {
  const filename = fileFixture(t);
  assert.throws(
    () =>
      validateAuthConfig({
        appUrl: "https://erd.example",
        allowedEmailsFile: filename + "-missing",
      }),
    /cannot be loaded safely/,
  );
  fs.writeFileSync(filename, " \n\n");
  assert.throws(
    () => createEmailPolicy({ allowedEmailsFile: filename }),
    /no allowed email/,
  );
  fs.writeFileSync(filename, "*@example.com\n");
  assert.throws(
    () => createEmailPolicy({ allowedEmailsFile: filename }),
    /wildcards/,
  );
  fs.writeFileSync(filename, "user@example.com,ignored\n");
  assert.throws(
    () => createEmailPolicy({ allowedEmailsFile: filename }),
    /exact email/,
  );
  fs.writeFileSync(filename, '"user@example.com"\n');
  assert.throws(
    () => createEmailPolicy({ allowedEmailsFile: filename }),
    /exact email/,
  );
  assert.throws(
    () => createEmailPolicy({ allowedEmailsFile: path.dirname(filename) }),
    /regular file/,
  );
});

async function appFixture(t, filename) {
  let email = "allowed@example.com";
  const app = createApplication({
    databasePath: ":memory:",
    authOptions: {
      appUrl: "http://localhost:3000",
      allowedEmails: "",
      allowedEmailsFile: filename,
      googleClientId: "test",
      googleClientSecret: "test",
      fetchImpl: async (url) =>
        url.endsWith("/token")
          ? Response.json({ access_token: "test" })
          : Response.json({
              sub: email,
              email,
              email_verified: true,
              name: "Test User",
            }),
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    for (const socket of app.websocket.clients) socket.terminate();
    await new Promise((resolve) => app.server.close(resolve));
    app.websocket.close();
    app.database.close();
  });
  const login = async (address) => {
    email = address;
    const started = await fetch(base + "/auth/google", { redirect: "manual" });
    const state = new URL(started.headers.get("location")).searchParams.get(
      "state",
    );
    return fetch(base + `/auth/google/callback?state=${state}&code=test`, {
      redirect: "manual",
      headers: { Cookie: `drawdb_oauth_state=${state}` },
    });
  };
  return { ...app, base, login };
}

test("Google callback rejects outsiders without creating users or sessions", async (t) => {
  const filename = fileFixture(t);
  const app = await appFixture(t, filename);
  const denied = await app.login("outsider@example.com");
  assert.equal(
    denied.headers.get("location"),
    "/projects?authError=not_allowed",
  );
  assert.equal(
    app.database.prepare("SELECT count(*) AS n FROM users").get().n,
    0,
  );
  const accepted = await app.login("allowed@example.com");
  assert.equal(accepted.headers.get("location"), "/projects");
  assert.equal(
    app.database.prepare("SELECT count(*) AS n FROM sessions").get().n,
    1,
  );
});

test("existing sessions are revoked when an email is removed or the file disappears", async (t) => {
  const filename = fileFixture(t);
  const app = await appFixture(t, filename);
  const user = app.access.upsertGoogle({
    sub: "existing",
    email: "allowed@example.com",
    name: "Allowed",
  });
  const first = app.access.createSession(user.id);
  const request = (raw) =>
    fetch(app.base + "/api/auth/me", {
      headers: { Cookie: `drawdb_session=${raw}` },
    }).then((response) => response.json());
  assert.equal((await request(first)).user.id, user.id);
  fs.writeFileSync(filename, "other@example.com\n");
  assert.equal((await request(first)).user, null);
  assert.equal(app.access.session(first), null);
  fs.writeFileSync(filename, "allowed@example.com\n");
  assert.equal((await request(first)).user, null);
  const second = app.access.createSession(user.id);
  fs.unlinkSync(filename);
  assert.equal((await request(second)).user, null);
  assert.equal(app.access.session(second), null);
});

test("removing a logged-in collaborator from the file closes the existing WebSocket", async (t) => {
  const filename = fileFixture(t);
  const app = await appFixture(t, filename);
  const user = app.access.upsertGoogle({
    sub: "socket-user",
    email: "allowed@example.com",
    name: "Allowed",
  });
  const session = app.access.createSession(user.id),
    project = app.access.createProject("Private", user.id);
  app.store.create({
    id: "socket-diagram",
    name: "Private",
    document: {},
    projectId: project.id,
  });
  const ws = new WebSocket(
    app.base.replace("http:", "ws:") + "/ws/diagrams/socket-diagram",
    {
      headers: {
        Origin: "http://localhost:3000",
        Cookie: `drawdb_session=${session}`,
      },
    },
  );
  await once(ws, "open");
  fs.writeFileSync(filename, "replacement@example.com\n");
  const closed = once(ws, "close");
  ws.send(JSON.stringify({ type: "ping", diagramId: "socket-diagram" }));
  assert.equal((await closed)[0], 1008);
  assert.equal(app.access.session(session), null);
});
