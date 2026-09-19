# Layout element context menu implementation

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed.
>
> Migrated on 2026-09-19 by `om-auto-continue-pr-loop` from the legacy flat plan's `## Progress` checklist (Steps 1.1–2.4 carried over verbatim). Phase 3 was added by the resume that synced this stacked PR with its base.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Define the target type and owner callback using the discovery registry types. | inline | done | 2fd14e29 |
| 1 | 1.2 | Implement edit-mode hit testing from the nearest `data-layout-id` and registry lookup. | inline | done | 2fd14e29 |
| 1 | 1.3 | Render the accessible Delete menu with reserved disabled Edit/Move actions, focus management, dismissal, and viewport clamping. | inline | done | 2fd14e29 |
| 1 | 1.4 | Delegate widget deletion to the owner callback without mutating the registry. | inline | done | 2fd14e29 |
| 2 | 2.1 | Include deterministic full subtrees for groups, including nested groups and empty groups. | inline | done | 2fd14e29 |
| 2 | 2.2 | Add an optional confirmation callback that defaults to allowing deletion and does not render a dialog. | inline | done | 2fd14e29 |
| 2 | 2.3 | Keep the component scoped to the owner’s registered layout elements, with no shell/sidebar behavior. | inline | done | 2fd14e29 |
| 2 | 2.4 | Run the configured validation gate and browser-oriented interaction checks represented by component tests. | inline | done | 2fd14e29 |
| 3 | 3.1 | Merge the updated base branch and resolve the edit-mode conflicts to the base's version. | inline | done | 166d27cb |
| 3 | 3.2 | Run the final gate on the synced branch. | inline | done | 2ed5fab9 |
| 3 | 3.3 | Authoritative review pass and fixes. | inline | done | 2ed5fab9 |
| 3 | 3.4-review-fix | Mark the context-menu Delete as an edit-mode editor action. | inline | done | f854908e |
| 3 | 3.5-review-fix | Re-check the target and edit mode after an asynchronous delete confirmation. | inline | done | 88f5819e |
| 3 | 3.6-review-fix | Return focus to the invoker on Escape and give the Delete description a per-menu id. | inline | done | 3f8f463f |
| 3 | 3.7-review-fix | Keep the native-dialog name out of the context-menu test (design guardian). | inline | done | 2ed5fab9 |
| 3 | 3.8 | Merge main after PR #12's squash-merge and retarget the PR to main. | inline | done | 5f04024e |

Goal: Add a reusable, accessible context menu for registered layout widgets and groups in edit mode, with Delete delegated to the layout owner.

Scope: `packages/web/src/components/layout-context-menu.tsx` and its tests, built on the existing editable-layout-elements discovery registry.

Non-goals: No HTTP/API changes, persistence, undo, dialog UI, drag-and-drop, or direct registry mutation. The implementation PR is based on the discovery runtime; the source spec remains design-only.

Risks: Group deletion is destructive, so the callback receives an explicit deterministic subtree and an optional confirmation seam without silently mutating layout state.

Source doc: `.ai/specs/2026-09-19-layout-element-context-menu.md`

Engine: om-auto-create-pr (steps: 8, --loop: no)

## Implementation Plan

### Phase 1: Menu and widget deletion

1. Define the target type and owner callback using the discovery registry types.
2. Implement edit-mode hit testing from the nearest `data-layout-id` and registry lookup.
3. Render the accessible Delete menu with reserved disabled Edit/Move actions, focus management, dismissal, and viewport clamping.
4. Delegate widget deletion to the owner callback without mutating the registry.

### Phase 2: Group deletion and confirmation seam

5. Include deterministic full subtrees for groups, including nested groups and empty groups.
6. Add an optional confirmation callback that defaults to allowing deletion and does not render a dialog.
7. Keep the component scoped to the owner’s registered layout elements, with no shell/sidebar behavior.
8. Run the configured validation gate and browser-oriented interaction checks represented by component tests.

### Phase 3: Sync with the base branch

9. Merge the updated base branch and resolve the edit-mode conflicts to the base's version.
10. Run the final gate on the synced branch.
11. Authoritative review pass and fixes.
12. Merge main after PR #12's squash-merge and retarget the PR to main.
