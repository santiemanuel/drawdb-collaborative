import crypto from "node:crypto";
import fs from "node:fs";
import { digest, token } from "./access.js";

/* global process */
export function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
}
const MAX_ALLOWLIST_BYTES = 1024 * 1024;
function readAllowedEmailsFile(filename) {
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_ALLOWLIST_BYTES)
      throw new Error("expected a regular file no larger than 1 MiB");
    // Bounded reads keep a malformed/replaced mount from consuming arbitrary memory.
    const bytes = new Uint8Array(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length > stat.size)
      throw new Error(
        "file changed while being read; retry with the complete file",
      );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
    const entries = text
      .split(/\r?\n/)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value && !value.startsWith("#"));
    if (!entries.length)
      throw new Error("file contains no allowed email addresses");
    if (
      entries.some(
        (value) =>
          /[*,'"]/.test(value) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      )
    )
      throw new Error(
        "each nonblank line must contain one exact email address; wildcards are not supported",
      );
    return new Set(entries);
  } catch (error) {
    throw new Error(
      `GOOGLE_ALLOWED_EMAILS_FILE cannot be loaded safely: ${error.message}`,
    );
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
export function createEmailPolicy(options = {}) {
  const inline = (
    options.allowedEmails ??
    process.env.GOOGLE_ALLOWED_EMAILS ??
    ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const rawFile =
    options.allowedEmailsFile ?? process.env.GOOGLE_ALLOWED_EMAILS_FILE;
  const filename = rawFile ? rawFile.trim() : null;
  if (rawFile && !filename)
    throw new Error(
      "GOOGLE_ALLOWED_EMAILS_FILE must name a readable nonempty allowlist file.",
    );
  // Validate configured mounts at startup, before database migrations or listening.
  if (filename) readAllowedEmailsFile(filename);
  return (email) => {
    const normalized =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalized || (inline.length && !inline.includes(normalized)))
      return false;
    if (!filename) return true;
    // No stale authorization cache: removals/replacements affect REST and existing
    // WebSocket sessions on their next permission check. Only read this small file.
    try {
      return readAllowedEmailsFile(filename).has(normalized);
    } catch {
      return false;
    }
  };
}
export function validateAuthConfig(options = {}) {
  const configured = options.appUrl ?? process.env.APP_URL;
  const production = (options.nodeEnv ?? process.env.NODE_ENV) === "production";
  if (production && !configured)
    throw new Error(
      "APP_URL is required in production. Set it to the public HTTPS origin, for example https://erd.code-hello.com.",
    );
  let parsed;
  try {
    parsed = new URL(configured || "http://localhost:3000");
  } catch {
    throw new Error("APP_URL must be a valid absolute HTTP(S) origin.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error(
      "APP_URL must contain only the public HTTP(S) origin, without credentials, path, query, or fragment.",
    );
  if (production && parsed.protocol !== "https:")
    throw new Error(
      "APP_URL must use HTTPS in production so session cookies and Google OAuth remain secure.",
    );
  createEmailPolicy(options);
  return parsed.origin;
}
export function createAuth(access, options = {}) {
  const origin = validateAuthConfig(options);
  const secure = origin.startsWith("https:");
  const emailAllowed = createEmailPolicy(options);
  const clientId = options.googleClientId ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    options.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
  const fetchImpl = options.fetchImpl || fetch;
  const loginEnabled = !!(clientId && clientSecret);
  const callback = `${origin}/auth/google/callback`;
  const setCookie = (res, name, value, maxAge) =>
    res.cookie(name, value, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge,
    });
  const userFor = (req) => {
    const raw = cookies(req).drawdb_session;
    const user = access.session(raw);
    if (user && !emailAllowed(user.email)) {
      access.logout(raw);
      return null;
    }
    return user;
  };
  const sameOrigin = (req) => req.headers.origin === origin;
  const csrf = (req, res, next) => {
    if (!sameOrigin(req))
      return res.status(403).json({ error: "Request origin is not allowed" });
    next();
  };
  const requireUser = (req, res, next) => {
    req.user = userFor(req);
    if (!req.user)
      return res.status(401).json({ error: "Sign in to continue" });
    next();
  };
  const attempts = new Map();
  const rateLimit = (req, res, next) => {
    const now = Date.now(),
      key = req.ip;
    for (const [ip, entry] of attempts)
      if (entry.until < now) attempts.delete(ip);
    const entry = attempts.get(key) || { count: 0, until: now + 60000 };
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > 20 || attempts.size > 10000)
      return res
        .status(429)
        .send("Too many sign-in attempts. Please retry later.");
    next();
  };
  function routes(app) {
    app.use("/api", (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    });
    app.get("/api/auth/me", (req, res) =>
      res.json({ user: userFor(req), loginEnabled }),
    );
    app.post("/api/auth/logout", csrf, (req, res) => {
      access.logout(cookies(req).drawdb_session);
      setCookie(res, "drawdb_session", "", 0);
      res.status(204).end();
    });
    app.get("/auth/google", rateLimit, (req, res) => {
      if (!loginEnabled)
        return res.status(503).send("Google sign-in is not configured");
      const state = token(),
        verifier = token();
      let returnTo =
        typeof req.query.returnTo === "string"
          ? req.query.returnTo
          : "/projects";
      if (
        !/^\/(projects|diagrams|shared|invitations)(\/|\?|$)/.test(returnTo) ||
        returnTo.includes("\\") ||
        returnTo.length > 1000
      )
        returnTo = "/projects";
      access.db
        .prepare("DELETE FROM oauth_states WHERE expires_at<=?")
        .run(Date.now());
      access.db
        .prepare("INSERT INTO oauth_states VALUES(?,?,?,?)")
        .run(digest(state), verifier, returnTo, Date.now() + 600000);
      setCookie(res, "drawdb_oauth_state", state, 600000);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callback,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: crypto
          .createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      res.redirect(url.toString());
    });
    app.get("/auth/google/callback", rateLimit, async (req, res) => {
      res.set("Cache-Control", "no-store");
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const saved =
        state &&
        access.db
          .prepare(
            "SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>?",
          )
          .get(digest(state), Date.now());
      if (
        !saved ||
        !cookies(req).drawdb_oauth_state ||
        state !== cookies(req).drawdb_oauth_state
      )
        return res
          .status(400)
          .send("Invalid or expired sign-in. Please try again.");
      access.db
        .prepare("DELETE FROM oauth_states WHERE state_hash=?")
        .run(digest(state));
      setCookie(res, "drawdb_oauth_state", "", 0);
      if (req.query.error || typeof req.query.code !== "string")
        return res.redirect("/projects?authError=cancelled");
      try {
        const response = await fetchImpl(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code: req.query.code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: callback,
              grant_type: "authorization_code",
              code_verifier: saved.verifier,
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        const data = await response.json();
        if (!response.ok || typeof data.access_token !== "string")
          throw new Error("Token exchange failed");
        const profileResponse = await fetchImpl(
          "https://openidconnect.googleapis.com/v1/userinfo",
          {
            headers: { Authorization: `Bearer ${data.access_token}` },
            signal: AbortSignal.timeout(15000),
          },
        );
        const profile = await profileResponse.json();
        if (
          !profileResponse.ok ||
          profile.email_verified !== true ||
          typeof profile.sub !== "string" ||
          typeof profile.email !== "string" ||
          typeof profile.name !== "string"
        )
          throw new Error("Verified Google identity required");
        if (!emailAllowed(profile.email))
          return res.redirect("/projects?authError=not_allowed");
        const user = access.upsertGoogle(profile);
        access.logout(cookies(req).drawdb_session);
        setCookie(
          res,
          "drawdb_session",
          access.createSession(user.id),
          7 * 86400000,
        );
        res.redirect(saved.return_to);
      } catch {
        res.redirect("/projects?authError=failed");
      }
    });
  }
  return {
    routes,
    userFor,
    requireUser,
    csrf,
    sameOrigin,
    origin,
    loginEnabled,
  };
}
