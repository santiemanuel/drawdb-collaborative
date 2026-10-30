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

### Collaborative self-hosting

Diagrams are stored centrally in SQLite; IndexedDB is not used for diagram
storage. `DATABASE_PATH` controls the database location and defaults to
`./data/drawdb.sqlite` outside the container. Diagram URLs use
`/diagrams/:diagramId`, and everyone opening the same URL joins the same live
session automatically.

Open the participant count in the top-right corner of a saved diagram and select
**Follow** next to another participant. Your canvas follows their center position
and zoom, including their current view when you first join. Choose **Stop
following**, press **Escape**, or pan/zoom locally to take control again. Following
ends when the participant disconnects; mutual or indirect follow loops are
prevented. Camera awareness is transient and does not save a new diagram version.

The application exposes:

- `GET|POST /api/diagrams`
- `GET|PUT|DELETE /api/diagrams/:diagramId`
- `/ws/diagrams/:diagramId` (WebSocket)

Snapshot saves are debounced and guarded by an optimistic version. Stale
clients receive the current snapshot instead of silently overwriting it.
Reconnects send the last known version and converge on the server snapshot.

When running behind a reverse proxy, forward `X-Forwarded-For` and
`X-Forwarded-Proto`, and allow WebSocket `Upgrade`/`Connection` headers on the
`/ws` path. The browser derives `ws://` or `wss://` from the current origin, so
no public hostname or `localhost` value is required in production.

The collaborative API and WebSocket endpoint use the current origin automatically.
For optional upstream backend services, set `VITE_BACKEND_URL` and, if needed,
`VITE_GIST_BACKEND_URL` when starting the container. The Node server exposes
these public settings through `/config.js` with caching disabled, so changing
them does not require rebuilding the image:

```bash
docker build -t drawdb-collaborative .
docker run -p 3000:3000 -v drawdb-data:/data \
  -e VITE_BACKEND_URL=https://your-drawdb-server.example.com drawdb-collaborative
```

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
