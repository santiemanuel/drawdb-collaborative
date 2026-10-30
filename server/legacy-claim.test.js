import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { openDatabase, createDiagramStore } from "./database.js";
import { createAccessStore } from "./access.js";
/* global process */
test("legacy claim requires an existing owner and preserves documents idempotently", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-claim-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "database.sqlite");
  let db = openDatabase(filename);
  const access = createAccessStore(db);
  const owner = access.upsertGoogle({
    sub: "owner",
    email: "owner@example.test",
    name: "Owner",
    email_verified: true,
  });
  const document = {
    tables: [{ id: 0, name: "Preserved" }],
    sqlHeader: "-- retained",
  };
  createDiagramStore(db).create({
    id: "legacy-one",
    name: "Original",
    document,
  });
  assert.equal(access.diagramAccess("legacy-one", owner), null);
  db.close();
  const env = { ...process.env, DATABASE_PATH: filename };
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/claim-legacy-diagrams.js", ...args], {
      env,
      encoding: "utf8",
    });
  assert.equal(run("owner@example.test", "Recovered").status, 1);
  assert.equal(
    run("missing@example.test", "Recovered", "--confirm-backup").status,
    1,
  );
  assert.equal(
    run("owner@example.test", "Recovered", "--confirm-backup").status,
    0,
  );
  assert.equal(
    run("owner@example.test", "Recovered", "--confirm-backup").status,
    0,
  );
  db = openDatabase(filename);
  assert.deepEqual(createDiagramStore(db).get("legacy-one").document, document);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM projects").get().n, 1);
  db.close();
});
