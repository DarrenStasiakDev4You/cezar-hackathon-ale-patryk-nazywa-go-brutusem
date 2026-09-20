# Final Gate Checks

**Run:** `2026-09-20-task-metadata-contract`
**Branch:** `feat/task-metadata-contract`
**PR:** #55
**Recorded:** 2026-09-20T03:03:30Z
**Result:** BLOCKED; PR remains `Status: in-progress` and draft.

## Configured Gate

The configured commands are defined as `sh .ai/scripts/in-docker.sh <command>`. The
wrapper is absent from the base revision and from this implementation worktree, so
the exact Docker wrapper gate could not run. Native equivalents were run in the
configured order; this limitation is not treated as a pass.

The exact configured command sequence was retried on this resume at PR head
`be85ed1b`. All five commands exited `2` before invoking their inner command
because the wrapper path does not exist. No implementation files changed, so the
prior native results and integration evidence remain the applicable changed-head
evidence.

| Command | Result | Evidence |
|---|---|---|
| `sh .ai/scripts/in-docker.sh npm run typecheck` | NOT RUN: wrapper absent; native equivalent PASS | `npm run typecheck` |
| `sh .ai/scripts/in-docker.sh npm test` | NOT RUN: wrapper absent; native equivalent FAIL | 2 fresh native runs, 8 then 12 unrelated failures |
| `sh .ai/scripts/in-docker.sh npm run test:unit` | NOT RUN: wrapper absent; native equivalent PASS | 36/36 |
| `sh .ai/scripts/in-docker.sh npm run build` | NOT RUN: wrapper absent; native equivalent PASS | includes `check:pack` |
| `sh .ai/scripts/in-docker.sh npm run test:package` | NOT RUN: wrapper absent; native equivalent PASS | 16/16 |

The failing native `npm test` runs did not fail changed-area metadata tests. The
failures were existing/environment-sensitive server, workflow, and web tests,
including `agent-profiles-api.test.ts`, `open-in-app.test.ts`,
`route-parity.test.ts`, `workflows/system-prompt.test.ts`, and unrelated settings /
automation suites. The earlier recorded baseline identified seven server timeout
failures; these fresh reruns were noisier under concurrent worktree load (8 and 12
failures respectively). The gate remains red and no unrelated tests were changed.

## Current Resume Attempt

At `2026-09-20T03:57:08Z`, the exact configured command sequence was retried at
PR head `1ef676b4`. Each command exited `2` before its inner command because
`.ai/scripts/in-docker.sh` is still absent. This resume added no implementation
changes, so the previously recorded native and integration evidence remains valid;
the configured gate is still blocked.

## Integration And UI

`npm run test:e2e` was run through the repository's `om-integration-tests` path with
a fresh `CEZ_DRY_RUN=1` app. The run timed out at 600 seconds after broad unrelated
E2E failures; the task-thread suite had five stale/unrelated fixture or behavior
failures. The app was stopped afterward. Existing PR UI evidence remains partial:
desktop metadata rendering and the 390x844 details toggle passed; alternate
implementation, error, permission, loading, long-content, and replacement states
were not available in the dry-run fixture. No `qa-approved` or `qa-self-verified`
label was added.

## Review And Style

The prior authoritative `om-auto-review-pr --autofix` result at the unchanged head
requested changes solely because the configured gate was red and reported no
change-specific correctness, security, compatibility, or coverage findings. The
final review-state re-entry found no new commit, so no duplicate review or autofix
was run.

No repository style-compliance command or dedicated design-system lint is
configured; the style pass is recorded as skipped for that reason.

## Decision

All implementation Tasks are done, but the configured final gate is not green. Keep
the PR draft, keep `Status: in-progress`, preserve `needs-qa`, and release the
automation lock. Re-enter with `om-auto-continue-pr-loop 55` after the gate blocker
is resolved or a reviewer provides a new commit to review.
