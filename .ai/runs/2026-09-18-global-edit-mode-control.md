# Implement global edit mode control

Source doc: `.ai/specs/2026-09-18-global-edit-mode-control.md`

## Goal

Implement the shell-level mechanism for entering and leaving edit mode in the widget view without implementing widget editing itself.

## Scope

- Add `EditModeControl` to the global `AppShell`.
- Use a layout-editing icon and the combined “Edit mode” control in the top-right area.
- Add global `editMode` state, a full-width top banner, safe-area/reserved layout space, and responsive Light/Dark styling.
- Dim the layout while active, restore the hovered/focused element visually without changing geometry, and block navigation while edit mode is active.
- Keep the control and “Exit edit mode” action interactive.

## Non-goals

- Editing, moving, resizing, deleting, or persisting widgets.
- New API, storage, permissions, or synchronization.
- Modal or toast confirmation.

## Implementation Plan

### Phase 1: Shell control and state

- [ ] 1.1 Add the `EditModeControl` component with the layout icon, “Edit mode” label, global `editMode` state, and full-width “You are in edit mode” banner.
- [ ] 1.2 Mount the control once in `AppShell`, hide the entry control while active, and keep “Exit edit mode” as the only active-mode action.

### Phase 2: Visual and interaction behavior

- [ ] 2.1 Add safe-area-aware positioning, z-index layering, reserved top-right space, and responsive desktop/tablet/mobile layout behavior.
- [ ] 2.2 Add active-mode dimming, hover/focus reveal without layout shift, and navigation blocking that does not disable the edit-mode controls.

### Phase 3: Verification

- [ ] 3.1 Add component and shell tests for enter/exit, no modal, banner visibility, control layering, and navigation blocking.
- [ ] 3.2 Run the complete validation gate and inspect the rendered UI in Light/Dark and responsive states.

## Risks

- Global fixed UI can conflict with sticky route headers and mobile safe areas; keep it shell-owned and reserve layout space explicitly.
- Applying a visual dimmer to parent containers can prevent an individual child from restoring its appearance; apply dimming at the element level where hover/focus reveal is required.
- Navigation blocking must be scoped to active edit mode and must not block the edit control or exit action.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shell control and state

- [ ] 1.1 Add the `EditModeControl` component with the layout icon, “Edit mode” label, global `editMode` state, and full-width “You are in edit mode” banner.
- [ ] 1.2 Mount the control once in `AppShell`, hide the entry control while active, and keep “Exit edit mode” as the only active-mode action.

### Phase 2: Visual and interaction behavior

- [ ] 2.1 Add safe-area-aware positioning, z-index layering, reserved top-right space, and responsive desktop/tablet/mobile layout behavior.
- [ ] 2.2 Add active-mode dimming, hover/focus reveal without layout shift, and navigation blocking that does not disable the edit-mode controls.

### Phase 3: Verification

- [ ] 3.1 Add component and shell tests for enter/exit, no modal, banner visibility, control layering, and navigation blocking.
- [ ] 3.2 Run the complete validation gate and inspect the rendered UI in Light/Dark and responsive states.

