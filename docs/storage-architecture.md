# Storage architecture

## Goals

- Never perform filesystem or SQLite work on the renderer thread.
- Keep one authoritative online store for each data domain.
- Coalesce bursts, serialize commits, and make lifecycle flushes impossible to forget.
- Preserve committed session data across crashes, partial writes, and recoverable corruption.
- Keep workspace-portable files separate from machine-local databases and preferences.

## Layers

```text
Zustand / domain services
        │ immutable state and revisions
        ▼
Domain repositories
        │ typed snapshots or incremental patches
        ▼
BufferedCommitQueue + PersistenceCoordinator
        │ coalescing, single-writer ordering, lifecycle flush
        ▼
Preload IPC contract
        │ structured clone; no filesystem capability in Renderer
        ▼
Main-process storage worker
        │ transaction, WAL, checkpoint, integrity and backup policy
        ▼
SQLite / workspace-portable files / application preferences
```

## Storage classes

| Class | Authority | Location | Policy |
| --- | --- | --- | --- |
| Agent sessions | SQLite + content-addressed blobs | user configuration directory, keyed by workspace UUID | WAL, `synchronous=FULL`, incremental message-tail transactions |
| Workspace UI state and project settings | JSON | `.adnify/` | atomic file API through `workspaceFileRepository` |
| Analytics and AI attribution | append-oriented JSONL | `.adnify/` | best-effort, batched, not part of session correctness |
| Application preferences | `electron-store` | user configuration directory | small values only; localStorage may be a disposable UI cache, never authority |
| Runtime queues and previews | memory/sessionStorage | renderer lifetime | explicitly non-durable |

JSONL is not an online session backend. The session worker may read the legacy
format exactly once inside a transaction. A migration marker prevents old data
from being imported again after the user clears the database.

## Session commit protocol

1. Streaming text is rendered from memory at approximately 30 fps.
2. Persistence observes durable Zustand revisions but does no serialization while streaming.
3. After the existing 750 ms quiet window, the repository calculates the first changed message ordinal.
4. Only that tail plus changed metadata/state crosses IPC.
5. A dedicated worker performs one `BEGIN IMMEDIATE` transaction and acknowledges after `COMMIT`.
6. WAL checkpoints run on worker idle/threshold boundaries, never on the renderer.

Branches and branch messages are normalized into their own tables. Branch lists
remain lazy: catalog reads load metadata only, and message bodies load when a
thread is activated. Strings of at least 256 KiB (including base64 media) are
stored once by SHA-256 beside the database and are hydrated transparently. This
keeps the hot database and IPC patches small without changing domain objects.

## Schema and capacity policy

- `PRAGMA user_version` is authoritative. Every schema change is an ordered,
  transactional migration; a migration error rolls back and is never treated as
  physical corruption.
- Legacy inline branches and large payloads are upgraded once and recorded in
  `migration_log`. There is no permanent compatibility write path.
- `session:getStats` exposes database, WAL and blob bytes; row counts; page size;
  and free-page count for diagnostics and future alerting.
- Idle maintenance performs bounded incremental vacuum and query-planner
  optimization. It never runs on the renderer thread.
- One database per workspace is the partition boundary. SQLite indexes by
  `thread_id` and ordinal already give bounded reads, so table/database sharding
  is intentionally deferred until measured capacity data justifies it.

There is no dual write and no JSONL fallback. A failed commit remains pending in
the shared queue. Critical shutdown and workspace-switch handshakes await the
`PersistenceCoordinator` before the security scope changes or the worker closes.

## Recovery policy

- WAL is the first crash-recovery layer.
- Startup runs `quick_check` before exposing a catalog.
- Clean shutdown truncates WAL. A verified rotating snapshot is refreshed only
  when data changed and the current snapshot is at least 24 hours old, bounding
  full-database write amplification.
- If the primary database fails validation, the primary, WAL, and SHM files are
  renamed with a `.corrupt-<timestamp>` suffix before a verified snapshot is restored.
- Blob garbage collection checks both retained snapshots before deleting an
  unreferenced object, so a restored snapshot cannot reference a missing file.
- Explicit clear removes the active records, companion blobs, and both snapshots,
  preventing deleted conversations from being resurrected by recovery.
- If neither the primary nor a snapshot validates, opening fails explicitly;
  legacy JSONL is never promoted as a hidden runtime fallback.

## Extension rule

New durable domains must provide a repository and register one stable participant
ID with `PersistenceCoordinator`. They must not add their own shutdown hook, write
from a React component, call Node filesystem APIs from Renderer, or introduce a
second authoritative cache.

The reproducible write-amplification benchmark is:

```sh
npm run build
node scripts/benchmark-session-storage.cjs
```
