// The ONE entry point of `@open-mercato/cezar-extension-api`. A file under `src/` is not public
// until this barrel re-exports it; nothing else belongs here.

export type { ExtensionContext } from './context.ts'
export { ExtensionDefinitionError } from './errors.ts'
export { defineExtension, type Extension } from './extension.ts'
export { isValidContributionId, isValidExtensionId, type ContributionId, type ExtensionId } from './ids.ts'
export type { Disposable } from './lifecycle.ts'
export { validateManifest, type ExtensionManifest, type ManifestIssue } from './manifest.ts'
