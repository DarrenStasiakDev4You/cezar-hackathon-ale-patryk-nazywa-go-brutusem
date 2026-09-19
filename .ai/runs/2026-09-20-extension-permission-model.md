# Extension Permission Model

Goal: implement the requested/granted extension permission model, enforce it at the guarded
`ExtensionContext`, add the notification API, and document the resulting contract.

Scope:
- Extend `packages/extension-api` with permissions, validation, context state, errors, and notifications.
- Enforce permissions in `packages/web/src/extensions` before extension activation and service calls.
- Wire the notification service and warning toast tone.
- Add focused contract, registry, host, service, and UI tests plus the required documentation.

Non-goals:
- No installer, persisted grants, runtime permission prompts, sandbox, or privileged APIs.
- No server/API route changes.

Source doc: `.ai/specs/2026-09-19-extension-permission-model.md`

## Implementation Plan

### Phase 1: Contract

1. Add the permission vocabulary, manifest validation, frozen manifest permissions, and tests.
2. Add `permission-denied` and `context.permissions`, update fixtures and example, and test the public contract.
3. Add the notifications contract and update fake contexts and package exports.

### Phase 2: Host enforcement

4. Add the host permission vocabulary, activation compatibility checks, grants, and denial error.
5. Add guarded services with liveness-first denied stubs and own-command namespace handling.
6. Wire the registry to grants, activation checks, guarded contexts, effective permissions, and record metadata.
7. Apply built-in grants and expand host/registry regression coverage, including deny-all behavior.

### Phase 3: Documentation

8. Document permissions, grants, fail-closed activation, reserved network access, and errors in the extension API README.
9. Update repository extension architecture guidance and registry module documentation.

### Phase 4: Notifications

10. Add notification service behavior, validation, rate limiting, and tests.
11. Add the warning toast tone and preserve existing toast behavior with UI tests.
12. Wire notifications through services, context, permission tables, and guarded access.
13. Add host/registry notification integration and deny-all coverage.
14. Complete final documentation and examples for notifications and the full permission model.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Contract

- [ ] 1.1 Add permission vocabulary, manifest validation, frozen permissions, and tests
- [ ] 1.2 Add permission-denied, context.permissions, fixtures, example, and contract tests
- [ ] 1.3 Add notifications contract and fake contexts

### Phase 2: Host enforcement

- [ ] 2.1 Add host permission checks, grants, and denial error
- [ ] 2.2 Add guarded services and own-command namespace handling
- [ ] 2.3 Wire registry grants, activation checks, guarded contexts, and records
- [ ] 2.4 Apply built-in grants and host/registry regression coverage

### Phase 3: Documentation

- [ ] 3.1 Document the permission model in the extension API README
- [ ] 3.2 Update repository architecture and registry documentation

### Phase 4: Notifications

- [ ] 4.1 Add notification service behavior, validation, rate limiting, and tests
- [ ] 4.2 Add warning toast tone and UI tests
- [ ] 4.3 Wire notification services and permission guards
- [ ] 4.4 Add host/registry notification coverage
- [ ] 4.5 Complete notification docs and examples
