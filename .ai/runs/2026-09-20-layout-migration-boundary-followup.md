# Layout migration boundary follow-up — implementation plan

Goal: make the merged layout migration seam effective in the Task Page and prevent structurally valid but semantically incomplete v3 layouts from removing required core UI.

Scope:

- Connect the existing Task Page layout loader to the production task layout boundary.
- Validate required Task Page placements for current and migrated v3 documents.
- Add regression tests for production loading, fallback, and missing required placements.

Non-goals:

- No new persistence backend, editor, HTTP route, extension-api contract, or implementation-ID migration rules.
- No changes to unrelated layout migration rules beyond the semantic validation required by the Task Page boundary.

Source doc: .ai/specs/2026-09-20-layout-schema-migrations-a.md
Follow-up to: PR #68 (merged layout migration implementation)

Risks:

- A malformed persisted layout must never hide the core task header or composer.
- The production boundary must preserve the existing fallback and safe-diagnostic behavior without mutating stored input.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Production boundary and semantic validation

- [ ] 1.1 Connect Task Page layout loading to the live task layout boundary.
- [ ] 1.2 Reject current and migrated v3 layouts that omit required Task Page placements.

### Phase 2: Regression coverage and verification

- [ ] 2.1 Add production-boundary and missing-required-placement regression tests.
- [ ] 2.2 Run the full validation gate, review the diff, and publish the follow-up PR.
