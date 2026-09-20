# Layout Schema migrations — A implementation plan

Goal: make persisted custom layouts survive LayoutSchema updates through deterministic `v1 → v2 → v3` migrations, and make every failed migration render the core/default layout instead of a blank page.

Scope:

- Add the framework-neutral LayoutSchema v1 model and v2/v3 validators needed by the migration seam.
- Add pure, atomic migration rules for renamed zones, removed optional placements, split placements and changed required components.
- Add a load-boundary result that preserves raw input, returns diagnostics and selects the default layout on failure.
- Add focused unit/component tests for valid migrations, invalid/unknown versions, idempotency, immutability, resolver fallback and the no-blank-page path.

Non-goals:

- No HTTP route, extension-api export, layout editor or new persistence backend.
- No runtime React/DOM objects or arbitrary props in the serialized model.
- No implementation of the Phase 3 persistence handoff from the spec.

Source doc: .ai/specs/2026-09-20-layout-schema-migrations-a.md
Spec PR: #1037 (https://github.com/open-mercato/cezar/pull/1037)

Risks:

- A partial split or required-component removal could silently lose user layout intent; validators, immutable transforms and fail-closed fallback guard this boundary.
- The base branch does not yet contain the prerequisite v1 LayoutSchema module, so the implementation must establish that seam in the web package without widening it into a public package contract.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Pure schema and migration engine

- [x] 1.1 Add the plain-data LayoutSchema v1/v2/v3 types, validators, serializer and typed load errors. — 67b3bdcf
- [x] 1.2 Implement atomic `v1 → v2` and `v2 → v3` migration rules with deterministic change diagnostics. — 67b3bdcf
- [x] 1.3 Add fixtures/tests for rename, remove, split, required replacement, missing replacement, collision and unknown version. — 67b3bdcf
- [x] 1.4 Prove idempotency, input immutability and validation after every migration edge. — 67b3bdcf

### Phase 2: Load boundary and safe fallback

- [x] 2.1 Add a pure load result that distinguishes current, migrated and fallback layouts while retaining raw input. — 3026a749
- [x] 2.2 Connect the loader to the default core layout without throwing into the root React tree. — 3026a749
- [x] 2.3 Add regression coverage for optional resolver fallback and required-component failure to the full default. — 67b3bdcf
- [ ] 2.4 Run the repository validation gate, review the diff, update this plan and publish the implementation PR.
