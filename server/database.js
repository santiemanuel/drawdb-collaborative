import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

/* global process */

const DEFAULT_DATABASE_PATH = path.resolve("data/drawdb.sqlite");

export function openDatabase(databasePath = process.env.DATABASE_PATH) {
  const configuredPath = databasePath || DEFAULT_DATABASE_PATH;
  const resolvedPath =
    configuredPath === ":memory:"
      ? configuredPath
      : path.resolve(configuredPath);
  if (resolvedPath !== ":memory:") {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);
  const oldColumns = db.prepare("PRAGMA table_info(diagrams)").all();
  if (
    resolvedPath !== ":memory:" &&
    oldColumns.length &&
    !oldColumns.some((column) => column.name === "project_id")
  ) {
    const backupPath = `${resolvedPath}.before-projects-${Date.now()}-${crypto.randomUUID()}.sqlite`;
    try {
      // VACUUM INTO reads a consistent snapshot, including committed WAL pages.
      // It refuses to replace an existing file. No schema writes happen first.
      db.prepare("VACUUM INTO ?").run(backupPath);
      const backup = new Database(backupPath, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        if (backup.pragma("quick_check", { simple: true }) !== "ok")
          throw new Error("Backup integrity check failed");
      } finally {
        backup.close();
      }
      console.log(`Created pre-migration SQLite backup: ${backupPath}`);
    } catch (error) {
      db.close();
      throw new Error(
        `Database migration aborted: unable to create a verified pre-migration backup (${error.message}). Check data-volume space and permissions.`,
      );
    }
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS diagrams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      document TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applied_operations (
      diagram_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (diagram_id, operation_id),
      FOREIGN KEY (diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
    );
  `);
  if (
    !db
      .prepare("PRAGMA table_info(diagrams)")
      .all()
      .some((c) => c.name === "project_id")
  )
    db.exec("ALTER TABLE diagrams ADD COLUMN project_id TEXT");
  return db;
}

export function createDiagramStore(db) {
  const selectOne = db.prepare(
    "SELECT id, name, document, version, created_at, updated_at, project_id FROM diagrams WHERE id = ?",
  );
  const parse = (row) =>
    row ? { ...row, document: JSON.parse(row.document) } : null;

  const updateSnapshot = db.transaction(
    ({ id, name, document, baseVersion, operationId }) => {
      const current = selectOne.get(id);
      if (!current) return { status: "not_found" };
      const duplicate = operationId
        ? db
            .prepare(
              "SELECT version FROM applied_operations WHERE diagram_id = ? AND operation_id = ?",
            )
            .get(id, operationId)
        : null;
      if (duplicate) {
        return { status: "duplicate", diagram: parse(selectOne.get(id)) };
      }
      if (current.version !== baseVersion) {
        return { status: "conflict", diagram: parse(current) };
      }

      const now = new Date().toISOString();
      const version = current.version + 1;
      db.prepare(
        "UPDATE diagrams SET name = ?, document = ?, version = ?, updated_at = ? WHERE id = ?",
      ).run(name ?? current.name, JSON.stringify(document), version, now, id);
      if (operationId) {
        db.prepare(
          "INSERT INTO applied_operations (diagram_id, operation_id, version, created_at) VALUES (?, ?, ?, ?)",
        ).run(id, operationId, version, now);
      }
      return { status: "updated", diagram: parse(selectOne.get(id)) };
    },
  );

  return {
    list(projectId) {
      return db
        .prepare(
          "SELECT id, name, version, created_at, updated_at, project_id FROM diagrams WHERE project_id = ? ORDER BY updated_at DESC",
        )
        .all(projectId);
    },
    get(id) {
      return parse(selectOne.get(id));
    },
    create({ id, name, document, projectId }) {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO diagrams (id, name, document, version, created_at, updated_at, project_id) VALUES (?, ?, ?, 1, ?, ?, ?)",
      ).run(id, name, JSON.stringify(document), now, now, projectId ?? null);
      return parse(selectOne.get(id));
    },
    updateSnapshot,
    delete(id) {
      return (
        db.prepare("DELETE FROM diagrams WHERE id = ?").run(id).changes > 0
      );
    },
  };
}
