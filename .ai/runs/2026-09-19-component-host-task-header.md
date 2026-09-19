# Execution plan — Component Host, PR 2 (the task header slot)

Source doc: .ai/specs/2026-09-19-component-host.md
Spec PR: #31 (merged, design-only)
Stacked on: #32 (`feat/component-host`, PR 1: the host)
Branch: feat/component-host-task-header
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Goal

Ship the first real slot. `cezar.task.header.main@1` (`TaskHeaderMain`) declares the presentational
part of the task header: the title, the status and the basic meta. `RunHeader` becomes core's shell
around it, and renders that part only through `<ComponentHost contract={TaskHeaderMain}>`. Core's
default, `CoreTaskHeaderMain`, is today's title row and meta row, moved unchanged, and is registered
before the extension host starts. Until the picker item stores a choice, nobody has a preference, so
core's header renders everywhere, exactly as it does today.

## Delivery split

The spec decides on one spec, two phases, two stacked PRs (spec Q1). **This run is PR 2: Phase 2**
(spec steps 3–6), stacked on PR 1 (#32, the host, Phase 1). PR 2 retargets `main` once #32 merges.

## Scope

- `packages/extension-api`: `src/core-components.ts` (`TaskHeaderMain`, `TaskHeaderMainProps`,
  `TaskHeaderTask`, `TaskHeaderMeta`), re-exported from `src/index.ts`; `test/surface.test.ts`; a
  token and `IsJson` test; the README's "Replacing a component" section.
- `packages/web/src/routes/task-thread/`:
  - `task-header-main.ts` (new): `useTaskHeaderMainProps` and the core-only context
    (`{ run, continuationEngine }`);
  - `core-task-header-main.tsx` (new): `CoreTaskHeaderMain`, with the title row, the plan mirror,
    the status pill, the phone-width details toggle and the meta row (with its branch chip,
    reference chips, usage and agent badge) moved from `run-header.tsx` unchanged;
  - `run-header.tsx`: the shell. It renders the host where the two rows were, the phone actions
    menu beside it, and everything else as today.
- `packages/web/src/component-registry/`: `core-components.ts` (`registerCoreComponents`,
  `coreTaskHeaderMain`), `core-contracts.ts` (`[TaskHeaderMain]`), the provider's own registry gets
  `registerCoreComponents`, `boundary.ts` + `boundary.test.ts` (no import of
  `core-task-header-main.tsx` outside `core-components.ts` and tests), `core-components.test.ts`
  (the gate test).
- `packages/web/src/commands/boundary.ts`: its import parser moves to a shared helper
  (`src/lib/import-scan.ts`) that both boundary scans use.
- `packages/web/src/main.tsx` and `app.tsx`: `registerCoreComponents(components)` before
  `startExtensionHost`; `App` takes `components` and wraps its tree in `ComponentsProvider`.
- Test wrappers that render `RunHeader` or a task route add `ComponentsProvider`.
- A build check: the entry chunk in the Vite manifest holds `CoreTaskHeaderMain` but not
  `streamdown` or `run-header`.
- `AGENTS.md`: the "Component implementations" routing row.

## Non-goals

- No preference store, no picker, no stored choice: production passes no `preferenceOf` (spec Q5).
- No other contract: the timeline, the composer and the header's actions, tabs, monitoring,
  dispatch and step rail stay core's (spec Q2, Q4b).
- No measured-height CSS variable for Changes and Files: core's default keeps today's height
  (spec § Edge Cases, deferred to the picker item).
- No change to `resolve.ts`, the extension registry, the command registry, the event bus, the HTTP
  contract, the service or the api-client. No `BACKWARD_COMPATIBILITY.md` surface moves.

## Implementation Plan

### Phase 2: The task header slot

1. **The contract** (`packages/extension-api/src/core-components.ts`), per § API Contracts,
   re-exported from `src/index.ts`, with the surface, token and `IsJson` tests and the README's
   "Replacing a component" section (spec step 3).
2. **The split, core's default and its registration** (spec step 4): `task-header-main.ts`,
   `core-task-header-main.tsx`, `run-header.tsx`, `core-components.ts`, `core-contracts.ts`,
   `provider.tsx`, `main.tsx`, `app.tsx`; `run-header.test.tsx` passes with only its wrapper
   changed; the gate test; the compatibility check of `coreTaskHeaderMain`;
   `useTaskHeaderMainProps` tests; `CoreTaskHeaderMain` throws outside the context; a fixture
   extension preference renders through `RunHeader` with the action bar and tabs still there; the
   entry-chunk build check.
3. **The boundary test and the failure path on a real page** (spec step 5): the shared import
   parser, `component-registry/boundary.test.ts`, the `task-thread.test.tsx` host and throw cases,
   and `ComponentsProvider` in the other route tests.
4. **AGENTS.md**, the "Component implementations" routing row (spec step 6).

## Risks

- **Splitting a working 1,270-line component** (AGENTS.md § Changing a mechanism that already
  works). A moved piece can lose an input on the way: the engine picker, the details toggle's
  state, `planTally`, the queue position, health's usage visibility and automations capability.
  `run-header.test.tsx` is the guard and must pass with only its wrapper changed. A QA pass
  compares the task page at phone and desktop widths with `current-01-task-header.png`.
- On phones the actions menu sits beside the host's box rather than inside the title row. That is
  the spec's one intended visual difference.
- The entry bundle: `registerCoreComponents` imports `CoreTaskHeaderMain` eagerly. The module must
  not pull in the markdown stack; the build check guards it.
- Test churn: every wrapper that renders `RunHeader` or a task route needs `ComponentsProvider`
  inside `CommandsProvider`.
- The gate runs in Docker through the main checkout's untracked `in-docker.sh`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 2: The task header slot

- [x] 2.1 The TaskHeaderMain contract — cb305e67
- [x] 2.2 The split, core's default and its registration — 88db9f0a
- [ ] 2.3 The boundary test and the failure path on a real page
- [ ] 2.4 AGENTS.md routing row
