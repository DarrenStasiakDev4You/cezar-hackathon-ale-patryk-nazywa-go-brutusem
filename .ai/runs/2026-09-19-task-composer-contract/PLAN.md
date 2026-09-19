# Execution plan — task-composer-contract

Source spec: `.ai/specs/2026-09-19-task-composer-contract.md`
Branch: `feat/task-composer-contract`
Base: `origin/main` at `15d8a723`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Re-land the hosted-component seam required by Phase 2 | inline | todo | — |
| 1 | 1.1 | Add the Task Composer contract and public API documentation | group:A | todo | — |
| 1 | 1.2 | Split the composer into a prop-driven view and local New Task state | group:A | todo | — |
| 1 | 1.3 | Build the task composer controller and task-bound draft delivery | group:A | todo | — |
| 1 | 1.4 | Add core's prop-only Task Composer implementation | group:A | todo | — |
| 1 | 1.5 | Mount the composer host slot and register core's default | group:A | todo | — |
| 1 | 1.6 | Document the controller seam and verify the Phase 1 contract boundaries | dispatch:cheap | todo | — |
| 2 | 2.1 | Make attachment and engine capabilities optional and render core fallbacks beside replacements | group:B | todo | — |
| 2 | 2.2 | Add the plain external Task Composer example and boundary tests | group:B | todo | — |
| 2 | 2.3 | Prove an external composer on the task page | group:B | todo | — |
| 2 | 2.4 | Complete README and AGENTS documentation for the composer contract | dispatch:cheap | todo | — |

## Goal

Implement `cezar.task.composer@1` so core owns the task reply box's state and side effects while
any compatible implementation renders the controlled presentation. Preserve the draft, delivery,
attachments, completion lists, engine choice and quick replies across the component boundary.

## Scope

- `packages/extension-api`: contract types, token, README, example and boundary/type tests.
- `packages/web`: prop-only composer view, task controller, draft race fixes, host integration,
  optional-capability fallback UI and task-page external implementation proof.
- `AGENTS.md` and run tracking docs where the new contract seam must be recorded.

## Non-goals

- No HTTP route, server persistence format, new storage endpoint or migration.
- No New Task page contract; its existing `Composer` API remains intact.
- No component preference/settings picker; tests may inject a preference only.
- No unrelated component-platform refactor beyond the hosted-component prerequisite already
  reviewed in PR #38.

## Risks

- The contract is a large private public surface; removing or narrowing fields later requires a
  new major version.
- Draft writes and sends can settle after navigation; task identity must remain bound to each
  in-flight operation.
- This changes a user-facing task screen and requires the full validation gate plus browser QA.
- PR #38's hosted-component changes were merged into a feature branch rather than `main`; Step
  0.1 re-lands only the prerequisite seam before Phase 2.

## External References

- No operator-supplied external skill URLs.
- Source design: `.ai/specs/2026-09-19-task-composer-contract.md`.
- Prerequisite implementation: merged PR #38, re-landed selectively in Step 0.1.

## Implementation Plan

### Phase 0: prerequisite

0.1 Re-land the hosted-component seam required by Phase 2.

### Phase 1: contract, controller and core default

1.1 Add the Task Composer contract and public API documentation.
1.2 Split the composer into a prop-driven view and local New Task state.
1.3 Build the task composer controller and task-bound draft delivery.
1.4 Add core's prop-only Task Composer implementation.
1.5 Mount the composer host slot and register core's default.
1.6 Document the controller seam and verify the Phase 1 contract boundaries.

### Phase 2: optional capabilities and external proof

2.1 Make attachment and engine capabilities optional and render core fallbacks beside replacements.
2.2 Add the plain external Task Composer example and boundary tests.
2.3 Prove an external composer on the task page.
2.4 Complete README and AGENTS documentation for the composer contract.

## Progress

The Tasks table above is authoritative. This run uses one implementation commit per Step and
checkpoint verification after each five completed Steps.
