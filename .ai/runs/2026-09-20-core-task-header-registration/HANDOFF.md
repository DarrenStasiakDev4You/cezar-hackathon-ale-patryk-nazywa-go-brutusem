# Handoff

PR #54 remains blocked and in progress on `feat/core-task-header-registration`.

## Resume Point

Task **2.3** reached its review gate but is blocked by the repository-wide Vitest failures. Steps 2.1 and 2.2 are committed as separate lean commits, and the review found no functional findings in the changed code.

## Current State

- Public contract: `task.header@1`, exported as `TaskHeader` with `TaskHeaderProps`.
- Core implementation: `core.task-header`, implemented by `CoreTaskHeader` in `core-task-header.tsx`.
- Core defaults are explicitly registered with `{ default: true }`; resolver fallback selection uses `isDefault`.
- No `TaskHeaderMain`, `TaskHeaderMainProps`, old contract id, or old implementation path remains in shipped package code.

## Validation

- Passed: `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run test:package`.
- Passed: focused component/task-header tests and web/extension tests excluding `packages/web/src/routes.test.tsx`.
- Known gate failures: 12 tests in 8 files during the full parallel Vitest run, including automation route loading, agent profiles, open-in-app, route parity, system prompt, settings, and task-files suites, plus 2 teardown errors.
- Focused changed-code validation: 38 files and 1,067 tests passed.

## Next Actions

1. Resolve or explicitly waive the repository-wide Vitest failures, then rerun `npm test`.
2. Re-run the configured gate and the browser QA suite before marking PR #54 ready.
