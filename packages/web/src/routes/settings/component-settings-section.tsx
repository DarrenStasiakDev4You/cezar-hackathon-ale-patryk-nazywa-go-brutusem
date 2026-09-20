import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PanelsTopLeftIcon } from 'lucide-react'

import type { ComponentSettingDefinition, ComponentSettingValue } from '@open-mercato/cezar-extension-api'

import { queryKeys, workspaceQueryKeys } from '@/api/queries'
import { CenteredState } from '@/components/centered-state'
import { toast } from '@/components/ui/toaster'
import { CORE_COMPONENT_CONTRACTS } from '@/component-registry/core-contracts'
import { listComponentChoices } from '@/component-registry/choices'
import { useComponentRegistry } from '@/component-registry/provider'
import type { ComponentRegistration } from '@/component-registry/registry'
import { ComponentSettingsError } from '@/component-registry/registry'
import { ComponentSettingsField } from './component-settings-field'

const CONTRACT_NAMES: Readonly<Record<string, string>> = {
  'cezar.task.header.main': 'Task header',
  'cezar.task.composer': 'Task composer',
}

export function hasConfigurableComponent(registry: Pick<ReturnType<typeof useComponentRegistry>, 'listUsable'>): boolean {
  return CORE_COMPONENT_CONTRACTS.some((contract) => registry.listUsable(contract).some((registration) => registration.settings !== undefined))
}

/** Settings → Components: generated from the live registrations, never from extension-specific UI. */
export function ComponentSettingsSection(): ReactElement {
  const registry = useComponentRegistry()
  const revision = useSyncExternalStore(registry.subscribe, registry.revision)
  const queryClient = useQueryClient()
  const groups = new Map<string, {
    readonly contractId: string
    readonly version: number
    readonly cards: Array<{ readonly contract: (typeof CORE_COMPONENT_CONTRACTS)[number]; readonly registration: ComponentRegistration }>
  }>()
  for (const contract of CORE_COMPONENT_CONTRACTS) {
    const choices = listComponentChoices(registry, contract)
    if (choices.status === 'unresolved') continue
    const cards = [choices.default, ...choices.overrides]
      .filter((registration) => registration.settings !== undefined)
      .sort((left, right) => left.componentId.localeCompare(right.componentId))
      .map((registration) => ({ contract, registration: registration as unknown as ComponentRegistration }))
    if (cards.length > 0) groups.set(contract.id, { contractId: contract.id, version: contract.version, cards })
  }

  if (groups.size === 0) {
    return <CenteredState icon={<PanelsTopLeftIcon />} title="No component has settings to configure" subtitle="Extensions add entries here when their component implementations declare settings." heading="h2" />
  }

  return (
    <main className="flex w-full flex-col gap-6 p-3 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-8" data-slot="component-settings-section" data-revision={revision}>
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-[13px] text-muted-foreground">Settings the installed component implementations declare. These values are UI state, not a secret store.</p>
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        {[...groups.values()].map((group) => (
          <section key={group.contractId} aria-labelledby={`component-contract-${group.contractId}`}>
            <h2 id={`component-contract-${group.contractId}`} className="mb-3 text-sm font-semibold text-muted-foreground">
              {componentContractName(group.contractId, group.version)}
            </h2>
            <div className="flex flex-col gap-5">
              {group.cards.map(({ registration }) => <SettingsCard key={registration.componentId} registration={registration} registry={registry} queryClient={queryClient} />)}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

function SettingsCard(props: {
  readonly registration: ComponentRegistration
  readonly registry: ReturnType<typeof useComponentRegistry>
  readonly queryClient: ReturnType<typeof useQueryClient>
}) {
  const definition = props.registration.settings
  const [settings, setSettings] = useState<Record<string, ComponentSettingValue> | undefined>()
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState<string | undefined>()
  const revision = useSyncExternalStore(props.registry.subscribe, props.registry.revision)

  useEffect(() => {
    let active = true
    setLoading(true)
    void props.registry.getSettings(props.registration.componentId).then((value) => {
      if (!active) return
      setSettings(isSettings(value) ? value : definition?.defaults as Record<string, ComponentSettingValue> | undefined)
      setUnavailable(undefined)
      setLoading(false)
    }).catch((error: unknown) => {
      if (!active) return
      setSettings(definition?.defaults as Record<string, ComponentSettingValue> | undefined)
      setUnavailable(error instanceof ComponentSettingsError ? error.message : 'Settings are unavailable')
      setLoading(false)
    })
    return () => { active = false }
  }, [definition, props.registration.componentId, props.registry, revision])

  if (definition === undefined) return null
  const current = settings ?? definition.defaults as Record<string, ComponentSettingValue>
  const disabled = unavailable !== undefined
  const invalidate = () => {
    void props.queryClient.invalidateQueries({ queryKey: queryKeys.uiState })
    void props.queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.uiState })
  }
  const onError = (error: unknown) => {
    if (error instanceof ComponentSettingsError && error.code === 'settings-unavailable') setUnavailable(error.message)
    else toast(error instanceof Error ? error.message : 'The setting could not be saved', { tone: 'danger' })
  }
  const fields = Object.entries(definition.schema) as Array<[string, ComponentSettingDefinition]>
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-xs" data-component-id={props.registration.componentId}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-base font-semibold">{props.registration.metadata.title}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{props.registration.extensionId ?? 'Cezar'} · <code>{props.registration.componentId}</code></p>
        </div>
        <span className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">{definition.scope === 'global' ? 'All projects' : 'This project'}</span>
      </header>
      {unavailable ? <p className="mt-3 rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">{unavailable}</p> : null}
      {loading ? <div className="space-y-3 py-4" aria-label="Loading component settings"><div className="h-4 w-1/3 animate-pulse rounded bg-muted" /><div className="h-9 animate-pulse rounded bg-muted" /></div> : (
        <div className={disabled ? 'pointer-events-none opacity-60' : undefined}>
          {fields.map(([key, field]) => <ComponentSettingsField
            key={key}
            componentId={props.registration.componentId}
            fieldKey={key}
            definition={field}
            value={current[key] ?? field.default}
            defaultValue={field.default}
            registry={props.registry}
            disabled={disabled}
            disabledReason={disabled ? unavailable : undefined}
            onSaved={invalidate}
            onError={onError}
          />)}
          <div className="flex justify-end border-t border-border/70 pt-3">
            <button type="button" className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground" disabled={disabled} onClick={() => {
              void props.registry.resetSettings(props.registration.componentId).then(invalidate).catch(onError)
            }}>Restore defaults</button>
          </div>
        </div>
      )}
    </section>
  )
}

function isSettings(value: unknown): value is Record<string, ComponentSettingValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function componentContractName(id: string, version: number): string {
  return CONTRACT_NAMES[id] ?? `${id}@${version}`
}
