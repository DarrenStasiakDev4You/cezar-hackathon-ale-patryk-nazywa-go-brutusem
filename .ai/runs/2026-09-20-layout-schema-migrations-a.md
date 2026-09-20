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
Spec PR: #65 (https://github.com/DarrenStasiakDev4You/cezar-hackathon-ale-patryk-nazywa-go-brutusem/pull/65)

Risks:

- A partial split or required-component removal could silently lose user layout intent; validators, immutable transforms and fail-closed fallback guard this boundary.
- The v1 LayoutSchema is owned by `@open-mercato/cezar-extension-api`; the web migration seam must consume it without duplicating its wire shape or importing runtime component implementations.

## Validation record

- `npm run typecheck` — passed.
- Focused layout schema, migration and Task Page boundary tests — 18 passed.
- `npm run test:unit` — passed (36 tests).
- `npm run build` — passed, including the web build and package check.
- `npm run test:package` — passed (16 tests).
- `npm test` — passed: 452 files and 8,272 tests passed after updating the stale Jira example contract and giving environment-sensitive server tests explicit budgets.

## Progress

PR: #68 (https://github.com/DarrenStasiakDev4You/cezar-hackathon-ale-patryk-nazywa-go-brutusem/pull/68)

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
- [x] Follow-up: align the migration seam with the shipped extension-api v1 contract and keep migration rules contract-based. — bbb0abb0
- [x] 2.4 Run the repository validation gate, review the diff, update this plan and publish the implementation PR. — 816c05d3

> Resume note: the full validation gate, diff review and implementation fixes ran on 2026-09-20. The Jira example now declares its component permission and compatibility result fields; slow server tests have explicit timeouts for the repository's concurrent test load.
