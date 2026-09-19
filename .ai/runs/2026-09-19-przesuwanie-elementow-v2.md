# Implementacja: przesuwanie elementów w layoucie — continuation

Goal: close the remaining interaction gaps in the layout movement spec on top of the
implementation already present in `main`: drag only from an explicit edit-mode handle,
keep ordinary elements inside their menu, and model the complete sidebar block as the
cross-side movable group.

Scope: `packages/web/src/components/layout-element.tsx`,
`packages/web/src/components/layout-sortable-surface.tsx`, `packages/web/src/components/app-shell.tsx`,
`packages/web/src/components/layout-context-menu.tsx`, `packages/web/src/lib/layout-elements.ts`,
`packages/web/src/styles/index.css`, and focused regression tests.

Non-goals: persistence, HTTP/CLI, extension contracts, resize, new dependencies, or rewriting
the already-merged layout registry beyond the explicit subtree removal operation needed by the
edit-mode delete action.

Source doc: `.ai/specs/2026-09-19-przesuwanie-elementow.md`

## Implementation Plan

### Phase 1: explicit drag affordance

- [x] 1.1 Attach dnd-kit activation listeners and attributes to the visible handle only; preserve the wrapper as the sortable node. — e9a63039
- [x] 1.2 Add regression coverage proving normal mode has no handle and edit-mode activation is handle-scoped and keyboard accessible. — e9a63039

### Phase 2: constrained movement

- [x] 2.1 Treat the shell sidebar as the movable group and reject ordinary widget drops across parent/menu boundaries. — e9a63039
- [x] 2.2 Add regression coverage for allowed group movement, rejected widget cross-parent drops, and unchanged click/guard behavior. — e9a63039
- [x] 2.3 Keep the shell sidebar and main content as root siblings so moving the menu to the other side never nests it inside the content region. — 54a3d00a
- [x] 2.4 Remove a selected layout element or complete group subtree atomically from the live registry and DOM projection. — 54a3d00a
- [x] 2.5 Keep edit mode visually legible by removing the global grayscale/opacity wash from the layout surface. — 54a3d00a

### Phase 3: verification and handoff

- [x] 3.1 Run the configured full validation gate and record any pre-existing or platform-specific failures. — e9a63039
- [ ] 3.2 Run authoritative review/autofix and browser QA for the user-facing edit-mode flow. — 25c62604
- [x] Post-review regression coverage: prove moving a group preserves its children and their parent links. — 4b77649e

## Validation notes

- `npm run typecheck`: passed.
- Focused web validation: passed — layout sortable surface and layout element tests, 5 tests.
- `npm test`: stopped after the repository-wide suite entered repeated unrelated server/workspace timeout and environment failures; the changed web tests remained green.
- `npm run test:unit`: failed in two unrelated existing tests (`skills-remote.test.ts`, `test-env-launcher.test.ts`).
- `npm run build`: server and web builds passed; the configured `check:pack` sub-step failed because this environment denies the child Node `spawnSync` with `EPERM`.
- `npm run test:package`: one inline-contract test passed; four existing package CLI/release tests failed under the same process/platform constraints.
- Browser QA: not exercised. The shared descriptor points to a stopped Windows-only app/browser from this Linux environment, and `http://127.0.0.1:59974/api/v1/health` is unreachable.

### Continuation attempt — 2026-09-19

- `npm run typecheck`: passed.
- Focused layout tests: passed — 2 files, 5 tests.
- `npm test`: rerun; repeated unrelated server/workspace failures and timeouts persisted, so the run was stopped after the failure pattern was established.
- `npm run test:unit`: failed in the existing `skills-remote.test.ts` and `test-env-launcher.test.ts` cases.
- `npm run build`: server/web builds passed; `check:pack` remained blocked by child Node `spawnSync ... EPERM`.
- `npm run test:package`: 1 passed, 4 existing CLI/release tests failed.
- Browser QA: partial evidence captured from the PR build. Edit mode rendered accessible drag handles and normal mode rendered none; a seeded populated layout was unavailable, so pointer/keyboard reorder, cancellation, cross-parent rejection, and mobile behavior remain unexercised. Evidence is posted on PR #27.
- Authoritative review: changes requested because the configured full validation gate is not green; no additional code finding was identified.

### Continuation attempt — 2026-09-19 (resume)

- Focused layout regression tests: passed — 3 files, 16 tests.
- `npm run typecheck`: passed.
- `npm test`: stopped after 30 seconds with the established unrelated server/workspace failures and timeouts.
- `npm run test:unit`: failed in the existing `skills-remote.test.ts` and `test-env-launcher.test.ts` cases.
- `npm run build`: server/web builds passed; `check:pack` failed because the environment denies child Node `spawnSync` with `EPERM`.
- `npm run test:package`: 1 passed, 4 existing CLI/release tests failed.
- Browser QA and authoritative review remain the outstanding 3.2 handoff because the seeded interaction matrix is still unavailable and the full gate remains non-green.

