# Component Implementation Preferences

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed.
>
> Migrated on 2026-09-20 by `om-auto-continue-pr-loop` from the legacy flat plan's `## Progress` checklist. The legacy checklist disagreed with the implementation-plan checkbox for 2.4; the Progress entry and commit history were treated as authoritative, and 2.4 is recorded as done at `dbb5d2dd`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add the bounded `components.implementations` workspace contract and server round-trip, merge-preservation, unknown-sibling, and rejection tests. | inline | done | 82d84a03 |
| 2 | 2.1 | Implement the pure `componentPreferences` service and its hydration, validation, persistence, rollback, serialization, and subscription tests. | inline | done | 5700731f |
| 2 | 2.2 | Implement the workspace UI-state storage adapter and `StoredComponentsProvider`, proving refresh persistence, fallback, reset, cache sharing, and failed-write behavior. | inline | done | 9a666928 |
| 2 | 2.3 | Create the service in `main.tsx`, mount it through `App`, and add the production boundary regression test for the provider wiring. | inline | done | f095251f |
| 2 | 2.4 | Update `AGENTS.md` and `BACKWARD_COMPATIBILITY.md` with the persisted preference contract. | inline | done | dbb5d2dd
| 3 | 3.1 | Resolve the duplicate implementation and current-base conflict before completion, retaining only work that is still needed after PR #58. | inline | done | 38baa471 |

Source doc: `.ai/specs/2026-09-19-component-implementation-preferences.md`

## Goal

Persist the user's component implementation choices in workspace UI state, validate choices through
the existing resolver, and wire the stored service into the production component host without adding
a settings screen or changing the zero-config default.

## Scope

- Extend the workspace UI-state contract with bounded `components.implementations` data.
- Add the pure `componentPreferences` service with hydration, validation, optimistic serialized
  writes, rollback, reset, subscription, and readiness behavior.
- Add the React/query storage adapter and `StoredComponentsProvider`, then wire it through `main.tsx`
  and `App`.
- Add server, service, provider, and production-boundary regression tests.
- Update `AGENTS.md` and `BACKWARD_COMPATIBILITY.md` for the persisted key and behavior.

## Non-goals

- No Settings picker, route, or new user-facing screen.
- No changes to the component resolver, registry, host, extension API, or server route shape beyond
  the existing workspace UI-state contract.
- No extension-facing preference API or project-scoped preference layer.

## Risks

- Workspace UI state is a protected, shallow-merged open bag; writes must preserve unknown siblings and
  never overwrite state before hydration succeeds.
- Production provider wiring can regress the current no-preference path even when isolated provider
  tests pass, so the import/wiring boundary must be pinned explicitly.
- Missing or incompatible implementations must remain stored and fall back to core's default.

## Implementation Plan

### Phase 1: The Stored Key

- [x] 1.1 Add the bounded `components.implementations` workspace contract and server round-trip,
  merge-preservation, unknown-sibling, and rejection tests.

### Phase 2: Service And Cockpit Wiring

- [x] 2.1 Implement the pure `componentPreferences` service and its hydration, validation,
  persistence, rollback, serialization, and subscription tests.
- [x] 2.2 Implement the workspace UI-state storage adapter and `StoredComponentsProvider`, proving
  refresh persistence, fallback, reset, cache sharing, and failed-write behavior.
- [x] 2.3 Create the service in `main.tsx`, mount it through `App`, and add the production boundary
  regression test for the provider wiring.
- [x] 2.4 Update `AGENTS.md` and `BACKWARD_COMPATIBILITY.md` with the persisted preference contract. — dbb5d2dd
