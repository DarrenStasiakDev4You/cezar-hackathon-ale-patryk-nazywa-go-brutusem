# Extension Package Manifest

Engine: om-auto-create-pr (steps: 5, --loop: no)
Source doc: .ai/specs/2026-09-20-extension-package-manifest.md

## Goal

Implement the pure, dependency-free `cezar.extension.json` package-manifest validator and host compatibility verdict described by the spec, without adding an installer or executing extension code.

## Scope

- Add the internal semver-range parser and satisfaction engine in `packages/extension-api/src/ranges.ts`.
- Add package-manifest types, validation, compatibility issue types, and the ordered compatibility decision in `packages/extension-api/src/package-manifest.ts`.
- Add table-driven tests for parsing, semver satisfaction, manifest validation, and compatibility gating.
- Publish the specified runtime and type surface through `packages/extension-api/src/index.ts`, update the exact runtime surface test, document the format, and add the worked JSON example.

## Non-goals

- No installer, package reader, download, unpacking, caching, or dynamic import.
- No marketplace registry, publisher verification, checksum, signature, trust, or permission-approval UI.
- No backend entrypoint host or compiled-in extension compatibility enforcement.
- No generated JSON Schema, CLI verification command, HTTP route, persisted state, or backward-compatibility inventory entry.

## Implementation Plan

### Phase 1: Package format and decision

1.1 Add `src/ranges.ts` parsing for the specified comparator grammar, partials, placeholders, OR sets, bounds, and unsupported-range rejection; add parser tests.

1.2 Add semver satisfaction with 0.x caret behavior, tilde/comparator semantics, ignored build metadata, and npm pre-release admission rules; add table-driven satisfaction tests.

1.3 Add `ExtensionPackageManifest`, `EntrypointKind`, `EXTENSION_API_VERSION`, and generation-aware `validatePackageManifest`; add manifest-format tests including strict sections, path grammar, permissions, metadata, and prototype edge cases.

1.4 Add `PackageCompatibility`, `PackageCompatibilityIssue`, `HostIdentity`, and ordered `checkPackageCompatibility`; add frozen-result, gating, entrypoint, throwing-getter, and revoked-proxy tests.

1.5 Re-export the specified surface, extend the exact runtime export test, document the package manifest and compatibility gates, and add `examples/hello-extension/cezar.extension.json`.

## Risks

- The hand-written semver subset and npm pre-release rule are the highest correctness risks; table-driven tests cover every grammar and boundary named by the spec.
- The validator must remain total and Node/DOM-free, with strict-member checks gated by the supported generation so newer manifests fail with the compatibility issue rather than misleading validation errors.
- The change is intentionally inert and pure; no consumer or runtime host behavior is modified.

## Progress

PR: #66 (link: https://github.com/DarrenStasiakDev4You/cezar-hackathon-ale-patryk-nazywa-go-brutusem/pull/66)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Package format and decision

- [x] 1.1 Add `src/ranges.ts` parsing for the specified comparator grammar, partials, placeholders, OR sets, bounds, and unsupported-range rejection; add parser tests. — 810fe91a
- [x] 1.2 Add semver satisfaction with 0.x caret behavior, tilde/comparator semantics, ignored build metadata, and npm pre-release admission rules; add table-driven satisfaction tests. — d39e0c60
- [x] 1.3 Add `ExtensionPackageManifest`, `EntrypointKind`, `EXTENSION_API_VERSION`, and generation-aware `validatePackageManifest`; add manifest-format tests including strict sections, path grammar, permissions, metadata, and prototype edge cases. — 72102d05
- [x] 1.4 Add `PackageCompatibility`, `PackageCompatibilityIssue`, `HostIdentity`, and ordered `checkPackageCompatibility`; add frozen-result, gating, entrypoint, throwing-getter, and revoked-proxy tests. — b1f32b7b
- [x] 1.5 Re-export the specified surface, extend the exact runtime export test, document the package manifest and compatibility gates, and add `examples/hello-extension/cezar.extension.json`. — 31288e27
