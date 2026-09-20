# Core Task Header Registration

Goal: make the task header contract provider-neutral and make its core implementation's default role an explicit registry property, without changing the rendered task page.

Source doc: `.ai/specs/2026-09-19-core-task-header-registration.md`

## Scope

- Record exactly one core default per served component contract and expose that fact on registrations.
- Resolve fallbacks from the declared default rather than an id or provenance convention.
- Rename the task header contract, core implementation, public exports, and related files and tests.
- Document the provider-neutral component naming and lifecycle rule.

Non-goals: changing commands or events, adding preference storage, changing HTTP or persisted data, changing the task-page layout, or adding a settings UI.

## Implementation Plan

### Phase 1: Declared defaults

- [x] 1.1 Add core registration options, `isDefault`, duplicate-default validation, and register the core default. — 18aa6da4
- [x] 1.2 Resolve fallbacks from `isDefault`, rename the missing-default check and diagnostics, and add regression coverage. — 18aa6da4
- [x] 1.3 Add the task-thread guard for an absent default and update repository guidance. — 18aa6da4

### Phase 2: Provider-neutral task header

- [x] 2.1 Rename the public contract, exports, core implementation, adapter files, ids, and all affected consumers/tests.
- [x] 2.2 Add the provider-neutral/core namespace rule to `AGENTS.md` and the extension API README, with boundary assertions for the old id.
- [ ] 2.3 Run the configured validation gate, review the complete diff, and resolve any findings.

Validation so far: `npm run typecheck`, `npm run test:unit`, `npm run build`, and `npm run test:package` pass. The focused component/task-header suites pass, and `npm test -- packages/extension-api packages/web --exclude packages/web/src/routes.test.tsx` passes (4,695 tests). The full gate remains open because the unrelated `routes.test.tsx` automations case hangs in its loading state and the full parallel Vitest run also hit pre-existing server-suite failures before timeout.

## Risks

- The id/export rename is broad and must remain mechanical; typecheck, boundary tests, and focused task-header tests should catch missed references.
- Resolver behavior must remain unchanged except for how the default is identified; tests must prove a non-conventional declared default and the no-default unresolved path.
- This touches the task page but intentionally changes no visual behavior; browser QA will verify the header still renders.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Declared defaults

- [x] 1.1 Add core registration options, `isDefault`, duplicate-default validation, and register the core default. — 18aa6da4
- [x] 1.2 Resolve fallbacks from `isDefault`, rename the missing-default check and diagnostics, and add regression coverage. — 18aa6da4
- [x] 1.3 Add the task-thread guard for an absent default and update repository guidance. — 18aa6da4

### Phase 2: Provider-neutral task header

- [x] 2.1 Rename the public contract, exports, core implementation, adapter files, ids, and all affected consumers/tests.
- [x] 2.2 Add the provider-neutral/core namespace rule to `AGENTS.md` and the extension API README, with boundary assertions for the old id.
- [ ] 2.3 Run the configured validation gate, review the complete diff, and resolve any findings.
