import { useCallback, useSyncExternalStore, useState } from 'react'

import type { ContributionId } from '@open-mercato/cezar-extension-api'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { CORE_COMPONENT_CONTRACTS } from '@/component-registry/core-contracts'
import { listComponentChoices } from '@/component-registry/choices'
import { coreDefaultComponentId } from '@/component-registry/resolve'
import { useComponentPreferences } from '@/component-registry/stored-components-provider'
import { useComponentRegistry } from '@/component-registry/provider'

/** Settings → Interface → Components: the user's live implementation choices. */
export function ComponentsSection() {
  const registry = useComponentRegistry()
  const preferences = useComponentPreferences()
  const registryRevision = useSyncExternalStore(registry.subscribe, registry.revision, registry.revision)
  const preferenceRevision = useSyncExternalStore(
    useCallback((listener) => preferences.subscribe(() => listener()), [preferences]),
    preferences.revision,
    preferences.revision,
  )
  const [busyContract, setBusy] = useState<ContributionId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = useCallback(
    async (contractId: ContributionId, componentId: ContributionId) => {
      setBusy(contractId)
      setError(null)
      try {
        if (componentId === coreDefaultComponentId(contractId)) {
          await preferences.reset(contractId)
        } else {
          await preferences.set(contractId, componentId)
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The component choice could not be saved.')
      } finally {
        setBusy(null)
      }
    },
    [preferences],
  )

  return (
    <div
      data-slot="components-section"
      data-registry-revision={registryRevision}
      data-preference-revision={preferenceRevision}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Interface</p>
        <h2 className="mt-1 text-base font-semibold text-foreground">Components</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Choose which compatible implementation renders each replaceable part of the cockpit.
          Changes apply immediately and are shared across your projects.
        </p>
      </header>

      {error ? (
        <p role="alert" data-slot="components-error" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3" data-slot="component-override-list">
        {CORE_COMPONENT_CONTRACTS.map((contract) => {
          const listed = listComponentChoices(registry, contract as never)
          if (listed.status === 'unresolved') return null
          const choices = [listed.default, ...listed.overrides]
          const defaultId = coreDefaultComponentId(contract.id)
          const storedId = preferences.get(contract.id)
          const current = choices.find((choice) => choice.componentId === storedId) ??
            choices.find((choice) => choice.componentId === defaultId) ?? choices[0]
          if (current === undefined) return null

          const busy = busyContract === contract.id
          return (
            <section
              key={contract.id}
              data-slot="component-override"
              data-contract-id={contract.id}
              className="rounded-lg border border-border bg-card p-4 shadow-xs"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{titleFor(contract.id)}</h3>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{contract.id}@{contract.version}</p>
                  <p className="mt-2 text-[13px] text-muted-foreground">Only compatible implementations are listed.</p>
                </div>
                <div className="flex w-full max-w-md flex-col gap-2">
                  <label htmlFor={`component-choice-${contract.id}`} className="text-xs font-medium text-muted-foreground">
                    Implementation
                  </label>
                  <select
                    id={`component-choice-${contract.id}`}
                    data-slot="component-choice"
                    value={current.componentId}
                    disabled={busy}
                    onChange={(event) => void choose(contract.id, event.target.value)}
                    className={cn(
                      'h-9 rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none',
                      'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    )}
                  >
                    {choices.map((choice) => (
                      <option key={choice.componentId} value={choice.componentId}>
                        {choice.metadata.title} — {choice.extensionId ?? 'Cezar core'}
                      </option>
                    ))}
                  </select>
                  <p data-slot="component-provider" className="text-xs text-muted-foreground">
                    Provider: <span className="font-medium text-foreground">{current.extensionId ?? 'Cezar core'}</span>
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <p data-slot="component-current" className="text-xs text-muted-foreground">
                      Current: <span className="font-medium text-foreground">{current.metadata.title}</span>
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-slot="component-reset"
                      disabled={storedId === undefined}
                      onClick={() => void choose(contract.id, defaultId)}
                    >
                      Reset to core
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function titleFor(contractId: string): string {
  if (contractId === 'cezar.task.header.main') return 'Task Header'
  return contractId
}
