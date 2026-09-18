# Layout element context menu implementation

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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Menu and widget deletion

- [x] 1.1 Define the target type and owner callback using the discovery registry types. — 2fd14e29
- [x] 1.2 Implement edit-mode hit testing from the nearest `data-layout-id` and registry lookup. — 2fd14e29
- [x] 1.3 Render the accessible Delete menu with reserved disabled Edit/Move actions, focus management, dismissal, and viewport clamping. — 2fd14e29
- [x] 1.4 Delegate widget deletion to the owner callback without mutating the registry. — 2fd14e29

### Phase 2: Group deletion and confirmation seam

- [x] 2.1 Include deterministic full subtrees for groups, including nested groups and empty groups. — 2fd14e29
- [x] 2.2 Add an optional confirmation callback that defaults to allowing deletion and does not render a dialog. — 2fd14e29
- [x] 2.3 Keep the component scoped to the owner’s registered layout elements, with no shell/sidebar behavior. — 2fd14e29
- [x] 2.4 Run the configured validation gate and browser-oriented interaction checks represented by component tests. — 2fd14e29
