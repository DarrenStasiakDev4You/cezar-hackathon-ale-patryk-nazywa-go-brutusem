# Checkpoint 1 — Steps 0.1..1.4

Date: 2026-09-19 UTC

## Covered commits

- `0.1` `3efd5b26` — hosted-component resolution seam
- `1.1` `bde84738` — Task Composer contract and public API
- `1.2` `fca1ef50` — prop-driven composer view and attachment/picker seams
- `1.3` `bd3886fc` — controller, engine model and task-bound draft delivery
- `1.4` `399b20dd` — core prop-only composer and continuation picker

## Validation

- PASS — `npm run typecheck` (all five workspaces, including server build and contract inlining).
- PASS — focused extension-api, composer, draft, follow-up-engine and core composer tests: 7 files,
  112 tests.
- PASS — existing composer/attachment/picker regression tests: 72 tests in the Step 1.2 window.

## UI verification

SKIP for this checkpoint. The new view and core implementation are covered by component tests, but
the task-thread slot and core registration are still the next step, so a browser run against the
existing environment would exercise the unchanged legacy thread. Browser evidence is deferred to
the checkpoint after Step 1.5, when the changed task page is mounted.

## Result

PASS. No blocker or review finding was found in the checkpoint scope. The next action is Step 1.5:
mount the hosted slot and register core's default implementation.
