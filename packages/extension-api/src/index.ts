// The ONE entry point of `@open-mercato/cezar-extension-api`. A file under `src/` is not public
// until this barrel re-exports it; nothing else belongs here.

export { defineCommand, type CommandOptions, type Commands, type CommandToken } from './commands.ts'
export {
  defineComponentContract,
  type ComponentContract,
  type ComponentImplementation,
  type ComponentProps,
  type ComponentRegistry,
} from './components.ts'
export type { ExtensionContext } from './context.ts'
export {
  TaskArchive,
  TaskContinue,
  TaskStop,
  type TaskArchiveInput,
  type TaskArchiveResult,
  type TaskAttachment,
  type TaskContinueInput,
  type TaskContinueResult,
  type TaskRef,
  type TaskStopResult,
} from './core-commands.ts'
export { ExtensionDefinitionError, isExtensionError, type ExtensionErrorCode } from './errors.ts'
export { defineEvent, type Events, type EventToken } from './events.ts'
export { defineExtension, type Extension } from './extension.ts'
export { isValidContributionId, isValidExtensionId, type ContributionId, type ExtensionId } from './ids.ts'
export type { IsJson, JsonPrimitive, JsonValue } from './json.ts'
export type { Disposable } from './lifecycle.ts'
export { validateManifest, type ExtensionManifest, type ManifestIssue } from './manifest.ts'
export type { ExtensionStorage } from './storage.ts'
