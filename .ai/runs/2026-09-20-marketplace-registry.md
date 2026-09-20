# Marketplace Registry Implementation

Goal: Add an on-demand, read-only marketplace catalog API for extension metadata without adding installation, loading, execution, persistence, polling, or UI behavior.

Scope: `packages/contract` owns the external catalog and HTTP response schemas. `packages/cezar` owns bounded normalization, fixed-source fetching, in-memory cache/coalescing, and the workspace route. The route is chained into the versioned workspace family and covered by typed-client, contract-parity, route inventory, and service tests. `BACKWARD_COMPATIBILITY.md` and a checked-in sample fixture document the additive surface.

Non-goals: extension installation or downloads, bundle verification or unpacking, dynamic loading or execution, permission grants, compatibility selection, configurable registries, boot/background fetches, persistent caches, and any cockpit UI.

Risks: The canonical production URL is not yet supplied by the registry owner, so implementation uses a stable compiled HTTPS placeholder and makes the source injectable for tests. A compromised catalog remains a discovery supply-chain risk; SHA-256 is integrity metadata, not publisher authentication. Network failures must remain optional and non-fatal.

Source doc: .ai/specs/2026-09-20-marketplace-registry.md
Spec PR: #73 (merged)

## Implementation Plan

### Phase 1: Contract And Pure Catalog Logic

- [ ] 1.1 Define the bounded external catalog and HTTP response schemas, export inferred types, and add contract-focused fixtures/tests.
- [ ] 1.2 Implement pure catalog normalization with envelope validation, per-entry salvage, duplicate rejection, deterministic semver ordering, and bounded input handling.
- [ ] 1.3 Validate compatibility metadata with the existing extension API range grammar while preserving declarations without making host compatibility decisions.

### Phase 2: On-Demand Service Endpoint

- [ ] 2.1 Implement the fixed-source, dependency-injected fetcher with timeout, byte cap, redirect policy, in-flight coalescing, and short-lived in-memory success cache.
- [ ] 2.2 Add and chain the workspace marketplace route, expose the inferred typed-client method, and test success, partial, unavailable, cache, and non-project-scoped behavior.

### Phase 3: Operational Handoff

- [ ] 3.1 Add the checked-in sample catalog fixture and update `BACKWARD_COMPATIBILITY.md` with exact route, response, cache, and additive evolution semantics.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Contract And Pure Catalog Logic

- [ ] 1.1 Define the bounded external catalog and HTTP response schemas, export inferred types, and add contract-focused fixtures/tests.
- [ ] 1.2 Implement pure catalog normalization with envelope validation, per-entry salvage, duplicate rejection, deterministic semver ordering, and bounded input handling.
- [ ] 1.3 Validate compatibility metadata with the existing extension API range grammar while preserving declarations without making host compatibility decisions.

### Phase 2: On-Demand Service Endpoint

- [ ] 2.1 Implement the fixed-source, dependency-injected fetcher with timeout, byte cap, redirect policy, in-flight coalescing, and short-lived in-memory success cache.
- [ ] 2.2 Add and chain the workspace marketplace route, expose the inferred typed-client method, and test success, partial, unavailable, cache, and non-project-scoped behavior.

### Phase 3: Operational Handoff

- [ ] 3.1 Add the checked-in sample catalog fixture and update `BACKWARD_COMPATIBILITY.md` with exact route, response, cache, and additive evolution semantics.
