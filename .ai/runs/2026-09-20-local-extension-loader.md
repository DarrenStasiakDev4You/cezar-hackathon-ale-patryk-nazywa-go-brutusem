# Local Extension Loader

Goal: let local Cezar users place validated frontend extension packages under `~/.cezar/extensions/`, approve requested permissions explicitly, and load admitted packages in the cockpit without rebuilding Cezar.

Scope: backend package discovery and grants, versioned workspace API and safe module assets, asynchronous browser registration, global Settings diagnostics and approval UI, documentation, and compatibility inventory.

Non-goals: backend extension execution, project-local or remote packages, downloads or marketplace trust, cryptographic signatures, sandboxing, hot reload, persisted runtime history, and new SSE/WebSocket topics.

Risks: approved local extensions execute in the cockpit origin; asset serving and permission admission are security-sensitive; the backend/browser contract must remain fail-closed and hosted mode must never expose local package metadata or code.

Source doc: .ai/specs/2026-09-20-local-extension-loader.md

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Pure local discovery and grants

- [x] 1.1 Add extension directory and grant-file path helpers with CEZ_HOME coverage. — 0f91d38d
- [x] 1.2 Add the Cezar-owned grant store with atomic writes, permission coverage, salvage, and degradation tests. — 0f91d38d
- [x] 1.3 Add the local scanner with fail-closed manifest, compatibility, duplicate, path, and permission classification tests. — 0f91d38d
- [x] 1.4 Add valid and broken package fixtures proving scan-time code is never imported. — 0f91d38d

### Phase 2: Server inventory and asset boundary

- [x] 2.1 Add extension API contract schemas and api-client helpers with parity and typed-route tests. — deecd90f
- [x] 2.2 Add chained inventory, diagnostics, endpoint-discovery, and approval routes with local/hosted gates. — deecd90f
- [x] 2.3 Add the safe versioned JavaScript asset route and backward-compatibility inventory. — deecd90f
- [x] 2.4 Add non-blocking post-listen scan prewarming/logging and boot-failure coverage. — deecd90f (lazy route scans keep boot non-blocking; no prewarm was needed)

### Phase 3: Browser loading

- [x] 3.1 Add the injected sequential browser loader with identity and grant verification. — deecd90f
- [x] 3.2 Wire external loading after built-in startup without delaying first paint. — deecd90f
- [x] 3.3 Reuse the existing registry lifecycle, permission, timeout, cleanup, and logging behavior with failure-isolation tests. — deecd90f

### Phase 4: Diagnostics UI and documentation

- [x] 4.1 Add the global Extensions Settings section with inventory, diagnostics, approval, reload, hosted, empty, and accessibility states. — deecd90f
- [x] 4.2 Document local package authoring, permissions, reload behavior, and the unsandboxed trust boundary. — deecd90f
- [ ] 4.3 Update AGENTS/reference and BACKWARD_COMPATIBILITY.md as required, then run the full validation and browser smoke gates.

Validation note: typecheck, build, unit tests, feature-focused Vitest tests, and package installation pass. The aggregate `npm test` run remains red on unrelated automation, system-prompt, agent-profile, open-in-app, and automation-route tests; browser smoke has not been run.
