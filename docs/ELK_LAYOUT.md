# ELK layered automatic layout

## Plan and integration contract

1. Replace the old Dagre layout and aspect-ratio compression with deterministic ELK Layered, using real table dimensions and field-level ports.
2. Keep pinned tables fixed. Lay out movable nodes without overlapping fixed tables, notes or views. Subject areas remain intentional background containers; automatic layout does not resize or move them.
3. Consume orthogonal ELK bendpoints in the SVG relationship renderer, including composite field pairs. Persist routes with the normal diagram document, without changing its permissions or storage model.
4. Invalidate routes using a scene-wide geometry signature. Moving any table/obstacle, changing dimensions, visible fields or relationships makes the renderer use its normal live routing until the next automatic arrangement.
5. Treat the asynchronous result as a transaction: discard stale results, acquire collaboration leases before applying, and keep positions and routes together in undo/redo. Keep leases until the existing snapshot save succeeds or fails.
6. Verify pure geometry/routing tests, existing regressions, lint and production build. Desktop visual QA uses synthetic diagrams, never production credentials or data.

## Behavior and boundaries

- ELK optimizes layered placement and orthogonal routing; it does not promise zero crossings for arbitrary graphs.
- Fixed tables and unrelated objects are not relocated. Hidden tables are not rearranged.
- Route metadata is optional and versioned; older documents need no migration. Invalid or stale imported metadata falls back safely to the live relationship renderer.
- The diagram is not modified while ELK computes. Concurrent geometry edits, navigation, or a read-only transition discard the pending result. Repeated arrange requests are suppressed.
- Undo/redo restores only layout coordinates and route metadata, preserving unrelated table/relationship properties.
- Existing project permissions, collaborative snapshot version checks and read-only public links are unchanged.

## Execution and validation

Browser calculations use a lazily loaded, dedicated ELK Web Worker; it is terminated on completion, cancellation or the 20-second timeout. The initial editor bundle does not eagerly include the layout engine. Node geometry tests use the bundled engine. Layout requests are bounded to 600 tables and 2,400 column-pair connections. Routing around fixed obstacles additionally has per-path and aggregate search budgets; if constraints prevent a safe stored route, the relationship falls back to live routing and the UI reports that limitation.

Pure tests cover layered placement, cycles/self-loops/parallel/composite relationships, deterministic disconnected components, locked and hidden tables, obstacles, stale geometry, route validation/anchors, history payloads, async authorization/navigation guards and save-acknowledgment ordering. Server regression checks preserve optional route metadata through REST and collaborative snapshots. The existing JSON export passes complete relationships through and its import schema permits optional route metadata.

Synthetic desktop-size geometry previews are rendered from actual engine output, not screenshots of the editor. This environment's browser cannot reach the local execution server, so actual browser interaction/visual acceptance remains unverified. The production worker bundle was exercised using its register/layout message protocol in Node VM; this does not replace browser Worker or CSP verification.
