# Verification record

## Local automated verification

The implementation was checked with Node 24 in a fresh cloud checkout using the repository lockfile. The Docker image remains based on Node 22; GitHub's workflow checks Node 20 and 22 after publication.

- Server syntax checks.
- Server tests: project role boundaries, legacy data isolation, verified identity invitations, session expiry/logout, OAuth state/PKCE and unverified-email rejection, HTTPS cookies, REST and WebSocket public-link revocation, role changes and stale-invitation cancellation.
- Migration tests: consistent backup of the original schema, explicit owner requirement, document/version preservation and idempotent recovery.
- Existing server persistence/version/lock/camera regressions.
- SQL import compatibility tests.
- Collaboration drag-lock/viewport tests.
- Whole-repository ESLint, with zero warnings allowed.
- Production Vite build.

The build completes with inherited dependency/module and bundle-size warnings; those are not evidence of a tested browser experience.

## Checks not completed

Local browser automation was attempted against a synthetic localhost-only test server, without real Google accounts or production data. Chromium failed before opening a page because the execution sandbox denied its local process socket. A narrowly scoped escalated launch failed during environment setup with a read-only filesystem error. No browser assertions or screenshots were produced. The failed launch was not bypassed.

Google OAuth was tested with mocked provider responses, not with the production Google client. The exact registered redirect URI, environment variable injection, existing external access gate, and persisted Dokploy volume still require operator verification. Public anonymous viewing also depends on the gateway permitting those read-only requests. No gateway, Google Console, credentials, or production database settings were changed during implementation.

## Required live acceptance pass

Use the checklist in [Dokploy rollout](DOKPLOY_ACCOUNTS_ROLLOUT.md). In particular, test two real accounts, viewer restrictions, cross-device persistence, public link access logged out, revocation in an already open tab, and the deployed commit. Do not represent a successful Git push as proof of deployment or live OAuth success.

## Deployment configuration follow-up

The first operator-supplied Dokploy build log passed all 32 then-current tests on Node 22 and built successfully; runtime logs separately showed missing `APP_URL`. The supplied effective Compose forwarded Google credentials only to the old OAuth proxy, and its healthcheck called the now-private `/api/diagrams`. The repository now provides `/healthz` without private data and a deployment-specific Compose example using the application login and the same mounted email allowlist, following explicit approval to replace the proxy. The image healthcheck does not override a Compose healthcheck.

Additional automated regressions cover anonymous health readiness with private APIs remaining 401, exact-address file parsing, fail-closed startup/runtime file errors, intersection with inline allowlists, outsider OAuth denial, existing session revocation and active WebSocket closure when an address is removed. The Compose example is YAML-parsed; Docker is unavailable locally, so Compose engine validation and actual rollout remain operator checks. No live Google sign-in has been claimed.
