# Integration Suite Summary

- Command: `npm run test:e2e`
- Environment: repository-managed dry-run app started by `.ai/scripts/e2e.sh` on a temporary local port.
- Result: timed out before completion.
- Failing areas observed: quick-list (3), task-thread (5), project-groups (3), and GitHub (1). The suite did not reach a component-settings scenario.
- Classification: existing application-flow/environment failures; no feature-specific browser evidence was produced.
