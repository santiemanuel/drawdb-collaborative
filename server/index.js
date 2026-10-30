import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createDiagramStore, openDatabase } from "./database.js";
import { DIAGRAM_ID_PATTERN, isPlainObject } from "./protocol.js";
import { createAccessStore } from "./access.js";
import { createAuth, validateAuthConfig } from "./auth.js";
import { mountProjects } from "./projects.js";
import { attachCollaborationServer } from "./websocket.js";

/* global process */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_DOCUMENT_BYTES = "2mb";

export function createApplication({
  databasePath,
  authOptions,
  staticPath,
  backendUrl = process.env.VITE_BACKEND_URL || "",
  gistBackendUrl = process.env.VITE_GIST_BACKEND_URL || "",
} = {}) {
  validateAuthConfig(authOptions);
  const database = openDatabase(databasePath);
  const access = createAccessStore(database);
  const store = createDiagramStore(database);
  const auth = createAuth(access, authOptions);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: MAX_DOCUMENT_BYTES }));
  app.use((_req, res, next) => {
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  auth.routes(app);
  mountProjects(app, access, auth, store);

  app.get("/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res
      .type("application/javascript")
      .send(
        `window.__DRAWDB_CONFIG__ = ${JSON.stringify({ backendUrl, gistBackendUrl })};`,
      );
  });

  const validId = (req, res, next) => {
    if (!DIAGRAM_ID_PATTERN.test(req.params.id || "")) {
      res.status(400).json({ error: "Invalid diagram ID" });
      return;
    }
    next();
  };
  const validPayload = (body) =>
    isPlainObject(body) &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    body.name.length <= 200 &&
    isPlainObject(body.document);

  const diagramPermission =
    (write = false, owner = false) =>
    (req, res, next) => {
      const permission = access.diagramAccess(
        req.params.id,
        auth.userFor(req),
        typeof req.query.share === "string" ? req.query.share : null,
      );
      if (!permission)
        return res.status(404).json({ error: "Diagram not found" });
      if (
        (write && permission.role === "viewer") ||
        (owner && permission.role !== "owner")
      )
        return res
          .status(403)
          .json({ error: "Insufficient project permissions" });
      req.permission = permission;
      next();
    };
  app.get("/api/diagrams", auth.requireUser, (req, res) => {
    if (req.query.projectId) {
      const role = access.role(req.query.projectId, req.user.id);
      if (!role) return res.status(404).json({ error: "Project not found" });
      return res.json({
        diagrams: store.list(req.query.projectId).map((d) => ({ ...d, role })),
      });
    }
    res.json({
      diagrams: access
        .listProjects(req.user.id)
        .flatMap((p) => store.list(p.id).map((d) => ({ ...d, role: p.role }))),
    });
  });
  app.post("/api/diagrams", auth.csrf, auth.requireUser, (req, res, next) => {
    try {
      if (!validPayload(req.body)) {
        res
          .status(400)
          .json({ error: "A valid name and document are required" });
        return;
      }
      const role = access.role(req.body.projectId, req.user.id);
      if (!role) return res.status(404).json({ error: "Project not found" });
      if (role === "viewer")
        return res.status(403).json({ error: "Read-only project" });
      const requestedId = req.body.id;
      const id = requestedId ?? crypto.randomUUID();
      if (!DIAGRAM_ID_PATTERN.test(id)) {
        res.status(400).json({ error: "Invalid diagram ID" });
        return;
      }
      if (store.get(id)) {
        res.status(409).json({ error: "Diagram already exists" });
        return;
      }
      res.status(201).json(
        store.create({
          id,
          name: req.body.name,
          document: req.body.document,
          projectId: req.body.projectId,
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/diagrams/:id", validId, diagramPermission(), (req, res) => {
    const diagram = store.get(req.params.id);
    if (!diagram) res.status(404).json({ error: "Diagram not found" });
    else res.json({ ...diagram, role: req.permission.role });
  });
  app.put(
    "/api/diagrams/:id",
    auth.csrf,
    validId,
    diagramPermission(true),
    (req, res) => {
      if (!validPayload(req.body) || !Number.isInteger(req.body.baseVersion)) {
        res.status(400).json({
          error: "A valid name, document, and baseVersion are required",
        });
        return;
      }
      const result = store.updateSnapshot({
        id: req.params.id,
        name: req.body.name,
        document: req.body.document,
        baseVersion: req.body.baseVersion,
      });
      if (result.status === "not_found")
        res.status(404).json({ error: "Diagram not found" });
      else if (result.status === "conflict") {
        res
          .status(409)
          .json({ error: "Version conflict", diagram: result.diagram });
      } else res.json(result.diagram);
    },
  );
  app.delete(
    "/api/diagrams/:id",
    auth.csrf,
    validId,
    diagramPermission(true, true),
    (req, res) => {
      if (!store.delete(req.params.id))
        res.status(404).json({ error: "Diagram not found" });
      else res.status(204).end();
    },
  );

  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found" }),
  );
  const assets = staticPath || path.resolve(__dirname, "../dist");
  if (fs.existsSync(assets)) {
    app.use(express.static(assets));
    app.get("*splat", (_req, res) =>
      res.sendFile(path.join(assets, "index.html")),
    );
  }
  app.use((error, _req, res, next) => {
    void next;
    console.error("Request failed:", error.message);
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const server = http.createServer(app);
  const websocket = attachCollaborationServer(server, store, { access, auth });
  return { app, server, websocket, database, store, access, auth };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const { server } = createApplication();
  server.listen(port, "0.0.0.0", () => {
    console.log(`drawDB listening on http://0.0.0.0:${port}`);
  });
}
