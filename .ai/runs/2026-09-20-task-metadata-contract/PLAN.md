# Task Metadata Contract Implementation

**Run:** 2026-09-20-task-metadata-contract  
**Branch:** `feat/task-metadata-contract`  
**Base:** `origin/main` at `c4c4e7d9` (includes spec commit `e3310476`)  
**Engine:** standard (steps: 9, --loop: yes)  
**Source spec:** `.ai/specs/2026-09-19-task-metadata-contract.md`  
**Design PR:** #41 (merged; implementation remains a separate PR)

## Tasks

> Authoritative status table. Each Step maps to exactly one implementation commit. The first `todo` row is the resume point.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | The shared model and the contract | inline | done | 0a06733e |
| 1 | 1.2 | The controller, and the header's adapter on top of it | inline | done | 22d259a9 |
| 2 | 2.1 | One list of core's sources, and the host's header constant | inline | done | a51d890f |
| 2 | 2.2 | `shows-meta` leaves the header contract | inline | done | e297f917 |
| 2 | 2.3 | The split | inline | done | 5063eda9 |
| 3 | 3.1 | The second implementation | inline | done | 7e4e2d96 |
| 3 | 3.2 | The proof on the task page | inline | done | 69239e79 |
| 3 | 3.3 | The conformance test | inline | done | pending |
| 3 | 3.4 | The README and AGENTS.md | inline | todo | — |

## Goal

Implement the complete task metadata contract spec in one implementation PR: expose `cezar.task.metadata@1`, move metadata derivation into a shared controller, render core metadata through a separate host owned by the shell layout, prove an independent implementation works, and add generic conformance and source-list gates.

## Scope

- `packages/extension-api`: public metadata model, intents, token, aliases, exports, and contract tests.
- `packages/web`: metadata controller and core view, shell placement/toggle, registry source data, registration, boundary/chunk checks, independent compact implementation, route/conformance tests, and focused UI tests.
- Repository guidance and extension API README updates required by the spec.
- Tests for every behavior and source change, followed by the configured validation gate and focused UI/integration checks.

## Non-goals

- No persisted metadata or layout positions.
- No changes to the generic registry, resolver, provider, HTTP contract, server, commands, events, or extension host.
- No production extension package or drag-and-drop layout editor.
- No changes to the merged design-only PR #41.

## Risks

- This is a shared public contract and cross-package UI refactor; risk is high and the full gate is mandatory.
- `run-header.tsx`, the header contract, and component-host tests may overlap with open follow-up work; changes stay based on fresh `origin/main` and are validated against current sources.
- UI behavior must preserve accessibility, mobile collapse state, rename blur behavior, and independent host failure isolation.

## Implementation Plan

### Phase 1: Contract and controller

1. **The shared model and the contract** — Add the neutral metadata model, action state, task ref, intents, token, aliases, exports, and type/runtime/surface tests.
2. **The controller, and the header's adapter on top of it** — Move metadata derivation into `useTaskMetadataController`, share frozen data and stable intents, and make the existing header adapter consume it without visible behavior changes.

### Phase 2: Core implementation and shell

3. **One list of core's sources, and the host's header constant** — Add source-list data, derive boundary and eager-chunk checks, generalize props-only scans, and remove the fixed failure-notice height.
4. **`shows-meta` leaves the header contract** — Update the header token and core registration capabilities, README contract details, and compatibility tests.
5. **The split** — Move the core metadata row into its own props-only implementation, register and host it, move the shell toggle/layout state, and update route/UI tests.

### Phase 3: Independent implementation, proof, and documentation

6. **The second implementation** — Add the public-contract-only compact implementation and isolated host/registry tests.
7. **The proof on the task page** — Verify the alternative implementation, engine intent, and fallback behavior through the real task route.
8. **The conformance test** — Exercise every served core contract for fixtures, sizing, fallback, incompatibility, and disposal.
9. **The README and AGENTS.md** — Document the new contract and generic core-component rules, including the corrected design-spec note.

## Validation

Configured final gate, in order:

1. `sh .ai/scripts/in-docker.sh npm run typecheck`
2. `sh .ai/scripts/in-docker.sh npm test`
3. `sh .ai/scripts/in-docker.sh npm run test:unit`
4. `sh .ai/scripts/in-docker.sh npm run build`
5. `sh .ai/scripts/in-docker.sh npm run test:package`

Focused UI/integration checks will run at the checkpoint and final gate where the environment supports them. The PR is user-facing, so it will carry `needs-qa` and will not receive `qa-approved` or `qa-self-verified`.

## External References

- `.ai/specs/2026-09-19-task-metadata-contract.md`
- Merged design-only PR #41
- No external skill URLs

## Resume

The draft PR body will carry this run path in its `Tracking plan:` line. Resume an interrupted run with `om-auto-continue-pr-loop {PR_NUMBER}`.
