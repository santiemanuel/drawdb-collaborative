import crypto from "node:crypto";

export const token = () => crypto.randomBytes(32).toString("base64url");
export const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const normalizeEmail = (email) => email.trim().toLowerCase();

export function createAccessStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, picture TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, return_to TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('viewer','editor')), PRIMARY KEY(project_id,user_id));
    CREATE TABLE IF NOT EXISTS project_invitations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','editor')), token_hash TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id,email));
    CREATE TABLE IF NOT EXISTS project_shares (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
  `);
  if (
    !db
      .prepare("PRAGMA table_info(diagrams)")
      .all()
      .some((c) => c.name === "project_id")
  ) {
    db.exec(
      "ALTER TABLE diagrams ADD COLUMN project_id TEXT REFERENCES projects(id)",
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS diagrams_project ON diagrams(project_id); CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)",
  );
  const getUser = (id) =>
    db.prepare("SELECT id,email,name,picture FROM users WHERE id=?").get(id) ||
    null;
  const role = (projectId, userId) => {
    if (!userId) return null;
    const p = db
      .prepare("SELECT owner_id FROM projects WHERE id=?")
      .get(projectId);
    if (!p) return null;
    return p.owner_id === userId
      ? "owner"
      : db
          .prepare(
            "SELECT role FROM project_members WHERE project_id=? AND user_id=?",
          )
          .get(projectId, userId)?.role || null;
  };
  const project = (id) =>
    db
      .prepare(
        "SELECT p.*,u.name AS owner_name FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=?",
      )
      .get(id) || null;
  return {
    db,
    getUser,
    role,
    project,
    upsertGoogle(profile) {
      return db.transaction(() => {
        let user = db
          .prepare("SELECT id FROM users WHERE google_sub=?")
          .get(profile.sub);
        const id = user?.id || crypto.randomUUID();
        const email = normalizeEmail(profile.email);
        db.prepare(
          "INSERT INTO users(id,google_sub,email,name,picture,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,name=excluded.name,picture=excluded.picture",
        ).run(
          id,
          profile.sub,
          email,
          profile.name.slice(0, 200),
          profile.picture || null,
          new Date().toISOString(),
        );
        const invitations = db
          .prepare(
            "SELECT * FROM project_invitations WHERE email=? AND expires_at>?",
          )
          .all(email, Date.now());
        for (const inv of invitations) {
          if (project(inv.project_id)?.owner_id !== id)
            db.prepare(
              "INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role",
            ).run(inv.project_id, id, inv.role);
          db.prepare("DELETE FROM project_invitations WHERE id=?").run(inv.id);
        }
        return getUser(id);
      })();
    },
    createSession(userId) {
      const raw = token();
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        digest(raw),
        userId,
        Date.now() + 7 * 86400000,
      );
      return raw;
    },
    session(raw) {
      if (!raw || raw.length > 200) return null;
      const row = db
        .prepare(
          "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
        )
        .get(digest(raw), Date.now());
      return row ? getUser(row.user_id) : null;
    },
    logout(raw) {
      if (raw)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(raw));
    },
    listProjects(userId) {
      return db
        .prepare(
          "SELECT p.*,u.name AS owner_name,CASE WHEN p.owner_id=? THEN 'owner' ELSE m.role END AS role FROM projects p JOIN users u ON u.id=p.owner_id LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=? WHERE p.owner_id=? OR m.user_id=? ORDER BY p.updated_at DESC",
        )
        .all(userId, userId, userId, userId);
    },
    createProject(name, ownerId) {
      const id = crypto.randomUUID(),
        now = new Date().toISOString();
      db.prepare("INSERT INTO projects VALUES(?,?,?,?,?)").run(
        id,
        name,
        ownerId,
        now,
        now,
      );
      return { ...project(id), role: "owner" };
    },
    shareProject(raw) {
      if (!raw || raw.length > 200) return null;
      const row = db
        .prepare("SELECT project_id FROM project_shares WHERE token_hash=?")
        .get(digest(raw));
      return row ? project(row.project_id) : null;
    },
    diagramAccess(id, user, share) {
      const d = db
        .prepare("SELECT project_id FROM diagrams WHERE id=?")
        .get(id);
      if (!d?.project_id) return null;
      const memberRole = role(d.project_id, user?.id);
      if (memberRole)
        return { role: memberRole, user, projectId: d.project_id };
      if (share && this.shareProject(share)?.id === d.project_id)
        return { role: "viewer", user: null, projectId: d.project_id };
      return null;
    },
  };
}
