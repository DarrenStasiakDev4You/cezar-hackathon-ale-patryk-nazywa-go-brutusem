Source doc: `.ai/specs/2026-09-20-generic-component-settings-ui.md`
Tracking plan: `.ai/runs/2026-09-20-generic-component-settings-ui/PLAN.md`
Status: in-progress

## What changes

Add the generic Components settings UI and its supporting extension-api vocabulary. Component implementations can declare boolean, string, number, and select settings; the host revalidates and canonicalizes them, persists scalar overrides atomically in existing UI-state files, and exposes a project-scoped Settings → Components page with generated controls, reset actions, accessibility labels, and unavailable/error states. A test-only configurable-header extension proves live updates and reload persistence without entering the release bundle.

## Compatibility

The public descriptor API and `componentSettings` wire shape are additive. Existing boolean-only settings remain valid; new persisted values are finite numbers, booleans, or strings up to 256 characters, with existing sibling-key preservation and scope routing unchanged. `BACKWARD_COMPATIBILITY.md` documents the widened shape.

## Validation

Passed: `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run test:package`, and focused component-settings/extension tests. The repository-wide `npm test` remains blocked by eight unrelated process/discovery and route-timing failures. The full browser E2E suite timed out with existing quick-list, task-thread, project-groups, and GitHub flow failures before reaching a component-settings scenario. Automated review found no actionable code findings, but GitHub does not allow the PR author to submit the formal review. Details: `.ai/runs/2026-09-20-generic-component-settings-ui/final-gate-checks.md`.

## Progress

See the tracking plan. Step `4.4` remains pending until the full validation and independent-review blockers are resolved.
