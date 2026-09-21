import {
  LayoutSchemaError,
  TaskComposer,
  TaskHeaderMain,
  parseLayoutJson,
  parseLayoutSchema,
  type LayoutPlacement,
  type LayoutSchema,
  type TaskComposerProps,
  type TaskHeaderMainProps,
} from '@open-mercato/cezar-extension-api'
import type { ReactElement } from 'react'

import { ComponentHost } from '@/component-registry/component-host'
import { admitPagePlacement, LayoutRenderer, PageLayoutProvider, type PageLayoutRegistry, createPageLayoutRegistry, TaskPage } from '@/page-layout'
import type { BindingRenderInput, LayoutRenderIssue, TaskLayoutSnapshot, ValidatedLayoutBinding } from '@/page-layout/layout-types'

import { defaultTaskPageLayout } from './task-layout-schema'

export interface TaskPageLayoutContext {
  readonly header?: TaskHeaderMainProps
  readonly composer?: TaskComposerProps
}

export type TaskPageLayoutBinding =
  | ValidatedLayoutBinding<TaskPageLayoutContext> & { readonly kind: 'task-header-main' }
  | ValidatedLayoutBinding<TaskPageLayoutContext> & { readonly kind: 'task-composer' }

export interface TaskLayoutInput {
  readonly identity: string
  readonly supplied?: LayoutSchema
}

export function taskSchemaPageToPageId(page: string): 'task.page' | undefined {
  return page === 'task' ? 'task.page' : undefined
}

export function taskSchemaZoneToPageZone(zone: string): 'task.header' | 'task.main' | 'task.sidebar' | undefined {
  if (zone === 'header') return 'task.header'
  if (zone === 'main') return 'task.main'
  if (zone === 'sidebar') return 'task.sidebar'
  return undefined
}

export function taskLayoutSubject(snapshot: TaskLayoutSnapshot, schemaZone: 'header' | 'main', contractId: string): string {
  const placement = snapshot.schema.zones[schemaZone]?.find((candidate) => candidate.contract === contractId)
  return `task:${snapshot.identity}:${schemaZone}:${placement?.id ?? contractId}`
}

export function createTaskLayoutSnapshot(input: TaskLayoutInput): TaskLayoutSnapshot {
  const base = snapshot(input.identity, defaultTaskPageLayout, 'default', [])
  if (input.supplied === undefined) return base
  return replaceTaskLayout(base, input.supplied).snapshot
}

export function replaceTaskLayout(
  current: TaskLayoutSnapshot,
  candidate: LayoutSchema,
): { readonly applied: true; readonly snapshot: TaskLayoutSnapshot } | { readonly applied: false; readonly snapshot: TaskLayoutSnapshot } {
  try {
    const parsed = parseLayoutSchema(candidate)
    const issues = validateTaskLayout(parsed)
    if (issues.length > 0) return { applied: false, snapshot: withDiagnostics(current, issues) }
    return { applied: true, snapshot: snapshot(current.identity, parsed, 'supplied', []) }
  } catch (error) {
    return { applied: false, snapshot: withDiagnostics(current, issueFromSchemaError(error)) }
  }
}

/** The raw boundary distinguishes JSON syntax from schema and version failures. */
export function replaceTaskLayoutInput(
  current: TaskLayoutSnapshot,
  input: string | unknown,
): { readonly applied: true; readonly snapshot: TaskLayoutSnapshot } | { readonly applied: false; readonly snapshot: TaskLayoutSnapshot } {
  try {
    const parsed = typeof input === 'string' ? parseLayoutJson(input) : parseLayoutSchema(input)
    return replaceTaskLayout(current, parsed)
  } catch (error) {
    return { applied: false, snapshot: withDiagnostics(current, issueFromSchemaError(error)) }
  }
}

