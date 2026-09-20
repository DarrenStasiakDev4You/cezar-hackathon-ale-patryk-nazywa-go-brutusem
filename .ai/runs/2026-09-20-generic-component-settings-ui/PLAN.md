# Generic Component Settings UI

## Goal

Implement the generic Components settings surface described by the source spec, including the
public descriptor vocabulary, host-side validation, widened persistence, generated controls,
visibility rules, a test-only configurable-header extension, end-to-end coverage, and durable docs.

## Scope

- Extend `@open-mercato/cezar-extension-api` with boolean/string/number/select setting descriptors.
- Revalidate and canonicalize settings in the component registry and make per-implementation writes atomic.
- Widen the protected UI-state contract and settings store for scalar values.
- Add the project-scoped Components settings section with autosave, reset, accessibility, and failure states.
- Add a test-only fixture and integration/bundle guards, then update public documentation.

## Non-goals

- No custom extension-owned settings renderer API.
- No new HTTP route, event topic, preference layer, or production demo extension.
- No browser E2E fixture opt-in; that is a follow-up after the implementation-preference flow is available.

## Risks

- Extension settings cross a package boundary, so host-side bounds and canonicalization must remain authoritative.
- UI-state writes must preserve concurrent fields of one implementation and existing unknown keys.
- The fixture must never enter the release bundle.

Source doc: `.ai/specs/2026-09-20-generic-component-settings-ui.md`

## Tasks

> Authoritative status table. `Status` is `todo` or `done`; the first non-`done` row is the resume point.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add the descriptors and helpers | inline | done | cbe3df32 |
| 1 | 1.2 | Teach `parse()` the new types | inline | done | cbe3df32 |
| 1 | 1.3 | Re-derive and canonicalize host-side | inline | done | 7ae6c7d5 |
| 1 | 1.4 | Stop a bad definition from costing the component | inline | done | 7ae6c7d5 |
| 2 | 2.1 | Widen the contract schema | inline | done | 2cb07a0f |
| 2 | 2.2 | Widen the store, add atomic updates, and deduplicate reads | inline | done | 2cb07a0f |
| 2 | 2.3 | Prove reload persistence for the new types | inline | done | 2cb07a0f |
| 3 | 3.1 | Build the renderer table | inline | done | c1b68fd1 |
| 3 | 3.2 | Build the Components settings section | inline | done | c1b68fd1 |
| 3 | 3.3 | Show the entry only when something is configurable | inline | done | c1b68fd1 |
| 3 | 3.4 | Wire writes, resets, and failures | inline | done | c1b68fd1 |
| 4 | 4.1 | Add the test-fixture extension | inline | done | c1b68fd1 |
| 4 | 4.2 | Prove the Definition of Done end to end | inline | todo | - |
| 4 | 4.3 | Document the durable contract | inline | todo | - |
| 4 | 4.4 | Run the full validation gate | inline | todo | - |
