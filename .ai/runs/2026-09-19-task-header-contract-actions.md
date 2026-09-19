# Execution plan — Task Header Contract, PR 2 (taking over the actions, and the proof)

Source doc: .ai/specs/2026-09-19-task-header-contract.md
Spec PR: #34 (merged, design-only)
Stacked on: #37 (`feat/task-header-contract`, PR 1: the slot, with the complete model)
Branch: feat/task-header-contract-actions
Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal

Let an implementation of `cezar.task.header.main@1` take over Continue, Stop and Archive, one by
one, through the optional capabilities `offers-continue`, `offers-stop` and `offers-archive`, and
prove the brief's Definition of Done: a header written in a separate package, importing nothing
from `packages/web`, renders on the task page and runs Continue, Stop (after core's confirmation)
and Archive. Core's own header declares none of the three, so the default page is unchanged.

## Delivery split

The spec decides on one spec, two phases, two stacked PRs (spec Q1). **This run is PR 2: Phase 2**
(spec Implementation Plan steps 7–11), stacked on PR 1 (#37, Phase 1). It retargets `main` once #37
merges (merge `main` in keeping the branch side, then check the tree). Separate from #37 by the
spec's own decision, not a duplicate.

## Scope

- `packages/web/src/component-registry/component-host.tsx`: `useHostedComponent(contract,
  subject)`; `ComponentHost` calls it, so the host and the shell make one choice.
- `packages/extension-api/src/core-components.ts`: `optionalCapabilities` gains the three
  `offers-*`; its token test.
- `packages/web/src/routes/task-thread/run-header.tsx`: for each `offers-*` the hosted
  implementation's checked capabilities include, the bar leaves that action out; while it offers
  any, the Run actions menu loses `md:hidden` and lists every task action.
- `packages/extension-api/examples/compact-task-header/index.ts` (new); `react` as an
  extension-api devDependency pinned to `packages/web`'s range; `test/boundary.test.ts` lets
  examples import `react` (never `src/`); `test/compact-task-header.test.ts` (new).
- `packages/web/src/routes/task-thread/external-task-header.test.tsx` (new): the example activated
  through the real extension registry and preferred on the task page.
- The extension-api README and AGENTS.md: the `offers-*` capabilities, the Run actions menu
  guarantee, the second example, and the one widening of the boundary.

## Non-goals

- No preference store and no picker: production still passes no `preferenceOf`, so core's default
  renders everywhere and the example is exercised by tests only.
- No new workspace for the example (spec Q9), no change to `resolve.ts` or `registry.ts`, the
  commands, the event bus, the HTTP contract, the service or the api-client.
- `BUILTIN_EXTENSIONS` stays empty.

## Implementation Plan

### Phase 2: Taking over the actions, and the proof

1. **`useHostedComponent`** (spec step 7): the host's subscribe, resolve and choose steps move into
   the hook; `component-host.test.tsx` passes unchanged, plus the hook's own tests.
2. **The `offers-*` capabilities, honoured by the shell** (spec step 8): token, README, `run-header.tsx`,
   with the fixture-implementation tests in `run-header.test.tsx`.
3. **The example** (spec step 9): `examples/compact-task-header/index.ts`, the `react`
   devDependency, the boundary test, `test/compact-task-header.test.ts`.
4. **The proof on the task page** (spec step 10): `external-task-header.test.tsx`.
5. **The README and AGENTS.md** (spec step 11).

## Risks

- **A replacement that hides an action it declares.** The Run actions menu stays visible at every
  width while any `offers-*` is honoured, and lists every task action, so the task stays controllable.
- **Host and shell disagreeing.** Both call `useHostedComponent`, which reads the provider's one
  failure record; the only window is the commit between a throw and its record (spec § Edge Cases).
- **Two copies of React in the cockpit test.** `react` in extension-api is pinned to
  `packages/web`'s range, and npm hoists one copy, so the example's `createElement` is the page's.
- The validation gate runs in Docker through the main checkout's untracked `in-docker.sh`. No CI
  runs on this repository.

## Progress

PR: #38

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 2: Taking over the actions, and the proof

- [x] 2.1 useHostedComponent — e0621e94
- [x] 2.2 The offers-* capabilities, honoured by the shell — f349bfc2
- [x] 2.3 The example — e6922620
- [x] 2.4 The proof on the task page — da9b353e
- [x] 2.5 The README and AGENTS.md — 3376f544
- [x] Post-review fix: tighter tests (a positive control for the non-offering row, checked-not-declared capabilities, a restored console spy) — f9c6e2dc
- [x] Merged #37's review fix (`3264d447`) — 9404452c
