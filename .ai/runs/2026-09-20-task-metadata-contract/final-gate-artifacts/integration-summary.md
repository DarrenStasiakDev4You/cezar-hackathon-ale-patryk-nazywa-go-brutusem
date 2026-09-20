# Integration Run Summary

- Command: `npm run test:e2e`
- Environment: fresh native repository test environment, `CEZ_DRY_RUN=1`, `agent-browser 0.38.1`
- Result: timed out at 600 seconds; the suite reported broad existing failures before timeout.
- Changed-area evidence: the prior PR QA comment shows desktop metadata and the 390x844 details toggle passing.
- Cleanup: the test environment started by this run was stopped; no worktree was created or removed by this resume.
