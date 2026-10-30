# Accounts, projects, and sharing implementation plan

## Current baseline

The deployed fork already uses Express, SQLite, and WebSocket collaboration. Diagrams are stored on the server, but the API currently exposes one anonymous, global collection. The missing layer is durable identity, ownership, scoped discovery, and authorization, rather than a replacement storage engine.

## Intended architecture

Keep the single-container deployment and existing diagram/version protocol. Add application-managed Google OpenID Connect login and database-backed opaque sessions. Only request basic identity scopes (openid, email, profile); never place the Google client secret in frontend code, public runtime configuration, logs, or Git.

Add users, sessions, projects, memberships, pending invitations, and revocable public links to the existing SQLite database. Projects contain diagrams. Owners manage members and public links; editors change diagrams; viewers read. Authorization applies to every HTTP endpoint and WebSocket connection/message, including existing routes. Client-side controls improve usability but are not the security boundary.

A dashboard lists owned and shared projects after login on any device. Anonymous recipients can read explicitly shared projects using revocable capability links. Invitation creation records an email-bound pending membership and provides a link for the owner to copy; the application does not send email without a configured delivery provider. Invitations take effect only after a verified Google identity matches the invited address.

## Delivery sequence

1. **Persistence and identity:** additive schema changes, Google login/session lifecycle, project/member/invitation/public-link API, and authorization tests.
2. **Integrated experience:** own/shared project dashboard, project diagram management, identity display, invitations, owner sharing controls, and read-only public viewing. Keep the existing editor visual language.
3. **Verification and rollout:** regression tests for storage/version conflicts and collaboration; access-control tests for outsiders/viewers/editors/owners; build/lint; local browser checks; deployment and recovery documentation. Create focused commits and only publish reviewed, coherent milestones.

## Migration and safety

Preserve existing diagram records and documents. Existing unowned diagrams must not become visible to arbitrary accounts or be claimed by the first person to sign in. Use an explicit administrator migration command after backup to assign legacy diagrams to a verified owner/project. Do not delete browser data or production records during migration or tests.

Use the existing persistent /data volume. Back up the SQLite database consistently, including its WAL state, before rollout; maintain a restore path. Database changes are additive, but restoring old unauthenticated code would reopen the former API and is not a security-safe rollback by itself.

The existing external Google access restriction remains in place. Its exact enforcement layer is unverified. Application login does not authorize removing or widening that gate. If the gate blocks anonymous requests, public links require a separately approved gateway rule for the documented public read-only routes; do not change it implicitly.

## Runtime configuration

The existing Dokploy variables are GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. APP_URL should be https://erd.code-hello.com, with the exact Google redirect URI https://erd.code-hello.com/auth/google/callback registered by an authorized administrator. Secrets remain runtime-only. The implemented code and deployment guide will specify any additional non-secret configuration and validation.

## Acceptance criteria

- A verified user sees only projects they own or have been invited to.
- Projects and diagrams persist across sessions, devices, and process restarts.
- Editor/viewer restrictions are enforced by the backend over REST and WebSockets.
- Revocation removes both future writes and subsequent reads/realtime deliveries.
- Anonymous access works only through an active, unguessable read-only link.
- Legacy data is preserved without automatic disclosure or ownership assignment.
- OAuth cancellation, state mismatch, expired sessions, save conflicts, denied access, and network failure have safe outcomes.
- Final reports distinguish local automated verification from live OAuth/deployment checks, which may require the owner's browser behind the existing gateway.
