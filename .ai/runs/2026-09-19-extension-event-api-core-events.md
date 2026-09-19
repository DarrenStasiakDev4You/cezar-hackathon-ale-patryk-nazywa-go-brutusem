# Execution plan — Extension Event API, PR 2 (task events and `cezar.project.changed`)

**Branch:** `feat/extension-event-api-core-events` · **Base:** `feat/extension-event-api` (PR 1, #23), retargeted to `main` once PR 1 merges

Source doc: `.ai/specs/2026-09-19-extension-event-api.md` (spec PR #21, merged)

## 🎯 Goal

Extensions can react to what happens to tasks and to the project the user is looking at:
`cezar.task.status-changed` on every status change, the semantic `started`, `completed`,
`failed`, `cancelled` and `archived` events, and `cezar.project.changed`. The server names *that*
a task changed state (`task-transition` on the workspace stream). The cockpit names *what it
means* and emits it on PR 1's bus.

## Delivery split

This is **PR 2 of 2** (spec Q1): Phase 3. PR 1 (#23, `feat/extension-event-api`) ships the bus,
`context.events` and `cezar.extension.activated`. This PR is stacked on PR 1 and merges after it.

## Scope

- Server:
  - `packages/cezar/src/runs/store.ts`: a `Map<runId, { status, archived }>` snapshot. It is
    seeded in `open()` after reconcile, recorded without an event on create and on a run's first
    `touch`, and dropped on delete and prune. `touch` emits
    `('transition', { run, previousStatus, previousArchived })` right after `('run', run)`.
  - `packages/contract/src/runs.ts`: `taskTransitionEventSchema` (additive).
  - `packages/cezar/src/server/server.ts`: `task-transition` on `GET /api/v1/workspace/events`
    only, written right after the `run` event.
  - `BACKWARD_COMPATIBILITY.md` § 2: the new workspace event name.
- Extension API (`core-events.ts`, the barrel and the surface test): `TaskStatusChanged`,
  `TaskStarted`, `TaskCompleted`, `TaskFailed`, `TaskCancelled`, `TaskArchived`, `TaskEvent`,
  `TaskTransition`, `ProjectChanged` and `ProjectChange`.
- Cockpit:
  - `packages/web/src/events/task-events.ts` (new, pure): `taskEventsFor(transition)`.
  - `packages/web/src/events/provider.tsx` (new): `EventBusProvider` and `useEventBus`.
    `App` mounts it and takes the optional `events` prop that PR 1 deferred, and `main.tsx`
    passes the page's bus.
  - `packages/web/src/api/global-events.tsx`: parses `task-transition` and relays it to the bus
    before the active-project filter. It never patches a cache and never throws into the
    message loop.
  - `packages/web/src/events/project-change-reporter.tsx` (new). It is mounted once inside the
    router in `app.tsx`, beside `LastLocationController`. The spec said `routes.tsx`, but mounting
    it there meant wrapping the whole route table in a fragment, a 512-line re-indent.
- Docs:
  - the README core events table, with the disconnect-gap and once-per-cockpit notes and the
    auto-archive example;
  - the AGENTS.md events row and the Runs store row.

## Non-goals

- `task.deleted`, `task.restored`, `extension.deactivated`, replay of a disconnect gap, a
  current-project getter, and a leader page (spec § Architecture, "Not in this item").
- The per-project streams (`/api/v1/events`, `/api/v1/p/:id/events`) do not carry
  `task-transition`: widening the boot-project stream is breaking (BACKWARD_COMPATIBILITY.md § 2).

## Risks

- `RunStore.touch` runs on every token update. The addition is one Map lookup and two
  comparisons, plus one extra store event on a real transition. Every construction site of the
  snapshot must stay in step (`this.runs.set` / `this.runs.delete`).
- The `useGlobalEvents` message loop gains one stamped name. The relay runs only with a bus
  present and is wrapped in a try/catch. Existing `global-events` tests must pass unchanged.
- The gate runs in Docker (`in-docker.sh`, operator-local config).

## Implementation Plan

### Phase 3 — Task and project events

1. **Server transition feed.** The store snapshot and its `'transition'` event, the contract
   schema, `task-transition` on the workspace stream, and the compatibility doc line. Store tests
   and `workspace-events.test.ts` cases, per spec Step 6.
2. **Task events in the cockpit.**
   - the tokens;
   - `task-events.ts`, with a table-driven test;
   - `EventBusProvider` / `useEventBus` and the `App`/`main.tsx` wiring;
   - the relay in `useGlobalEvents`, covered by `global-events.test.tsx` cases (spec Step 7).
3. **Project reporter.** `ProjectChanged`/`ProjectChange`, and `ProjectChangeReporter` inside
   the router with its tests (spec Step 8).
4. **PR 2 docs.** The README core events table and notes, and the AGENTS.md rows (spec Step 9).

## Progress

PR: #25

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 3: Task and project events

- [x] 3.1 Server transition feed: RunStore snapshot, task-transition on the workspace stream — fb6e8db7
- [x] 3.2 Task events in the cockpit: tokens, taskEventsFor, EventBusProvider, the stream relay — beeebda5
- [x] 3.3 Project reporter: ProjectChanged and ProjectChangeReporter — b3568aed
- [x] 3.4 PR 2 docs: README core events table and AGENTS.md rows — 82411c93
