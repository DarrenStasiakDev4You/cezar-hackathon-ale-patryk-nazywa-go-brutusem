# Create Layout Schema — implementation plan

Goal: add the node-free, versioned `LayoutSchema` contract and the current Task Page's default
layout data without changing rendering, persistence, drag-and-drop, or implementation selection.

Source doc: `.ai/specs/2026-09-19-create-layout-schema.md`

## Scope

- Add the public layout model, v1 parser, typed validation errors, and deterministic JSON serializer
  to `packages/extension-api`.
- Re-export the model only through the extension-api entry point and prove its Node/DOM/React-free
  boundary.
- Add `defaultTaskPageLayout` in the web Task Page area using the existing header and composer
  contract ids, with plain-data and round-trip tests.
- Document the distinction between serializable layout intent and the runtime layout registry.

## Non-goals

- No HTTP route, persistence, migration, renderer, resolver, DnD behavior, edit-mode wiring, or
  implementation override.
- No visual or behavioral change to the existing Task Page.

## Risks

- This is a new public persisted-contract seam, so validation must reject ambiguous or runtime-only
  data atomically and preserve explicit schema/contract versioning.
- The default layout must remain data-only and must not become a second runtime registry.

## Implementation Plan

### Phase 1: Pure schema

- [ ] 1.1 Add the node-free layout types, v1 constant, typed parser errors, and public re-exports.
- [ ] 1.2 Implement strict v1 validation for required fields, typed layout hints, duplicate ids,
  unsupported fields, unsupported versions, and error paths.
- [ ] 1.3 Implement deterministic JSON serialization and valid-model round trips.

### Phase 2: Default Task Page data

- [ ] 2.1 Add the immutable default Task Page layout for header, composer, and empty sidebar.
- [ ] 2.2 Add boundary tests proving the default is JSON-safe, contract-backed, and free of runtime
  implementation/settings data.
- [ ] 2.3 Document the intent/runtime-registry boundary and verify the full repository gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Pure schema

- [ ] 1.1 Add the node-free layout types, v1 constant, typed parser errors, and public re-exports.
- [ ] 1.2 Implement strict v1 validation for required fields, typed layout hints, duplicate ids, unsupported fields, unsupported versions, and error paths.
- [ ] 1.3 Implement deterministic JSON serialization and valid-model round trips.

### Phase 2: Default Task Page data

- [ ] 2.1 Add the immutable default Task Page layout for header, composer, and empty sidebar.
- [ ] 2.2 Add boundary tests proving the default is JSON-safe, contract-backed, and free of runtime implementation/settings data.
- [ ] 2.3 Document the intent/runtime-registry boundary and verify the full repository gate.
