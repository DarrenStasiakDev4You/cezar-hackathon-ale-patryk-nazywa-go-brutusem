# Final gate — global edit-mode interaction guard (PR #8)

- Covers: Steps 1.1–4.1-review-fix (`b8a5eab`..`f628550`), run on 2026-09-19 by `om-auto-continue-pr-loop`.
- Host: WSL2 Debian, Node 24.14.0. This matters for the server failures below.

## Validation gate (`validation.commands`, in order, on f628550)

| Command | Result | Notes |
|---------|--------|-------|
| `npm run typecheck` | PASS | contract, client, server, web, extension-api |
| `npm test` | FAIL (host-only) | 7475/7483 pass, including the whole web project. The 8 failures are in 3 server files this PR does not touch: `open-in-app.test.ts` (5), `agent-profiles-api.test.ts` (2), `route-parity.test.ts` (1). All 3 files fail the same way on plain `origin/main` (99a6cfb) on this host. With the Windows `/mnt/*` PATH entries removed, every timeout passes; the 2 that still fail assume no real `wslpath` on the machine, and WSL has one. CI runs on ubuntu-latest and is unaffected. |
| `npm run test:unit` | PASS | |
| `npm run build` | PASS | `check:pack ok — 533 files` |
| `npm run test:package` | PASS | 16/16 |

## Integration suite (`npm run test:e2e`, agent-browser)

Result: **no failure attributable to this PR.** The suite is red on this host for both the PR and `main`; see [e2e-comparison.md](final-gate-artifacts/e2e-comparison.md).

- Full suite, PR at 7467f9f: 187 passed, 32 failed, 6 skipped. Full suite, `main`: 184 passed, 35 failed, 6 skipped. 31 failures are shared.
- The one PR-only failure (GitHub issue detail: the Issues tab link is not found) also fails on `main` in the focused re-run. Every line this PR adds returns early while edit mode is off, which it is in every existing spec.
- Focused re-run after the review fix (github, composer, command-palette, new-task, smoke): PR 40/7/1, `main` 41/6/1, with the same failing tests. The one extra PR failure is the same flaky GitHub tab selector.

## UI verification (real Chrome via agent-browser, PR build f628550)

| Scenario | Observed |
|----------|----------|
| Normal mode renders, edit-mode control visible | [01-normal-mode.png](final-gate-artifacts/01-normal-mode.png) |
| Enter edit mode | banner + exit action shown, [02-edit-mode-on.png](final-gate-artifacts/02-edit-mode-on.png) |
| Edit mode: click the Settings nav link | URL unchanged |
| Edit mode: Ctrl+K | palette did not open (`[cmdk-root]` absent) |
| Edit mode: bare `c` (new task) | URL unchanged, [03-edit-mode-after-link-ctrlk-c.png](final-gate-artifacts/03-edit-mode-after-link-ctrlk-c.png) |
| Edit mode on `/new`: type a prompt, press Enter and Ctrl+Enter | no task started (run count 1 → 1), draft kept, URL unchanged, [05-edit-mode-composer-enter-blocked.png](final-gate-artifacts/05-edit-mode-composer-enter-blocked.png) |
| Exit edit mode, then Ctrl+K | palette opens again, [04-normal-mode-palette-works.png](final-gate-artifacts/04-normal-mode-palette-works.png) |
| Normal mode: click the Settings nav link | navigates to `/settings` |

## Style-compliance pass

Skipped: the repo has no design-system compliance skill or style lint beyond typecheck. The diff adds no styles or raw colors (only data attributes and event handlers).

## Review

`om-auto-review-pr --autofix`: one major finding (keyboard activations bypassed the guard), fixed in f628550 with regression tests that fail without the fix. Two minors are left as follow-ups; see the PR review.
