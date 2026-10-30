import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "./index.js";
test("health probe is anonymous and does not open protected diagram APIs", async (t) => {
  const app = createApplication({ databasePath: ":memory:" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => app.websocket.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    app.database.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal((await fetch(`${base}/api/diagrams`)).status, 401);
  assert.equal((await fetch(`${base}/api/projects`)).status, 401);
});
