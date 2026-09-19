# Implementacja: przesuwanie elementów w layoucie — continuation

Goal: close the remaining interaction gaps in the layout movement spec on top of the
implementation already present in `main`: drag only from an explicit edit-mode handle,
keep ordinary elements inside their menu, and model the complete sidebar block as the
cross-side movable group.

Scope: `packages/web/src/components/layout-element.tsx`,
`packages/web/src/components/layout-sortable-surface.tsx`, `packages/web/src/components/app-shell.tsx`,
`packages/web/src/styles/index.css`, and focused regression tests.

Non-goals: persistence, HTTP/CLI, extension contracts, resize, deletion, new dependencies,
or rewriting the already-merged layout registry.

Source doc: `.ai/specs/2026-09-19-przesuwanie-elementow.md`

## Implementation Plan

### Phase 1: explicit drag affordance

- [x] 1.1 Attach dnd-kit activation listeners and attributes to the visible handle only; preserve the wrapper as the sortable node. — e9a63039
- [x] 1.2 Add regression coverage proving normal mode has no handle and edit-mode activation is handle-scoped and keyboard accessible. — e9a63039

### Phase 2: constrained movement

- [x] 2.1 Treat the shell sidebar as the movable group and reject ordinary widget drops across parent/menu boundaries. — e9a63039
- [x] 2.2 Add regression coverage for allowed group movement, rejected widget cross-parent drops, and unchanged click/guard behavior. — e9a63039

### Phase 3: verification and handoff

- [ ] 3.1 Run the configured full validation gate and record any pre-existing or platform-specific failures.
- [ ] 3.2 Run authoritative review/autofix and browser QA for the user-facing edit-mode flow.

## Risks

- The handle must retain a minimum 44px target and not steal ordinary widget clicks or touch scrolling.
- The shell movement must continue to remove the source column and expand the main region without introducing persistence.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: explicit drag affordance

- [x] 1.1 Attach dnd-kit activation listeners and attributes to the visible handle only; preserve the wrapper as the sortable node. — e9a63039
- [x] 1.2 Add regression coverage proving normal mode has no handle and edit-mode activation is handle-scoped and keyboard accessible. — e9a63039

### Phase 2: constrained movement

- [x] 2.1 Treat the shell sidebar as the movable group and reject ordinary widget drops across parent/menu boundaries. — e9a63039
- [x] 2.2 Add regression coverage for allowed group movement, rejected widget cross-parent drops, and unchanged click/guard behavior. — e9a63039

### Phase 3: verification and handoff

- [ ] 3.1 Run the configured full validation gate and record any pre-existing or platform-specific failures.
- [ ] 3.2 Run authoritative review/autofix and browser QA for the user-facing edit-mode flow.