export function validateTaskLayout(schema: LayoutSchema): readonly LayoutRenderIssue[] {
  const issues: LayoutRenderIssue[] = []
  if (taskSchemaPageToPageId(schema.page) === undefined) {
    issues.push({ code: 'unknown-page', detail: schema.page })
    return Object.freeze(issues.map((issue) => Object.freeze(issue)))
  }
  const seen = new Set<string>()
  for (const schemaZone of Object.keys(schema.zones)) {
    const pageZoneId = taskSchemaZoneToPageZone(schemaZone)
    if (pageZoneId === undefined) {
      issues.push({ code: 'unknown-zone', schemaZone })
      continue
    }
    const zone = TaskPage.zones.find((candidate) => candidate.id === pageZoneId)
    if (zone === undefined) continue
    const placements = schema.zones[schemaZone] ?? []
    for (const placement of placements) {
      if (seen.has(placement.id)) {
        issues.push({ code: 'duplicate-placement', schemaZone, pageZone: pageZoneId, placementId: placement.id })
        continue
      }
      seen.add(placement.id)
      // One placement at a time: duplicates and cardinality are reported above and below, schema-wide.
      const admission = admitPagePlacement(zone, {
        key: placement.id,
        placement: zone.placement,
        contractId: placement.contract,
        contractVersion: placement.contractVersion,
      }, { seenKeys: new Set<string>(), acceptedCount: 0 })
      if (!admission.accepted) {
        const code = admission.issue.code === 'contract-not-accepted' ? 'contract-not-served'
          : admission.issue.code === 'zone-not-allowed' ? 'placement-not-accepted'
            : 'invalid-placement'
        issues.push({ code, schemaZone, pageZone: pageZoneId, placementId: placement.id, contractId: placement.contract, contractVersion: placement.contractVersion })
      }
    }
    if (zone.cardinality === 'single' && placements.length > 1) {
      for (const placement of placements.slice(1)) issues.push({ code: 'cardinality-exceeded', schemaZone, pageZone: pageZoneId, placementId: placement.id })
    }
    if (zone.required && placements.length === 0) issues.push({ code: 'required-zone-empty', schemaZone, pageZone: pageZoneId })
  }
  for (const zone of TaskPage.zones) {
    const schemaZone = zone.id === 'task.header' ? 'header' : zone.id === 'task.main' ? 'main' : 'sidebar'
    if (zone.required && schema.zones[schemaZone] === undefined) {
      issues.push({ code: 'required-zone-empty', schemaZone, pageZone: zone.id })
    }
  }
  return Object.freeze(issues.map((issue) => Object.freeze(issue)))
}

export function createTaskPageRegistry(): PageLayoutRegistry {
  const registry = createPageLayoutRegistry()
  registry.registerPage(TaskPage)
  return registry
}

export function TaskPageLayoutProvider(props: { readonly children: ReactElement }): ReactElement {
  return <PageLayoutProvider registry={createTaskPageRegistry()}>{props.children}</PageLayoutProvider>
}

export function TaskLayoutRenderer<Context>(props: {
  readonly snapshot: TaskLayoutSnapshot
  readonly context: Context
  readonly bindings: readonly ValidatedLayoutBinding<Context>[]
  readonly zones?: readonly string[]
  readonly fallback?: (issue: LayoutRenderIssue) => ReactElement | null
}): ReactElement {
  return (
    <LayoutRenderer
      snapshot={props.snapshot}
      context={props.context}
      bindings={props.bindings}
      zones={props.zones}
      resolvePageId={taskSchemaPageToPageId}
      resolveZoneId={taskSchemaZoneToPageZone}
      fallback={props.fallback}
    />
  )
}

export function createTaskHeaderBinding(): TaskPageLayoutBinding {
  return {
    kind: 'task-header-main',
    schemaZone: 'header',
    pageZone: 'task.header',
    placement: 'task.header.main',
    contractId: TaskHeaderMain.id,
    contractVersion: TaskHeaderMain.version,
    render: ({ context, placement, subject }: BindingRenderInput<TaskPageLayoutContext>) => {
      if (context.header === undefined) throw new Error('Task header layout binding has no header props')
      return <ComponentHost contract={TaskHeaderMain} subject={subject} props={context.header} />
    },
  }
}

export function createTaskComposerBinding(): TaskPageLayoutBinding {
  return {
    kind: 'task-composer',
    schemaZone: 'main',
    pageZone: 'task.main',
    placement: 'task.main.content',
    contractId: TaskComposer.id,
    contractVersion: TaskComposer.version,
    render: ({ context, placement, subject }: BindingRenderInput<TaskPageLayoutContext>) => {
      if (context.composer === undefined) throw new Error('Task composer layout binding has no composer props')
      return <ComponentHost contract={TaskComposer} subject={subject} props={context.composer} />
    },
  }
}

function snapshot(identity: string, schema: LayoutSchema, source: TaskLayoutSnapshot['source'], diagnostics: readonly LayoutRenderIssue[]): TaskLayoutSnapshot {
  return Object.freeze({
    identity,
    schema: deepFreeze(schema),
    source,
    diagnostics: Object.freeze([...diagnostics]),
  })
}

function withDiagnostics(current: TaskLayoutSnapshot, issues: readonly LayoutRenderIssue[]): TaskLayoutSnapshot {
  return Object.freeze({
    ...current,
    diagnostics: Object.freeze([...current.diagnostics, ...issues]),
  })
}

function issueFromSchemaError(error: unknown): readonly LayoutRenderIssue[] {
  if (!(error instanceof LayoutSchemaError)) return Object.freeze([{ code: 'invalid-schema', detail: 'unreadable layout' }])
  const code = error.code === 'unsupported-version' ? 'unsupported-version' : error.code
  const detail = error.issues[0]?.path || undefined
  return Object.freeze([{ code, ...(detail === undefined ? {} : { detail }) }])
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}
