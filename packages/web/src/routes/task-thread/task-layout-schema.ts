import {
  LAYOUT_SCHEMA_VERSION,
  TaskComposer,
  TaskHeaderMain,
  type LayoutSchema,
  type LayoutZone,
} from '@open-mercato/cezar-extension-api'

import {
  loadLayoutSchema,
  type LayoutLoadResult,
  type LayoutMigrationError,
  type LayoutMigrationOptions,
} from '@/lib/layout-migrations'
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
 * The roles a stored Task Page layout may not drop. Core renders the header and the composer only
 * through their placements (spec 2026-09-20-layout-renderer), so a document without one hides it.
 * Placement ids are free-form; the role is its contract. A non-empty zone is not enough: `task.main`
 * also accepts `TaskMetadata` (#71), so a main zone holding only metadata would drop the composer.
 */
const requiredTaskPageRoles = [
  { zone: 'header', contract: TaskHeaderMain.id, contractVersion: TaskHeaderMain.version },
  { zone: 'main', contract: TaskComposer.id, contractVersion: TaskComposer.version },
] as const

function missingRequiredPlacement(schema: LayoutSchemaV3): LayoutMigrationError | undefined {
  for (const role of requiredTaskPageRoles) {
    const present = schema.zones[role.zone]?.some(
      (placement) => placement.contract === role.contract && placement.contractVersion === role.contractVersion,
    )
    if (present !== true) {
      return {
        code: 'missing-required-placement',
        path: `$.zones.${role.zone}`,
        message: `required Task Page contract "${role.contract}" is missing`,
      }
    }
  }
  return undefined
}

/**
 * The load/render boundary owns recovery. It never writes the stored value and never throws a
 * migration error into the React root; callers can surface `fallback` and the safe diagnostic.
 */
export function loadTaskPageLayout(input: unknown, options: LayoutMigrationOptions = {}): LayoutLoadResult {
  const result = loadLayoutSchema(input, defaultTaskPageLayoutV3, options)
  if (result.status === 'fallback') return result

  const error = missingRequiredPlacement(result.schema)
  return error === undefined
    ? result
    : { status: 'fallback', fallback: defaultTaskPageLayoutV3, original: input, error }
}

/**
 * The renderer accepts only the normalized current `LayoutSchema` (spec 2026-09-20-layout-renderer,
 * "Existing schema and migration work"), so a migrated document is projected onto it. The one field
 * dropped is `required`: requiredness is page-zone policy, which the renderer reads from `TaskPage`.
 */
export function toRenderLayoutSchema(schema: LayoutSchemaV3): LayoutSchema {
  const zones: Record<string, LayoutZone> = {}
  for (const [zone, placements] of Object.entries(schema.zones)) {
    zones[zone] = placements.map(({ id, contract, contractVersion, layout }) => ({
      id,
      contract,
      contractVersion,
      ...(layout === undefined ? {} : { layout }),
    }))
  }
  return deepFreeze({ page: schema.page, schemaVersion: LAYOUT_SCHEMA_VERSION, zones })
}

export const LAYOUT_MIGRATION_FALLBACK_MESSAGE = 'Nie udało się zaktualizować własnego układu. Użyto bezpiecznego układu domyślnego.'
