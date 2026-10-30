import crypto from "node:crypto";
import { digest, normalizeEmail, token } from "./access.js";

const validName = (name) =>
  typeof name === "string" && name.trim().length > 0 && name.length <= 200;
const validRole = (role) => ["viewer", "editor"].includes(role);
export function mountProjects(app, access, auth, store) {
  const db = access.db;
  const permission =
    (owner = false) =>
    (req, res, next) => {
      const role = access.role(req.params.projectId, req.user.id);
      if (!role) return res.status(404).json({ error: "Project not found" });
      if (owner && role !== "owner")
        return res
          .status(403)
          .json({ error: "Only the owner can manage this project" });
      req.projectRole = role;
      next();
    };
  const read = [auth.requireUser, permission()];
  const manage = [auth.csrf, auth.requireUser, permission(true)];
  const ownerRead = [auth.requireUser, permission(true)];
  app.get("/api/projects", auth.requireUser, (req, res) =>
    res.json({ projects: access.listProjects(req.user.id) }),
  );
  app.post("/api/projects", auth.csrf, auth.requireUser, (req, res) => {
    if (!validName(req.body.name))
      return res
        .status(400)
        .json({ error: "A valid project name is required" });
    res
      .status(201)
      .json(access.createProject(req.body.name.trim(), req.user.id));
  });
  app.get("/api/projects/:projectId", ...read, (req, res) =>
    res.json({
      project: {
        ...access.project(req.params.projectId),
        role: req.projectRole,
      },
      diagrams: store.list(req.params.projectId),
    }),
  );
  app.patch("/api/projects/:projectId", ...manage, (req, res) => {
    if (!validName(req.body.name))
      return res
        .status(400)
        .json({ error: "A valid project name is required" });
    db.prepare("UPDATE projects SET name=?,updated_at=? WHERE id=?").run(
      req.body.name.trim(),
      new Date().toISOString(),
      req.params.projectId,
    );
    res.json({ ...access.project(req.params.projectId), role: "owner" });
  });
  app.delete("/api/projects/:projectId", ...manage, (req, res) => {
    if (store.list(req.params.projectId).length)
      return res
        .status(409)
        .json({ error: "Remove the project's diagrams before deleting it" });
    db.prepare("DELETE FROM projects WHERE id=?").run(req.params.projectId);
    res.status(204).end();
  });
  app.get("/api/projects/:projectId/members", ...ownerRead, (req, res) =>
    res.json({
      members: db
        .prepare(
          "SELECT u.id,u.name,u.email,m.role FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?",
        )
        .all(req.params.projectId),
    }),
  );
  app.patch(
    "/api/projects/:projectId/members/:userId",
    ...manage,
    (req, res) => {
      if (!validRole(req.body.role))
        return res.status(400).json({ error: "Invalid role" });
      const result = db
        .prepare(
          "UPDATE project_members SET role=? WHERE project_id=? AND user_id=?",
        )
        .run(req.body.role, req.params.projectId, req.params.userId);
      if (!result.changes)
        return res.status(404).json({ error: "Member not found" });
      db.prepare(
        "DELETE FROM project_invitations WHERE project_id=? AND email=(SELECT email FROM users WHERE id=?)",
      ).run(req.params.projectId, req.params.userId);
      db.prepare(
        "DELETE FROM project_email_grants WHERE project_id=? AND email=(SELECT email FROM users WHERE id=?)",
      ).run(req.params.projectId, req.params.userId);
      res.status(204).end();
    },
  );
  app.delete(
    "/api/projects/:projectId/members/:userId",
    ...manage,
    (req, res) => {
      db.prepare(
        "DELETE FROM project_members WHERE project_id=? AND user_id=?",
      ).run(req.params.projectId, req.params.userId);
      db.prepare(
        "DELETE FROM project_invitations WHERE project_id=? AND email=(SELECT email FROM users WHERE id=?)",
      ).run(req.params.projectId, req.params.userId);
      db.prepare(
        "DELETE FROM project_email_grants WHERE project_id=? AND email=(SELECT email FROM users WHERE id=?)",
      ).run(req.params.projectId, req.params.userId);
      res.status(204).end();
    },
  );
  app.get("/api/projects/:projectId/invitations", ...ownerRead, (req, res) =>
    res.json({
      invitations: db
        .prepare(
          `
        SELECT id,email,role,expires_at,created_at FROM project_invitations WHERE project_id=? AND expires_at>?
        UNION ALL SELECT id,email,role,NULL AS expires_at,created_at FROM project_email_grants WHERE project_id=?
      `,
        )
        .all(req.params.projectId, Date.now(), req.params.projectId),
    }),
  );
  // Authorize every recipient before writing anything: malformed bulk requests
  // and ambiguous historical identities cannot leave a partially shared project.
  app.post("/api/projects/:projectId/access", ...manage, (req, res) => {
    const input = req.body.emails;
    if (
      !Array.isArray(input) ||
      input.length < 1 ||
      input.length > 100 ||
      !validRole(req.body.role) ||
      input.some(
        (email) =>
          typeof email !== "string" ||
          email.trim().length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),
      )
    )
      return res.status(400).json({
        error:
          "Ingresá entre 1 y 100 correos válidos y un permiso de lectura o edición.",
      });
    const emails = [...new Set(input.map(normalizeEmail))];
    if (emails.includes(req.user.email))
      return res.status(400).json({
        error: "El propietario ya tiene acceso y no puede cambiar su permiso.",
      });
    const recipients = emails.map((email) => ({
      email,
      users: db.prepare("SELECT id FROM users WHERE email=?").all(email),
    }));
    if (recipients.some(({ users }) => users.length > 1))
      return res.status(409).json({
        error:
          "Un correo corresponde a más de una identidad. No se modificó ningún permiso; contactá al administrador.",
      });
    const grants = db.transaction(() =>
      recipients.map(({ email, users }) => {
        db.prepare(
          "DELETE FROM project_invitations WHERE project_id=? AND email=?",
        ).run(req.params.projectId, email);
        db.prepare(
          "DELETE FROM project_email_grants WHERE project_id=? AND email=?",
        ).run(req.params.projectId, email);
        if (users.length) {
          db.prepare(
            "INSERT INTO project_members VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role",
          ).run(req.params.projectId, users[0].id, req.body.role);
        } else {
          db.prepare("INSERT INTO project_email_grants VALUES(?,?,?,?,?)").run(
            crypto.randomUUID(),
            req.params.projectId,
            email,
            req.body.role,
            new Date().toISOString(),
          );
        }
        return {
          email,
          role: req.body.role,
          status: users.length ? "active" : "awaiting_login",
        };
      }),
    )();
    res.status(201).json({
      grants,
      projectId: req.params.projectId,
      projectUrl: `${auth.origin}/projects/${req.params.projectId}`,
    });
  });
  app.patch(
    "/api/projects/:projectId/invitations/:invitationId",
    ...manage,
    (req, res) => {
      if (!validRole(req.body.role))
        return res.status(400).json({ error: "Invalid role" });
      const changes = db.transaction(() => {
        const pending = db
          .prepare(
            "UPDATE project_email_grants SET role=? WHERE project_id=? AND id=?",
          )
          .run(req.body.role, req.params.projectId, req.params.invitationId);
        const legacy = db
          .prepare(
            "UPDATE project_invitations SET role=? WHERE project_id=? AND id=? AND expires_at>?",
          )
          .run(
            req.body.role,
            req.params.projectId,
            req.params.invitationId,
            Date.now(),
          );
        return pending.changes + legacy.changes;
      })();
      if (!changes)
        return res.status(404).json({ error: "Pending access not found" });
      res.status(204).end();
    },
  );
  app.post("/api/projects/:projectId/invitations", ...manage, (req, res) => {
    if (
      typeof req.body.email !== "string" ||
      req.body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email) ||
      !validRole(req.body.role)
    )
      return res
        .status(400)
        .json({ error: "A valid email and viewer/editor role are required" });
    const email = normalizeEmail(req.body.email);
    if (email === req.user.email)
      return res.status(400).json({ error: "You already own this project" });
    db.prepare(
      "DELETE FROM project_email_grants WHERE project_id=? AND email=?",
    ).run(req.params.projectId, email);
    const raw = token(),
      id = crypto.randomUUID(),
      expires = Date.now() + 7 * 86400000,
      now = new Date().toISOString();
    db.prepare(
      "INSERT INTO project_invitations VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,email) DO UPDATE SET id=excluded.id,role=excluded.role,token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=excluded.created_at",
    ).run(
      id,
      req.params.projectId,
      email,
      req.body.role,
      digest(raw),
      expires,
      now,
    );
    res.status(201).json({
      invitation: { id, email, role: req.body.role, expires_at: expires },
      acceptUrl: `${auth.origin}/invitations/${raw}`,
    });
  });
  app.delete(
    "/api/projects/:projectId/invitations/:invitationId",
    ...manage,
    (req, res) => {
      const changes = db.transaction(() => {
        const legacy = db
          .prepare(
            "DELETE FROM project_invitations WHERE project_id=? AND id=?",
          )
          .run(req.params.projectId, req.params.invitationId);
        const pending = db
          .prepare(
            "DELETE FROM project_email_grants WHERE project_id=? AND id=?",
          )
          .run(req.params.projectId, req.params.invitationId);
        return legacy.changes + pending.changes;
      })();
      if (!changes)
        return res.status(404).json({
          error:
            "El acceso pendiente cambió. Revisá la lista actualizada de personas con acceso antes de revocarlo.",
        });
      res.status(204).end();
    },
  );
  app.get("/api/projects/:projectId/share", ...ownerRead, (req, res) =>
    res.json({
      enabled: !!db
        .prepare("SELECT 1 FROM project_shares WHERE project_id=?")
        .get(req.params.projectId),
    }),
  );
  app.post("/api/projects/:projectId/share", ...manage, (req, res) => {
    const raw = token();
    db.prepare(
      "INSERT INTO project_shares VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at",
    ).run(req.params.projectId, digest(raw), new Date().toISOString());
    res.status(201).json({ token: raw, url: `${auth.origin}/shared/${raw}` });
  });
  app.delete("/api/projects/:projectId/share", ...manage, (req, res) => {
    db.prepare("DELETE FROM project_shares WHERE project_id=?").run(
      req.params.projectId,
    );
    res.status(204).end();
  });
  app.post(
    "/api/invitations/:token/accept",
    auth.csrf,
    auth.requireUser,
    (req, res) => {
      if (req.params.token.length > 200)
        return res.status(404).json({ error: "Invitation not found" });
      const invitation = db
        .prepare(
          "SELECT * FROM project_invitations WHERE token_hash=? AND email=? AND expires_at>?",
        )
        .get(digest(req.params.token), req.user.email, Date.now());
      if (!invitation)
        return res.status(404).json({
          error:
            "Invitation expired, already accepted, or belongs to another email",
        });
      db.transaction(() => {
        if (access.project(invitation.project_id)?.owner_id !== req.user.id)
          db.prepare(
            "INSERT INTO project_members VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role",
          ).run(invitation.project_id, req.user.id, invitation.role);
        db.prepare("DELETE FROM project_invitations WHERE id=?").run(
          invitation.id,
        );
      })();
      res.json({ projectId: invitation.project_id });
    },
  );
  app.get("/api/public/:token", (req, res) => {
    const project = access.shareProject(req.params.token);
    if (!project)
      return res
        .status(404)
        .json({ error: "This link is invalid or has been revoked" });
    res.json({
      project: { id: project.id, name: project.name, role: "viewer" },
      diagrams: store.list(project.id),
    });
  });
}
