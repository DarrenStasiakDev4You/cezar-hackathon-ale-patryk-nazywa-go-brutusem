# Implement global edit-mode interaction guard

Source doc: `.ai/specs/2026-09-18-global-edit-mode-interaction-guard.md`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed.
>
> Migrated from the legacy `## Progress` checklist on the first `om-auto-continue-pr-loop` resume (2026-09-19). Steps 1.1–3.1 landed together in one commit before the migration, so they share its SHA.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add the DOM-only activation classifier and marker contract | inline | done | b8a5eab |
| 1 | 1.2 | Replace link-only capture behavior with click and submit capture guards | inline | done | b8a5eab |
| 2 | 2.1 | Mark editor controls and add classifier matrix tests | inline | done | b8a5eab |
| 2 | 2.2 | Add AppShell tests for normal behavior, blocked business actions, forms, and exit behavior | inline | done | b8a5eab |
| 3 | 3.1 | Run targeted web tests, typecheck, build, and configured repository gate | inline | done | b8a5eab |
| 4 | 4.1 | Merge origin/main and resolve conflicts with the edit-mode control landed via #4 | inline | done | 7467f9f |
| 4 | 4.1-review-fix | Guard keyboard activations and suspend global accelerators in edit mode | inline | done | — |

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

- 1.1 Add the DOM-only activation classifier and marker contract.
- 1.2 Replace link-only capture behavior with click and submit capture guards.

### Phase 2: Regression coverage

- 2.1 Mark editor controls and add classifier matrix tests.
- 2.2 Add AppShell tests for normal behavior, blocked business actions, forms, and exit behavior.

### Phase 3: Validation

- 3.1 Run targeted web tests, typecheck, build, and configured repository gate.

### Phase 4: Resume — sync with main

- 4.1 Merge `origin/main` into the branch. This branch was stacked on `feat/global-edit-mode-control`, which landed on `main` as the squash commit of #4; the only conflicts were the link-only guard in `app-shell.tsx` and the missing editor-action markers in `edit-mode-control.tsx`, both superseded by this PR's classifier-based guard.

- 4.1-review-fix Review fix: block Enter (non-Shift, non-IME) and Space-on-controls keydowns in the shell's capture phase, widen the classifier to activatable ARIA roles, and suspend the ⌘K / ⌘N / `c` accelerators and the composer quick replies while the shell reports `data-edit-mode="true"`.

## Risks

- Portal events must remain inside the React event tree so the shell boundary sees them; no widget bypass is introduced.
- Full repository tests had pre-existing Windows/environment failures outside the web guard surface on the original run's machine.

## Conventions

- This implementation was first prepared from `feat/global-edit-mode-control` in an isolated clone because the primary checkout's `.git` metadata was read-only.
