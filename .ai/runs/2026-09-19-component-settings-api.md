# Execution plan — update Component Settings API spec from PR answers (adopted from PR #46)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-09-19 because PR #46 carried no execution plan.
**PR:** #46 · **Branch:** `spec/component-settings-api` · **Base:** `main`
**Author:** @RafalDev4You — this plan interprets the PR's intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Update the existing Component Settings API specification with the owner's answers to its four open questions, preserving the design-only scope.

## Scope

The existing spec `.ai/specs/2026-09-19-component-settings-api.md`: settings scopes, the extension-owned declarative settings definition, host-owned persistence and validation, implementation-specific reading, reload behavior, and implementation phases.

## Non-goals

No production implementation, settings picker UI, form generator, new HTTP route, merge, or browser QA. No layered global-default/project-override model in this item.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The spec needs both global and project settings scopes. | Owner answer in [PR #46](https://github.com/DarrenStasiakDev4You/cezar-hackathon-ale-patryk-nazywa-go-brutusem/pull/46#issuecomment-5745404062) | high |
| The public API must not require Zod. | Owner answer in PR #46 | high |
| Cezar owns validation, persistence, scope and migrations. | Owner answer in PR #46 | high |
| Implementations should read their settings through a type-safe implementation-specific hook/read surface. | Owner answer in PR #46 | high |

## Assumptions

- The current repository's node-free, DOM-free `extension-api` boundary remains authoritative; the spec will describe the hook without adding a React runtime dependency to that package.
- `scope: 'global' | 'project'` is the complete scope model for this item; global defaults with project overrides are a follow-on.
- Global values use workspace UI state and project values use the existing per-project UI-state path, so reload persistence does not require a new route.

## Risks

The answers require replacing the current Zod-compatible and global-only design. The hook shape must remain compatible with the extension package's existing React-free runtime boundary.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append — <commit sha> when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Add the initial Component Settings API design-only specification — a82ab5c5

### Phase 2: Incorporate owner answers

- [x] 2.1 Update the spec's decisions, public API, scope-aware persistence model, implementation reading surface, edge cases, and implementation plan. — 47a0df13
- [x] 2.2 Validate the edited spec, update the PR description and post a resume summary, then release the PR claim. — ebe071fb
