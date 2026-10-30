<div align="center">
    <img width="64" alt="drawDB logo" src="./src/assets/icon-dark.png">
    <h1>drawDB Collaborative</h1>
</div>

<h3 align="center">A self-hosted, real-time collaborative database schema editor.</h3>

<div align="center" style="margin-bottom:12px;">
    <a href="https://github.com/yms2772/drawdb-collaborative" style="display: flex; align-items: center;">
        <img src="https://img.shields.io/badge/Source-GitHub-grey?logo=github" alt="Source code"/>
    </a>
    <a href="./LICENSE" style="display: flex; align-items: center;">
        <img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="AGPL-3.0 license"/>
    </a>
</div>

<h3 align="center"><img width="700" style="border-radius:5px;" alt="drawDB screenshot demo" src="drawdb.png"></h3>

drawDB Collaborative is an unofficial fork of
[drawDB](https://github.com/drawdb-io/drawdb). It adds centralized SQLite
storage and real-time WebSocket collaboration while retaining drawDB's
browser-based ERD editing and SQL import/export features.

This fork is independently maintained and is not affiliated with or endorsed
by the original drawDB maintainers.

Key additions include:

- Centralized diagram storage backed by SQLite
- Real-time table movement and editing between participants
- Participant presence and viewport-aware collaborative cursors
- Follow a participant's canvas position and zoom from the connected people list
- Optimistic version checks that prevent stale clients from overwriting changes
- A single-container setup for the frontend, API, WebSocket server, and storage

## Getting Started

### Local Development

```bash
git clone https://github.com/santiemanuel/drawdb-collaborative.git
cd drawdb-collaborative
npm install
npm run dev
```

This starts both the Vite frontend on port `5173` and the API/WebSocket server
on port `3000`. Use `npm run dev:client` or `npm run dev:server` when only one
side is needed.

### Build

```bash
git clone https://github.com/santiemanuel/drawdb-collaborative.git
cd drawdb-collaborative
npm install
npm run build
```

### Docker Build

```bash
docker compose up --build
```

Open `http://localhost:3000`. The single application container serves the
frontend, diagram API, WebSocket collaboration endpoint, and SQLite storage.
The Compose configuration persists the database in the `drawdb-data` volume.

### Accounts, projects, and collaboration

This fork stores diagrams centrally in SQLite and now scopes them to private
projects. Sign in with Google to see owned projects and projects shared with
your verified email. Owners manage invitations with editor/viewer roles and
can generate revocable public **read-only** links. Invitation links are copied
and sent manually; no email provider is required or silently used.

The application layer authenticates both REST requests and WebSocket sessions.
Editors retain realtime editing, participant presence, table locks, and
optimistic version checks. Viewers cannot save changes. Membership and link
revocation stop access to subsequent realtime updates as well as fresh requests.

**Upgrading an existing deployment:** old diagrams are preserved but not
assigned automatically. Back up the database, sign in as the intended owner,
and follow the explicit legacy recovery procedure. An empty dashboard does not
mean historical records were deleted.

Read the [implementation plan](docs/PROJECTS_IMPLEMENTATION_PLAN.md) and
[Dokploy rollout and recovery guide](docs/DOKPLOY_ACCOUNTS_ROLLOUT.md) before
publishing. Production uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`APP_URL=https://erd.code-hello.com`, and the persistent `/data` volume.
The Google callback is `/auth/google/callback`. Credentials are server-only.
Missing OAuth configuration never opens protected APIs.

Keep any existing external Google/Cloudflare access restriction in place.
Anonymous shared links require the external gateway to permit their narrowly
scoped read-only routes; the application does not change that gateway itself.

For local development, copy `.env.sample` settings into your process environment
(or your environment manager). Set `APP_URL` to the browser's exact origin,
usually `http://localhost:5173` when using Vite. The development server proxies
`/auth`, `/api`, and `/ws` to the Node server. Do not use production secrets in
a development environment.

`DATABASE_PATH` defaults to `./data/drawdb.sqlite` outside Docker. The Compose
configuration mounts the named volume at `/data`. Run one application replica
against this local SQLite store; shared multi-replica state is not implemented.
Forward WebSocket upgrade headers and the normal HTTPS proxy headers. Public
non-secret optional upstream URLs can still be set through `VITE_BACKEND_URL`
and `VITE_GIST_BACKEND_URL`; `/config.js` never includes OAuth secrets.

### Verification

```bash
npm run check:server
npm run test:server
npm run test:import
npm run test:collaboration
npm run lint
npm run build
```

Tests include identity/session handling, REST role enforcement, invitation
binding, public-link revocation, realtime access changes, document preservation,
and collaboration version/lock regressions. Live Google sign-in, gateway rules,
and Dokploy persistence still require deployment checks.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License and source availability

This project is distributed under the
[GNU Affero General Public License v3.0](LICENSE). It is based on
[drawDB](https://github.com/drawdb-io/drawdb), which is also distributed under
the GNU AGPL v3.0.

If you interact with a deployed, modified version of this application over a
network, you are entitled to receive the Corresponding Source for that version
under section 13 of the GNU AGPL. The source for this version is available at:

https://github.com/santiemanuel/drawdb-collaborative

Copyright and attribution notices from the original project are retained. See
the repository history for changes made by this fork.

## Upstream project

- Collaborative upstream: [yms2772/drawdb-collaborative](https://github.com/yms2772/drawdb-collaborative)
- Original source: [drawdb-io/drawdb](https://github.com/drawdb-io/drawdb)
- Original project website: [drawdb.app](https://drawdb.app/)
- Upstream community: [Discord](https://discord.gg/BrjZgNrmR6)
