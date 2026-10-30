import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "./database.js";

test("legacy migration makes one consistent original-schema backup before altering", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-migration-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "drawdb.sqlite");
  const old = new Database(filename);
  old.pragma("journal_mode=WAL");
  old.exec(
    "CREATE TABLE diagrams(id TEXT PRIMARY KEY,name TEXT NOT NULL,document TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
  );
  old
    .prepare("INSERT INTO diagrams VALUES(?,?,?,?,?,?)")
    .run("old", "Original", "{}", 7, "before", "before");
  // Keep old connection open to ensure the backup includes committed WAL content.
  const migrated = openDatabase(filename);
  assert.equal(
    migrated.prepare("SELECT version FROM diagrams WHERE id='old'").get()
      .version,
    7,
  );
  assert.equal(
    migrated.prepare("SELECT project_id FROM diagrams WHERE id='old'").get()
      .project_id,
    null,
  );
  const backups = fs
    .readdirSync(dir)
    .filter((n) => n.includes("before-projects"));
  assert.equal(backups.length, 1);
  const backup = new Database(path.join(dir, backups[0]), { readonly: true });
  assert.equal(
    backup
      .prepare("PRAGMA table_info(diagrams)")
      .all()
      .some((c) => c.name === "project_id"),
    false,
  );
  assert.equal(
    backup.prepare("SELECT version FROM diagrams WHERE id='old'").get().version,
    7,
  );
  backup.close();
  migrated.close();
  old.close();
  const reopened = openDatabase(filename);
  reopened.close();
  assert.equal(
    fs.readdirSync(dir).filter((n) => n.includes("before-projects")).length,
    1,
  );
});

test("new empty database does not create a legacy backup", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-new-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(path.join(dir, "new.sqlite"));
  db.close();
  assert.equal(
    fs.readdirSync(dir).some((n) => n.includes("before-projects")),
    false,
  );
});

test("backup failure aborts before changing the legacy schema", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-backup-failure-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // The valid database basename leaves insufficient room for the unique backup suffix.
  const filename = path.join(dir, "x".repeat(220) + ".sqlite");
  const old = new Database(filename);
  old.exec(
    "CREATE TABLE diagrams(id TEXT PRIMARY KEY,name TEXT,document TEXT,version INTEGER,created_at TEXT,updated_at TEXT)",
  );
  old.close();
  assert.throws(() => openDatabase(filename), /migration aborted/);
  const check = new Database(filename, { readonly: true });
  assert.equal(
    check
      .prepare("PRAGMA table_info(diagrams)")
      .all()
      .some((c) => c.name === "project_id"),
    false,
  );
  check.close();
});
