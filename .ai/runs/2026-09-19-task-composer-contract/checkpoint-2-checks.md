# Checkpoint 2 — Steps 1.5..2.3

Date: 2026-09-19 UTC

## Covered commits

- `1.5` `17a825df` — task-thread host slot and core registration
- `1.6` `9967fd8d` — boundary tests and repository guidance
- `2.1` `2ed893fe` — optional capabilities and shell fallbacks
- `2.2` `85f97920` — plain external implementation and boundary tests
- `2.3` `6401ead5` — real registry/task-page external implementation proof

## Validation

- PASS — `npm run typecheck` after the checkpoint changes.
- PASS — focused extension-api, registry, composer, controller-adjacent, draft, picker and
  external-proof tests: 12 files, 158 tests before the final hardening edits; the post-hardening
  focused slice is 11 files, 108 tests.
- PASS — the external task-page proof activates the plain implementation through the real registry,
  types a reply and sends it through the hosted slot.
- PASS — focused browser composer run: 7 of 8 tests passed, including the live waiting-state
  composer, skill completion, send/reopen flow, dictation overlay and closed-session authoring.
  The remaining assertion expects a user bubble without its rendered timestamp.
- FAIL (pre-existing/broad-suite drift) — `npm run test:e2e`: 32 failures in 15 files, 187 passed and
  6 skipped. Failures span agents dock, settings, quick-list, task thread, scroll, queued stack,
  project groups and unrelated screens. The focused composer run reproduces only the timestamp
  assertion; the other full-suite failure is a socket close during shared-environment execution.

## Final gate follow-up

- PASS — isolated changed-area regression slice: 4 files, 104 tests.
- PASS — `npm run test:unit`: 36/36 after cleaning the test environment left by the first attempt.
- PASS — `npm run build` and `npm run test:package`: 16/16 package tests.
- FAIL — `npm test`: 8,108/8,157 tests passed; 49 failures/timeouts in 28 files under the full
  suite. The changed-area slice is green; the failure pattern is broad and dominated by timeouts.

## UI evidence

The live browser run captured:

- `checkpoint-2-artifacts/composer-idle.png`
- `checkpoint-2-artifacts/composer-autocomplete.png`

The idle screenshot shows the hosted task composer in a waiting thread with the reply input,
attachment control, dictation control and send control. The autocomplete screenshot covers the
`/` completion menu.

## Result

PASS for Steps 1.5..2.3. The implementation proof and focused browser evidence are present. The
full E2E suite remains red on unrelated baseline drift and one stale timestamp assertion; the
configured final gate is still required after Step 2.4.
