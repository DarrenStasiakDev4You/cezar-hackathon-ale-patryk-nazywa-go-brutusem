# Execution plan — Task Header Contract, PR 1 (the slot, with the complete model)

Source doc: .ai/specs/2026-09-19-task-header-contract.md
Spec PR: #34 (merged, design-only)
Branch: feat/task-header-contract
Engine: om-auto-create-pr (steps: 6, --loop: no)

## Goal

Ship `cezar.task.header.main@1` with the header's complete public model: the task and its status
as the task list shows it, the runner and model, the basic facts, and the state of Continue, Stop
and Archive as `{ available, enabled, pending, reason? }` plus seven `void` intents. `RunHeader`
becomes core's shell around `<ComponentHost contract={TaskHeaderMain}>`. Core's default,
`CoreTaskHeaderMain`, renders today's title row and meta row **from its props alone**, and
`useTaskHeaderModel` is the only reader of the run behind those props and the three actions. The
default page looks as it does today, except the five differences the spec lists (§ UI/UX).

## Delivery split

The spec decides on one spec, two phases, two stacked PRs (spec Q1). **This run is PR 1: Phase 1**
(spec Implementation Plan steps 1–6), from `main` as #32 left it. #33 is abandoned (spec Q8); this
PR rebuilds the split from item 10's design and reuses #33's wiring (registry factory, import
scanner, build check, test wrappers) where the spec keeps it. Phase 2 (steps 7–11:
`useHostedComponent`, the `offers-*` capabilities, the compact example and the proof on the task
page) ships as PR 2 on its own branch, `feat/task-header-contract-actions`, stacked on this one
and tracked by its own plan. Both are separate PRs by the spec's own decision, not duplicates.

## Scope

- `packages/extension-api`: `src/core-components.ts` (`TaskHeaderMain` and its seven data
  interfaces), re-exported from `src/index.ts`; `test/surface.test.ts`; a token, `IsJson` and
  intents type test; the README's "Replacing a component" section.
- `packages/web/src/routes/task-thread/`:
  - `task-header-main.ts` (new): `useTaskHeaderModel` — props, `stopTask`, `titleEditor`;
  - `core-task-header-main.tsx` (new): `CoreTaskHeaderMain` on props only;
  - `run-header.tsx`: the shell; actions from the model; the title editor over the part;
    `onChooseEngine` in place of `continuationEngine`;
  - `task-thread.tsx`: passes `continueAction.focusPicker` as `onChooseEngine`;
  - `follow-up-engine.tsx`: `useContinueAction().focusPicker()`.
- `packages/web/src/components/`: `reference-status.tsx` (the look-up as a hook the provider also
  uses), `reference-chip.tsx` (an explicit look-up entry that always wins).
- `packages/web/src/component-registry/`: `core-components.ts` (`registerCoreComponents`,
  `createCoreComponentRegistry`), `core-contracts.ts` (`[TaskHeaderMain]`), `provider.tsx` (its
  own registry has core's defaults), `boundary.ts` + tests, the gate test.
- `packages/web/src/lib/import-scan.ts` (new): the import parser from `commands/boundary.ts`.
- `packages/web/src/main.tsx`, `app.tsx`: register core's defaults before `startExtensionHost`;
  `App` wraps its tree in `ComponentsProvider` inside `CommandsProvider`.
- `packages/web/vite.config.ts`: the entry-chunk check (core's default's own static imports reach
  neither `run-header.tsx` nor `streamdown`).
- Every test that renders `RunHeader` or a task route adds `ComponentsProvider`.
- `AGENTS.md`: the "Component implementations" routing row gains the host and slot rules (spec
  step 6).

## Non-goals

- Everything in Phase 2 (PR 2): no `offers-*` capability, no `useHostedComponent`, no example, no
  `external-task-header.test.tsx`, no `react` devDependency for `packages/extension-api`.
- No preference store and no picker: production passes no `preferenceOf`, so core's default
  renders everywhere.
- No other contract; the tabs, Finish, Open in, Notes, Mark unread, Pin, Delete, the monitoring
  and dispatch lines, the step rail and the resume hint stay core's and keep reading the run.
- No change to `resolve.ts`, `registry.ts`, the command handlers, the event bus, the HTTP
  contract, the service or the api-client.

## Implementation Plan

### Phase 1: The slot, with the complete model

1. **The contract** (spec step 1): `core-components.ts` in `packages/extension-api` without the
   `offers-*` capabilities, the README section, the token/`IsJson`/intent type tests, the surface
   test.
2. **The adapter** (spec step 2): `useTaskHeaderModel` in `task-header-main.ts`; the reference
   look-up as a hook (`reference-status.tsx`). Per-field and per-intent tests in
   `task-header-main.test.ts`.
3. **Core's default on props only** (spec step 3): `core-task-header-main.tsx`;
   `reference-chip.tsx` takes an explicit look-up entry. `core-task-header-main.test.tsx` renders
   with no query client, router, command or component provider;
   `core-task-header-boundary.test.ts` with the import parser moved to `lib/import-scan.ts`.
4. **Core's default registered, and the registry provided** (spec step 4): `core-components.ts`,
   `core-contracts.ts`, `provider.tsx`, `main.tsx`, `app.tsx`, `vite.config.ts`; the gate test, the
   component boundary test, the build check test, the compatibility test, `host.test.ts`.
5. **The split** (spec step 5): `RunHeader` becomes the shell on the model; `task-thread.tsx`,
   `follow-up-engine.tsx`; every wrapper adds `ComponentsProvider`; the listed test rewrites and
   the new assertions.
6. **AGENTS.md** (spec step 6): the routing row's host and slot rules.

## Risks

- **Splitting a working 1,270-line component** (AGENTS.md § Changing a mechanism that already
  works). `run-header.test.tsx` must pass with exactly the spec's three deliberate rewrites; the
  adapter's per-field tests pin each derivation to the helper that fed it before.
- **Callbacks and a non-remounting header.** The header is not remounted between tasks, so the
  seven intents keep one identity and read the latest run through a ref; a test drives A → B.
- **The reference look-up moves into the adapter.** The header's chips were fed by a
  `ReferenceStatusProvider` inside the meta row; now the adapter publishes the requests and reads
  the entries, so the chip must never do a second look-up that could override the props.
- **Entry bundle.** `registerCoreComponents` loads core's default with the first paint; the build
  check keeps `run-header.tsx` and `streamdown` out of its static graph.
- The validation gate runs in Docker through the main checkout's untracked `in-docker.sh`, because
  host state breaks some server tests on WSL2. No CI runs on this repository.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The slot, with the complete model

- [x] 1.1 The contract — 52ac8beb
- [x] 1.2 The adapter — 344dd43a
- [x] 1.3 Core's default on props only — 3d8541b6
- [x] 1.4 Core's default registered, and the registry provided — 75b72b33
- [x] 1.5 The split — 40bfeb02
- [x] 1.6 AGENTS.md — a6ab0139
- [x] Post-review fix: remembered reference status on an idle look-up, pending scoped to the task shown, the conflict card closes only for its own request — 3264d447
