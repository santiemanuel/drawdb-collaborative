import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
/* global process */
const destination = process.argv[2];
if (!destination || fs.existsSync(destination)) {
  console.error(
    "Usage: node scripts/backup-database.js /data/backups/unique-backup.sqlite (destination must not exist)",
  );
  process.exitCode = 1;
} else {
  const db = new Database(process.env.DATABASE_PATH || "data/drawdb.sqlite", {
    readonly: true,
    fileMustExist: true,
  });
  try {
    fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
    await db.backup(path.resolve(destination));
    console.log("Consistent SQLite backup completed.");
  } finally {
    db.close();
  }
}
