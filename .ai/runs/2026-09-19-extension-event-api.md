# Execution plan — Extension Event API, PR 1 (the bus, the service and `cezar.extension.activated`)

**Branch:** `feat/extension-event-api` · **Base:** `main`

Source doc: `.ai/specs/2026-09-19-extension-event-api.md` (spec PR #21, merged)

## 🎯 Goal

Extensions get a working `context.events`: `on`, `once`, `off` and `emit` on an in-browser bus
that delivers asynchronously, isolates listeners, snapshots payloads as JSON, keeps each
extension's events in its own namespace and removes every listener when the extension
deactivates. Core emits its first public event, `cezar.extension.activated`.

## Delivery split

The spec's owner decided on two PRs (spec Q1). **This run is PR 1: Phases 1–2**, which meet all
four DoD checks. Phase 3 (the server `task-transition` feed, the task events,
`cezar.project.changed`, `EventBusProvider` and the PR 2 docs) ships as PR 2 on its own branch,
`feat/extension-event-api-core-events`, stacked on this one and tracked by its own plan. Both are
separate PRs by the spec's own decision, not duplicates of each other.

## Scope

- `packages/extension-api`:
  - `events.ts`: `Events.off` and `Events.once`, with TSDoc restated from § Delivery, precisely;
  - `errors.ts`: TSDoc for `invalid-id`, `invalid-input` and `disposed` widened to the events
    methods;
  - `core-events.ts` (new): `ExtensionActivated` and `ExtensionActivation`, exported from the
    barrel and pinned in `test/surface.test.ts`;
  - `test/fake-context.ts`: records `on`/`once` listeners and removes them on `off`;
  - type tests in `test/commands-events.test.ts`.
- `packages/web/src/events/bus.ts` (new, pure): `createEventBus`, `EventBus`, `EventBusOptions`,
  `EventErrorReport`, `EventError`, the core view and `forExtension(scope)`; tests in
  `bus.test.ts`.
- `packages/web/src/extensions/registry.ts`: an `onStatusChange(record, previous)` option, called
  after each status change inside a try/catch.
- `packages/web/src/extensions/host.ts`:
  - `unavailableServices.events` gains `once` and `off`;
  - `cockpitServices({ commands, events })`;
  - `startExtensionHost` accepts `onStatusChange`;
  - `extensionLifecycleEvents(bus)`.
- `packages/web/src/main.tsx`: creates the bus and hands it to the host.
- Docs:
  - `packages/extension-api/README.md`: the Events section and the status note;
  - `AGENTS.md`: a task-routing row for `packages/web/src/events/`.

## Non-goals

- Everything in Phase 3 (PR 2): `RunStore` transitions, `taskTransitionEventSchema`, the
  `task-transition` SSE event, `task-events.ts`, the task and project tokens,
  `ProjectChangeReporter`, `EventBusProvider`/`useEventBus` and `BACKWARD_COMPATIBILITY.md`.
- `App`'s optional `events` prop moves to PR 2, beside the `EventBusProvider` that consumes it. In
  PR 1 nothing inside the React tree reads the bus, so the prop would be dead code.
- Wildcard subscriptions, replay, listener caps, `extension.deactivated`, unregister, and a
  devtools log (spec § Architecture, "Not in this item").
- Storage and components stay on the placeholders.

## Risks

- `Events` gains two methods. That breaks only the cockpit placeholder, the package's test fake
  and `registry.fixtures.ts`'s recording services, and all three change in Step 1.1.
- The delivery budget yields to the next macrotask the way React's scheduler does. It uses
  `setImmediate` where it exists (Node, so vitest), then a `MessageChannel` post (browsers), then
  `setTimeout(0)`. Node handles a whole batch of `MessageChannel` messages in one loop turn, which
  starved timers in the fan-out test, so `MessageChannel` alone was not enough.
- `onStatusChange` runs inside the registry's lifecycle steps. A throwing callback must not change
  a status or break `activateAll`, so it is wrapped like `onError`.
- The gate runs in Docker (`in-docker.sh`, an operator-local config), because on the WSL2 host
  8 server tests fail from leaked host state.

## Implementation Plan

### Phase 1 — The bus and the contract

1. **Extension API: `off` and `once`.** Add both to `Events`, restate the TSDoc, and widen the
   `errors.ts` TSDoc. `fake-context.ts` records listeners. `unavailableServices.events` gains
   `once`/`off`, and `recordingServices` gains `once`/`off`. Type tests:
   - `once` returns a `Disposable`;
   - `off` takes the token's listener type;
   - a listener with the wrong payload type is a compile error.

   `host.test.ts` covers the two placeholder methods.
2. **The bus, core view.** `createEventBus`, `emit`, `on` and `EventError`, following § Delivery,
   precisely. `bus.test.ts` covers:
   - asynchronous delivery;
   - order;
   - payload isolation;
   - listener isolation;
   - namespace errors and invalid ids;
   - the cascade depth;
   - the delivery budget.
3. **The extension view.** `forExtension(scope)` with `on`, `once`, `off` and `emit`. Tests prove
   DoD 1–4 at the bus level.

### Phase 2 — The extension service and `cezar.extension.activated`

4. **Lifecycle event.** Add `ExtensionActivated` and `ExtensionActivation` in `core-events.ts`,
   the barrel and the surface. Add registry `onStatusChange` and
   `extensionLifecycleEvents(bus)`. Tests in `registry.test.ts`.
5. **Boot wiring and the extension service.** `cockpitServices({ commands, events })`,
   `startExtensionHost({ onStatusChange })` and the `main.tsx` boot order. `host.test.ts` proves
   DoD 1 and DoD 4 end to end.
6. **PR 1 docs.** The README Events section and status note, and the AGENTS.md events row.

## Progress

PR: #23

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The bus and the contract

- [x] 1.1 Extension API: off and once — 1b710009
- [x] 1.2 The bus, core view — e8a37071
- [x] 1.3 The extension view — e8a37071

### Phase 2: The extension service and cezar.extension.activated

- [x] 2.1 Lifecycle event: ExtensionActivated and registry onStatusChange — e36c6a73
- [x] 2.2 Boot wiring and the extension service — 088fb377
- [x] 2.3 PR 1 docs: README Events section and AGENTS.md row — 5cd75876

### Post-review fixes

- [x] Post-review fix: a resumed drain that finds only cancelled deliveries ends its backlog streak; a dropped cascade is reported once per event id per streak; doc and test gaps from the review — 9545a2be
