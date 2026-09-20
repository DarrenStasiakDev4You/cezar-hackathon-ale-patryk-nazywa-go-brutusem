# Handoff

PR #54 remains in progress on `feat/core-task-header-registration`.

## Resume Point

The first remaining task is **2.2**: commit the provider-neutral/core namespace documentation and boundary assertions. Step 2.1's implementation rename is staged for its lean commit; Step 2.2's documentation changes remain unstaged.

## Current State

- Public contract: `task.header@1`, exported as `TaskHeader` with `TaskHeaderProps`.
- Core implementation: `core.task-header`, implemented by `CoreTaskHeader` in `core-task-header.tsx`.
- Core defaults are explicitly registered with `{ default: true }`; resolver fallback selection uses `isDefault`.
- No `TaskHeaderMain`, `TaskHeaderMainProps`, old contract id, or old implementation path remains in shipped package code.

## Validation

- Passed: `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run test:package`.
- Passed: focused component/task-header tests and web/extension tests excluding `packages/web/src/routes.test.tsx`.
- Known unrelated failures: the automations loading assertion in `packages/web/src/routes.test.tsx` and several server suites during the full parallel Vitest run.

## Next Actions

1. Commit Step 2.1, then commit Step 2.2 as a separate lean commit.
2. Run/review the final gate and record the outcome in `final-gate-checks.md`.
3. Run the authoritative PR review/autofix pass, update PR #54, and release the lock.
