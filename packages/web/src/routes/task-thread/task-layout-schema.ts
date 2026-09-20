import {
  LAYOUT_SCHEMA_VERSION,
  TaskComposer,
  TaskHeaderMain,
  type LayoutSchema,
} from '@open-mercato/cezar-extension-api'

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/**
 * The current contract-backed portion of the Task Page layout.
 *
 * This is serializable intent, not the runtime `LayoutRegistry` projection. Persistence, DnD,
 * resolver choices and rendering remain consumers of this data and are intentionally not wired
 * here.
 */
export const defaultTaskPageLayout: LayoutSchema = deepFreeze({
  page: 'task',
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  zones: {
    header: [
      {
        id: 'task-header',
        contract: TaskHeaderMain.id,
        contractVersion: TaskHeaderMain.version,
      },
    ],
    main: [
      {
        id: 'task-composer',
        contract: TaskComposer.id,
        contractVersion: TaskComposer.version,
      },
    ],
    sidebar: [],
  },
})
