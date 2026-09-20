# Execution plan — Component Overrides settings UI

**Source doc:** `.ai/specs/2026-09-19-component-implementation-preferences.md`

## 🎯 Goal

Let users choose the implementation of each replaceable cockpit component from Settings → Interface → Components, persist the choice, and reset it to core without restarting or editing files.

## Scope

- Persist workspace-level component implementation preferences in the existing UI-state store.
- Feed the live preference into the component host so a selection changes the current UI immediately.
- Add a global Settings → Interface → Components screen showing compatible implementations, provider, current choice, and reset.
- Keep core's default implementation available and never offer incompatible registrations.

## Non-goals

- Per-implementation settings forms.
- New HTTP routes or extension-facing write APIs.
- Changes to component contracts, resolver compatibility rules, or task-header behavior beyond selection wiring.

## Risks

The preference service must not overwrite unrelated workspace UI state, and a missing extension must fall back to core without deleting the stored choice. The UI must use the registry's compatibility result rather than duplicating compatibility checks.

## Implementation Plan

### Phase 1: Preference storage and live host wiring

- [ ] 1.1 Add the bounded `components.implementations` workspace UI-state contract and tests.
- [ ] 1.2 Add the validated component preference service with hydration, set/reset, rollback, and tests.
- [ ] 1.3 Wire the service through the app and component provider, with live host updates and tests.

### Phase 2: Settings UI

- [x] 2.1 Add the global Interface → Components settings section and route. — pending commit
- [x] 2.2 Render compatible implementation choices with provider metadata and reset-to-core behavior. — pending commit
- [x] 2.3 Add UI tests for selection, persistence, incompatible filtering, core availability, and reset. — pending commit

### Phase 3: Verification and handoff

- [ ] 3.1 Update protected-surface documentation and run the configured validation gate.
- [ ] 3.2 Complete review and browser QA evidence for the settings flow.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Preference storage and live host wiring

- [x] 1.1 Add the bounded `components.implementations` workspace UI-state contract and tests. — pending commit
- [x] 1.2 Add the validated component preference service with hydration, set/reset, rollback, and tests. — pending commit
- [x] 1.3 Wire the service through the app and component provider, with live host updates and tests. — pending commit

### Phase 2: Settings UI

- [ ] 2.1 Add the global Interface → Components settings section and route.
- [ ] 2.2 Render compatible implementation choices with provider metadata and reset-to-core behavior.
- [ ] 2.3 Add UI tests for selection, persistence, incompatible filtering, core availability, and reset.

### Phase 3: Verification and handoff

- [ ] 3.1 Update protected-surface documentation and run the configured validation gate.
- [ ] 3.2 Complete review and browser QA evidence for the settings flow.
