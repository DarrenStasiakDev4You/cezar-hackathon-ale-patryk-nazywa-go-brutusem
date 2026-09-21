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

> 2026-09-20 validation note: Step 2.2 remained pending because `npm test` failed at
> `packages/web/src/page-layout/registry.test.ts:42`; the same failure reproduced on clean
> `origin/main`, and PR #76 does not touch the registry.
>
> 2026-09-22 resume: #71 reconciled that invariant on `main` (`TaskPage`'s `task.main` zone now
> accepts `TaskMetadata`). Merging `origin/main` into this branch (d92a882a, a merge commit, no
> history rewrite) cleared the blocker without touching this PR's files. Full gate on d92a882a:
> typecheck, `npm test` (474 files / 8474 tests), `test:unit` (36), build and `test:package` (16)
> all exit 0. Earlier `npm test` runs on the same commit hit intermittent timing failures in
> suites this PR does not touch (load-induced `findBy`/5 s timeouts, and an `ENOTEMPTY` teardown
> race in `packages/cezar/src/workflows/auto-resume.test.ts`); each passed on an isolated rerun,
> and the server suite is byte-identical to `origin/main`.

### Phase 1: Production boundary and semantic validation

- [x] 1.1 Connect Task Page layout loading to the live task layout boundary. — 738109b4
- [x] 1.2 Reject current and migrated v3 layouts that omit required Task Page placements. — 738109b4

### Phase 2: Regression coverage and verification

- [x] 2.1 Add production-boundary and missing-required-placement regression tests. — 738109b4
- [x] 2.2 Run the full validation gate, review the diff, and publish the follow-up PR. — d92a882a
