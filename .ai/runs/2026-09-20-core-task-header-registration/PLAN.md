# Core Task Header Registration

Source spec: `.ai/specs/2026-09-19-core-task-header-registration.md`
PR: #54

## Tasks

| Step | Phase | Description | Exec | Status |
| --- | --- | --- | --- | --- |
| 1.1 | 1 | Add explicit core default registration semantics and duplicate-default validation. | inline | done |
| 1.2 | 1 | Resolve fallbacks from `isDefault` and rename the missing-default diagnostics. | inline | done |
| 1.3 | 1 | Add absent-default coverage and repository guidance. | inline | done |
| 2.1 | 2 | Rename the public contract, exports, implementation/model files, ids, and consumers/tests. | inline | done |
| 2.2 | 2 | Document provider-neutral contracts and `core.*` implementations; update boundary assertions. | inline | todo |
| 2.3 | 2 | Run the validation gate, review the complete diff, and resolve findings. | inline | todo |

## Scope

- No commands, events, HTTP routes, persisted data, preference storage, or task-page layout changes.
- The contract is `task.header@1`; core's implementation is `core.task-header`.

## Validation Notes

- Typecheck, unit tests, build, package tests, and focused component/task-header suites pass.
- The full test command has unrelated server-suite failures and an automations route loading failure; these are recorded in the run handoff.
