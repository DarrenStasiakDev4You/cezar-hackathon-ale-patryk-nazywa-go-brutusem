import {
  LAYOUT_SCHEMA_VERSION,
  TaskComposer,
  TaskHeaderMain,
  type LayoutSchema,
} from '@open-mercato/cezar-extension-api'

import { loadLayoutSchema, type LayoutLoadResult, type LayoutMigrationOptions } from '@/lib/layout-migrations'
import type { LayoutSchemaV3 } from '@/lib/layout-schema'

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

/** The current fallback document returned after a persisted layout cannot be migrated. */
export const defaultTaskPageLayoutV3: LayoutSchemaV3 = deepFreeze({
  page: 'task',
  schemaVersion: 3,
  zones: {
    header: [{ id: 'task-header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version, required: true }],
    main: [{ id: 'task-composer', contract: TaskComposer.id, contractVersion: TaskComposer.version, required: true }],
    sidebar: [],
  },
})

/**
 * The load/render boundary owns recovery. It never writes the stored value and never throws a
 * migration error into the React root; callers can surface `fallback` and the safe diagnostic.
 */
export function loadTaskPageLayout(input: unknown, options: LayoutMigrationOptions = {}): LayoutLoadResult {
  return loadLayoutSchema(input, defaultTaskPageLayoutV3, options)
}

export const LAYOUT_MIGRATION_FALLBACK_MESSAGE = 'Nie udało się zaktualizować własnego układu. Użyto bezpiecznego układu domyślnego.'
