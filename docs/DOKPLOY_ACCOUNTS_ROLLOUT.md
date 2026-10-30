# Dokploy rollout: Google identity and private projects

## Before deploying

This release changes anonymous global diagrams into private project-scoped records. When an existing on-disk database lacks the project column, startup first creates a consistent `*.before-projects-<timestamp>-<uuid>.sqlite` snapshot beside it and verifies SQLite integrity. A backup failure aborts migration. This one-time local safeguard does not replace an off-volume backup. Existing records are preserved, but deliberately hidden until an administrator assigns them. An initially empty dashboard does **not** mean the diagrams were deleted.

1. Keep the existing persistent `/data` volume attached to the same service. Do not create a replacement volume or reset the database.
2. Take a consistent SQLite backup before deployment. Use SQLite's online backup API, not a copy of a live `.sqlite` file alone (WAL transactions may be separate). The new image provides `node scripts/backup-database.js /data/backups/before-projects.sqlite`; for the old image use its installed `better-sqlite3` backup API or stop writes and back up the complete volume. Copy the backup off the service volume through your normal authorized backup workflow.
3. Retain the current Git commit/image reference and backup together. The schema additions preserve old documents. Do not blindly roll back to the former anonymous API, because that would reopen global access. Prefer a fix-forward or maintenance mode while restoring.
4. Configure the runtime environment below. This guide does not authorize changes to Google Console, Cloudflare, gateway policies, or credentials.

## Runtime environment

- `GOOGLE_CLIENT_ID`: existing Google OAuth client ID.
- `GOOGLE_CLIENT_SECRET`: existing Google OAuth client secret, server only.
- `APP_URL`: `https://erd.code-hello.com` (no path). Production startup refuses a missing or non-HTTPS URL rather than creating insecure cookies or using a localhost callback.
- `GOOGLE_ALLOWED_EMAILS`: optional comma-separated, exact allowed email addresses for an additional application-level restriction. An empty value does not remove or change the external gate; do not infer its current list.
- `DATABASE_PATH`: `/data/drawdb.sqlite`.
- `PORT`: `3000`.

The Compose file forwards the OAuth variables at **runtime**. For Dokploy Dockerfile deployments, add the variables to the running service environment. Never add a `VITE_` prefix to the secret, bake it into build arguments, or commit its value. No additional session-signing secret is required: session cookies contain random tokens whose hashes are stored in SQLite.

The exact authorized redirect URI in Google Console must be:

`https://erd.code-hello.com/auth/google/callback`

The application requests only `openid email profile`. It uses a server-side authorization-code flow with PKCE and single-use state. The Google access token is used transiently for verified identity and is not retained. The app stores the user's subject ID, verified email, name and optional profile image URL.

If either Google variable is missing, login is unavailable; protected APIs remain closed. Do not use production secrets for local tests. For local login use a separately configured development OAuth client and matching `APP_URL`, usually `http://localhost:5173` with Vite's `/auth` and `/api` proxy.

## Existing Google access restriction and public viewing

Preserve the current restricted Google user list and any existing Cloudflare/access gateway. Whether that restriction comes from Google's OAuth test-user list, an external gateway, or both must be verified by the operator. A Google OAuth test-user list is not a replacement for application authorization or an arbitrary production-domain allowlist.

The application deliberately supports anonymous **read-only** links at `/shared/:token`, with read-only data requests under `/api/public/:token`, `/api/diagrams/:id?share=TOKEN`, and `/ws/diagrams/:id?share=TOKEN`. Static assets must also load. The server validates the capability on every request and realtime delivery; knowledge of a diagram ID alone is not access.

An external gate that requires Google login on every route will also block these anonymous links. Do not widen that gate automatically. Have its administrator approve a narrowly scoped configuration and test it in a logged-out browser. Never exempt the entire `/api` or `/ws` tree merely to make a public link work.

Public links are bearer capabilities: anyone possessing one can view that project's diagrams. Owners generate and revoke them explicitly. Do not include confidential data in a public project. Revocation cannot retract files or screenshots already downloaded by recipients.

## Recover existing diagrams

After a verified intended owner has signed in at least once, an authorized administrator can run inside the container:

`node scripts/claim-legacy-diagrams.js owner@example.com "Recovered diagrams" --confirm-backup`

This assigns **all currently unowned legacy diagrams** to a new private project. It does not delete documents and is safe to rerun: once no legacy diagrams remain, it makes no changes. The command refuses unknown or ambiguous owners. Confirm the correct owner and backup before running; do not assign historical team diagrams to an arbitrary first login. If different diagrams have different owners, do not use the all-record command; plan a selective migration instead.

The claim tool is not an HTTP endpoint and cannot be invoked by an ordinary user. Browser-local original exports, if any, remain untouched; use the editor's existing import workflow to add them to an authorized project.

## Invitations and roles

Owners create an invitation for a verified email and either `viewer` or `editor`. The UI provides a copyable acceptance URL. No SMTP provider is configured and the application does **not** email the recipient automatically. The owner sends the link through their preferred channel. On Google login, matching unexpired pending invitations become memberships. Existing signed-in users can follow the invitation link or sign in again to refresh membership.

Owners manage membership and public links. Editors can edit project diagrams. Viewers and anonymous link recipients cannot save document changes or acquire edit locks. Membership and public-link revocation are checked by the server, not merely by disabled controls.

## Verification after deployment

- Confirm the expected commit/image deployed and persistent volume remained mounted.
- Sign in as an allowed owner; verify displayed identity and create a non-sensitive test project.
- Open the project in a second browser/device using the same account and confirm its diagram persists.
- Invite two designated test accounts as editor and viewer; verify each sees shared projects and that viewer edits are denied.
- Verify a non-member cannot read by guessing a project/diagram URL.
- Generate a public link, test logged out, revoke it, and confirm both fresh requests and existing realtime viewers lose access.
- Remove a member while they have an editor open; ensure subsequent operations and updates stop.
- Log out and verify authenticated APIs no longer work.
- Restore test state only through approved, recoverable operations. Do not test by modifying real team diagrams.

Local automated checks do not prove the live Google Console callback, gateway routing, or Dokploy volume configuration. Record those checks separately.