### User-reported regression fix — 2026-09-19

- Focused web tests: passed — 4 files, 105 tests, including individual/group deletion and flat shell movement.
- `npm run typecheck:web`: passed after the fix.
- Removed the edit-mode surface wash, made registered deletion update the layout registry atomically,
  and removed the shell drop zone that nested the sidebar inside main content.

### Environment-fix continuation — 2026-09-19

- Added deterministic WSL path-test isolation, a Node 25/jsdom localStorage shim, and explicit headroom for the two suites that exceed Vitest's default timeout only under the full parallel gate. — d558a5ce
- `npm test`: passed — 416 files, 7715 tests.
- `npm run typecheck`: passed.
- `npm run build`: passed, including `check:pack` (534 files; 89 web assets).
- `npm run test:unit`: passed — 36 tests.
- `npm run test:package`: passed — 16 tests.
- Focused layout regression tests: passed — 3 files, 16 tests.
- The only remaining handoff is 3.2: seeded browser QA and authoritative review for the edit-mode interaction matrix.

### Resume result — 2026-09-19

- Full configured gate passed in order: `npm run typecheck`, `npm test` (416 files, 7717 tests),
  `npm run test:unit` (36 tests), `npm run build` including `check:pack`, and `npm run test:package` (16 tests).
- Focused regression tests passed: 4 web files, 105 tests.
- The review found no actionable code finding. GitHub rejected formal approval because the current
  account is the PR author; the review report is posted as a PR comment instead.
- Browser evidence passed for readable edit mode, accessible handles, sidebar movement to the other
  side, and exit behavior. Context-menu deletion and populated keyboard/touch/mobile coverage remain
  unexercised; no QA approval is claimed. Evidence is posted on PR #27.

### Review re-run — 2026-09-19

- Focused layout regression tests passed — 4 files, 103 tests.
- `npm run typecheck`, `npm run build`, and `npm run test:package` passed.
- `npm test` remains blocked by unrelated parallel web/server timeouts (44 failures in the
  repository-wide run; 7675/7719 tests passed).
- `npm run test:unit` remains blocked by the existing test-environment reuse assertion
  (`test-env-launcher.test.ts`, expected `TEST_ENV_REUSED=1`, received `0`).
- Re-review found no additional code finding; approval is withheld until the configured gate is
  green. Browser QA remains partial and has no QA approval.

### Container drag stability fix — 2026-09-19

- Shell containers now use `useDraggable` + `useDroppable`; ordinary layout widgets retain
  `useSortable`.
- The active container keeps a static, hidden source in the layout, while only `DragOverlay` moves;
  the drop indicator is fixed-positioned and cannot change grid/flex dimensions.
- Added a regression test for active container drags, sibling transform isolation, and Escape cancel.
- Focused layout tests: passed — 5 tests; web typecheck: passed.
- Full configured gate rerun after dependency setup: passed — `npm run typecheck`, `npm test` (416
  files, 7719 tests), `npm run test:unit` (36), `npm run build`/`check:pack`, and
  `npm run test:package` (16).

## Risks

- The handle must retain a minimum 44px target and not steal ordinary widget clicks or touch scrolling.
- The shell movement must continue to remove the source column and expand the main region without introducing persistence.
- Deletion must remove a single registered element or an entire registered group subtree without
  leaving stale registry entries or React DOM nodes.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: explicit drag affordance

- [x] 1.1 Attach dnd-kit activation listeners and attributes to the visible handle only; preserve the wrapper as the sortable node. — e9a63039
- [x] 1.2 Add regression coverage proving normal mode has no handle and edit-mode activation is handle-scoped and keyboard accessible. — e9a63039

### Phase 2: constrained movement

- [x] 2.1 Treat the shell sidebar as the movable group and reject ordinary widget drops across parent/menu boundaries. — e9a63039
- [x] 2.2 Add regression coverage for allowed group movement, rejected widget cross-parent drops, and unchanged click/guard behavior. — e9a63039
- [x] 2.3 Keep the shell sidebar and main content as root siblings so moving the menu to the other side never nests it inside the content region. — 54a3d00a
- [x] 2.4 Remove a selected layout element or complete group subtree atomically from the live registry and DOM projection. — 54a3d00a
- [x] 2.5 Keep edit mode visually legible by removing the global grayscale/opacity wash from the layout surface. — 54a3d00a

### Phase 3: verification and handoff

- [x] 3.1 Run the configured full validation gate and record any pre-existing or platform-specific failures. — e9a63039
- [ ] 3.2 Run authoritative review/autofix and browser QA for the user-facing edit-mode flow.
