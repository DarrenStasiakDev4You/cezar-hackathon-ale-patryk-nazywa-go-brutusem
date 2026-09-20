// The ONE entry point of `@open-mercato/cezar-extension-api`. A file under `src/` is not public
// until this barrel re-exports it; nothing else belongs here.

export { defineCommand, type CommandOptions, type Commands, type CommandToken } from './commands.ts'
export {
  checkComponentCompatibility,
  type ComponentCompatibility,
  type ComponentCompatibilityIssue,
} from './compatibility.ts'
export {
  booleanSetting,
  defineComponentContract,
  defineSettings,
  numberSetting,
  selectSetting,
  stringSetting,
  type ComponentCapability,
  type ComponentContract,
  type ComponentContractOptions,
  type ComponentRenderProps,
  type ComponentRegistrationHandle,
  type ComponentSettingsDefinition,
  type ComponentSettingsSchema,
  type ComponentSettingsScope,
  type ComponentSettingDefinition,
  type ComponentSettingValue,
  type BooleanSettingDefinition,
  type NumberSettingDefinition,
  type SelectSettingDefinition,
  type SettingFieldMeta,
  type SettingOption,
  type StringSettingDefinition,
  type ComponentImplementation,
  type ComponentLayout,
  type ComponentProps,
  type ComponentRegistry,
  type InferSettings,
  type SettingsOf,
} from './components.ts'
export type { ExtensionContext } from './context.ts'
export {
  TaskComposer,
  type TaskActionState,
  type TaskComposerActions,
  type TaskComposerAttachment,
  type TaskComposerAvailability,
  type TaskComposerCompletionList,
  type TaskComposerCompletions,
  type TaskComposerDraft,
  type TaskComposerEngine,
  type TaskComposerFile,
  type TaskComposerProps,
  type TaskComposerRunnerChoice,
  type TaskComposerSkill,
  type TaskComposerStatus,
  TaskHeaderMain,
  type TaskHeaderActions,
  type TaskHeaderActionState,
  type TaskHeaderAttention,
  type TaskHeaderEngine,
  type TaskHeaderMainProps,
  type TaskHeaderMeta,
  type TaskHeaderReference,
  type TaskHeaderTask,
} from './core-components.ts'
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
export {
  ExtensionActivated,
  ProjectChanged,
  TaskArchived,
  TaskCancelled,
  TaskCompleted,
  TaskFailed,
  TaskStarted,
  TaskStatusChanged,
  type ExtensionActivation,
  type ProjectChange,
  type TaskEvent,
  type TaskTransition,
} from './core-events.ts'
export { ExtensionDefinitionError, isExtensionError, type ExtensionErrorCode } from './errors.ts'
export { defineEvent, type Events, type EventToken } from './events.ts'
export { defineExtension, type Extension } from './extension.ts'
export { isValidContributionId, isValidExtensionId, type ContributionId, type ExtensionId } from './ids.ts'
export type { IsJson, JsonPrimitive, JsonValue } from './json.ts'
export type { Disposable } from './lifecycle.ts'
export { validateManifest, type ExtensionManifest, type ManifestIssue } from './manifest.ts'
export type { Notifications } from './notifications.ts'
export type { ExtensionPermission } from './permissions.ts'
export type { ExtensionStorage } from './storage.ts'
