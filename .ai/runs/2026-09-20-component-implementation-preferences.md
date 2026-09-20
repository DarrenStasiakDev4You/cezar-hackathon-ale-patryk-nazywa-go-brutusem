# Component Implementation Preferences

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

- [ ] 1.1 Add the bounded `components.implementations` workspace contract and server round-trip,
  merge-preservation, unknown-sibling, and rejection tests.

### Phase 2: Service And Cockpit Wiring

- [ ] 2.1 Implement the pure `componentPreferences` service and its hydration, validation,
  persistence, rollback, serialization, and subscription tests.
- [ ] 2.2 Implement the workspace UI-state storage adapter and `StoredComponentsProvider`, proving
  refresh persistence, fallback, reset, cache sharing, and failed-write behavior.
- [ ] 2.3 Create the service in `main.tsx`, mount it through `App`, and add the production boundary
  regression test for the provider wiring.
- [ ] 2.4 Update `AGENTS.md` and `BACKWARD_COMPATIBILITY.md` with the persisted preference contract.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The Stored Key

- [ ] 1.1 Add the bounded `components.implementations` workspace contract and server round-trip, merge-preservation, unknown-sibling, and rejection tests.

### Phase 2: Service And Cockpit Wiring

- [ ] 2.1 Implement the pure `componentPreferences` service and its hydration, validation, persistence, rollback, serialization, and subscription tests.
- [ ] 2.2 Implement the workspace UI-state storage adapter and `StoredComponentsProvider`, proving refresh persistence, fallback, reset, cache sharing, and failed-write behavior.
- [ ] 2.3 Create the service in `main.tsx`, mount it through `App`, and add the production boundary regression test for the provider wiring.
- [ ] 2.4 Update `AGENTS.md` and `BACKWARD_COMPATIBILITY.md` with the persisted preference contract.
