# Handoff — global edit-mode interaction guard (PR #8)

_A fresh agent should be able to resume in under 30 seconds from this file._

## State: COMPLETE

- All Tasks rows are done (1.1–4.1-review-fix, `b8a5eab`..`f628550`). The base conflict with `main` is resolved by merge 7467f9f; the PR is mergeable.
- Final gate: see `final-gate-checks.md`. typecheck, test:unit, build and test:package pass. `npm test` shows 8 pre-existing server failures that only happen on a WSL host; the e2e suite is red on `main` too (31 shared failures). Nothing is attributable to this PR.
- Review: the one major finding (keyboard bypass) is fixed. The re-review is clean apart from two minors, left as follow-ups.

## What exists now

- `packages/web/src/components/edit-mode-interaction-guard.ts`: DOM-only policy with `shouldBlockEditModeActivation` (click/submit), `shouldBlockEditModeKeyActivation` (keydown) and `isEditModeActive` (reads the shell marker).
- `AppShell` mounts click, submit and keydown capture guards once. The shared shortcut hooks and composer quick replies stand down in edit mode.
- Editor actions opt in with `data-edit-mode-action="allow"`; only the edit-mode control and the exit button carry it.

## Next concrete action

Manual QA (`needs-qa`, qaGate on): a QA reviewer runs the instructions comment on the PR and adds `qa-approved`. Follow-ups: pointer-only primitives (Radix Select, Tabs, toast actions) and narrowing `data-edit-mode-open` to open-only.
