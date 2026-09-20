# Execution Plan: layout-renderer

**Goal:** Render the schema-backed Task Page header and composer from an immutable, validated v1
layout snapshot while preserving the existing task shell, transcript, dock, actions and component
host behavior.

**Scope:** Add the web-side layout snapshot lifecycle, typed Task Page placement adapter and
schema-order renderer; mount the existing `TaskPage` catalog at the task consumer; replace only the
hardcoded header-main and composer host calls; add focused unit, boundary and route regression tests;
update the repository guidance for the new ownership boundary.

**Non-goals:** No layout schema or extension API changes, persistence or migrations, HTTP routes,
page-registration API, extension-owned pages/zones, DOM edit-mode registry changes, implementation
selection outside `ComponentHost`, transcript/footer/action-shell migration, or automatic layout
repair.

**Risks:** The task route has several shell-owned behaviors coupled to the current header/composer
mounts. The adapter must keep typed props and intents in the route domain, while the generic renderer
stays contract-agnostic and follows schema order rather than catalog order. Invalid supplied layouts
must never replace the last valid snapshot.

**Source doc:** `.ai/specs/2026-09-20-layout-renderer.md`

## Implementation Plan

### Phase 1: Schema-to-runtime adapter

- Define the snapshot, binding, context and bounded issue types without widening `LayoutSchema`.
- Implement default initialization, strict raw parsing boundary and atomic last-valid replacement.
- Adapt Task Page zones and exact served contracts to typed header/composer bindings with stable subjects.

### Phase 2: Generic schema renderer

- Walk normalized schema zone and placement order through the existing page registry admission rules.
- Keep required-zone fallback, optional-zone omission, cardinality, host loading and host failure ownership.
- Add boundary coverage preventing concrete task imports, implementation selection and DOM registry use.

### Phase 3: Task Page consumer migration

- Provide the page-layout registry/catalog at the route boundary using the existing component registry.
- Replace only the direct header-main and composer host calls with adapter bindings and preserve all shell behavior.
- Prove reordered schema output, extension host compatibility/fallback, no duplicate rendering and desktop/mobile route regressions.

### Phase 4: Handoff documentation

- Update repository guidance to document schema layout versus DOM edit-mode ownership and validation/evidence limits.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append — <commit sha> when a step lands. Do not rename step titles.

### Phase 1: Schema-to-runtime adapter

- [x] 1.1 Define the snapshot, binding, context and bounded issue types — b93fc889
- [x] 1.2 Implement default initialization and atomic last-valid replacement — b93fc889
- [x] 1.3 Adapt Task Page zones and exact served contracts — b93fc889

### Phase 2: Generic schema renderer

- [x] 2.1 Walk normalized schema order through page admission and ComponentHost — b93fc889
- [x] 2.2 Define malformed, missing and visual fallback policy — b93fc889
- [x] 2.3 Add architectural boundary coverage — b93fc889

### Phase 3: Task Page consumer migration

- [x] 3.1 Mount the page-layout provider and TaskPage catalog at the task consumer — b93fc889
- [x] 3.2 Replace only schema-backed hardcoded slots — b93fc889
- [x] 3.3 Prove route order, extension fallback and shell regressions — b93fc889

### Phase 4: Handoff documentation

- [x] 4.1 Update repository layout-renderer ownership guidance — b93fc889
