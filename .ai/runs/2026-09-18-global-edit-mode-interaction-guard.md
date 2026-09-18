# Implement global edit-mode interaction guard

Source doc: `.ai/specs/2026-09-18-global-edit-mode-interaction-guard.md`

## Goal

Protect business activations centrally at the shell boundary while keeping editor actions, inspection affordances, focus, hover, and normal-mode behavior intact.

## Scope

- Add a DOM-only activation classifier for clicks and submits.
- Mount capture guards once in `AppShell`.
- Mark only the existing edit-mode entry/exit controls as editor actions.
- Add unit and shell regression coverage for nested targets, links, buttons, forms, explicit editor actions, and normal mode.

## Non-goals

- No widget-level `editMode` checks.
- No API, storage, persistence, event bus, or extension contract changes.
- No global browser listeners or pointer/focus suppression.

## Implementation Plan

### Phase 1: Central policy

- [x] 1.1 Add the DOM-only activation classifier and marker contract.
- [x] 1.2 Replace link-only capture behavior with click and submit capture guards.

### Phase 2: Regression coverage

- [x] 2.1 Mark editor controls and add classifier matrix tests.
- [x] 2.2 Add AppShell tests for normal behavior, blocked business actions, forms, and exit behavior.

### Phase 3: Validation

- [x] 3.1 Run targeted web tests, typecheck, build, and configured repository gate.

## Risks

- Portal events must remain inside the React event tree so the shell boundary sees them; no widget bypass is introduced.
- Full repository tests have pre-existing Windows/environment failures outside the web guard surface.

## Progress

> Convention: `- [ ]` pending. This implementation was prepared from `feat/global-edit-mode-control` in an isolated clone because the primary checkout's `.git` metadata is read-only.

### Phase 1: Central policy

- [x] 1.1 Add the DOM-only activation classifier and marker contract.
- [x] 1.2 Replace link-only capture behavior with click and submit capture guards.

### Phase 2: Regression coverage

- [x] 2.1 Mark editor controls and add classifier matrix tests.
- [x] 2.2 Add AppShell tests for normal behavior, blocked business actions, forms, and exit behavior.

### Phase 3: Validation

- [x] 3.1 Run targeted web tests, typecheck, build, and configured repository gate.
