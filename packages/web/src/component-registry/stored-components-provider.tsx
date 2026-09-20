import { type QueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'

import type { ContributionId } from '@open-mercato/cezar-extension-api'

import { getWorkspaceUiState, putWorkspaceUiState } from '@/api/client'
import { workspaceQueryKeys } from '@/api/queries'

import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { ComponentsProvider } from './provider'
import { createComponentPreferences, type ComponentPreferences, type ComponentPreferencesStorage } from './preferences'
import type { CockpitComponentRegistry } from './registry'
import { createCoreComponentRegistry } from './core-components'

export function uiStateComponentStorage(queryClient: QueryClient): ComponentPreferencesStorage {
  return {
    async load() {
      try {
        const state = await queryClient.fetchQuery({
          queryKey: workspaceQueryKeys.uiState,
          queryFn: ({ signal }) => getWorkspaceUiState({ signal }),
        })
        return state.components ?? {}
      } catch {
        return undefined
      }
    },
    async save(components) {
      const state = await putWorkspaceUiState({ components })
      queryClient.setQueryData(workspaceQueryKeys.uiState, state)
    },
  }
}

function memoryComponentStorage(): ComponentPreferencesStorage {
  let components: Record<string, unknown> = {}
  return {
    async load() {
      return components
    },
    async save(next) {
      components = next
    },
  }
}

const PreferencesContext = createContext<ComponentPreferences | null>(null)

export function StoredComponentsProvider(props: {
  readonly registry?: CockpitComponentRegistry
  readonly preferences?: ComponentPreferences
  readonly children: ReactNode
}): ReactElement {
  const [registry] = useState(() => props.registry ?? createCoreComponentRegistry())
  const [preferences] = useState(() =>
    props.preferences ??
    createComponentPreferences({
      registry,
      contracts: CORE_COMPONENT_CONTRACTS,
      storage: memoryComponentStorage(),
    }),
  )
  const revision = useSyncExternalStore(
    useCallback((listener) => preferences.subscribe(() => listener()), [preferences]),
    preferences.revision,
    preferences.revision,
  )
  const preferenceOf = useCallback(
    (contractId: ContributionId) => preferences.get(contractId) ?? null,
    [preferences, revision],
  )

  const contextValue = useMemo(() => preferences, [preferences])
  return (
    <PreferencesContext.Provider value={contextValue}>
      <ComponentsProvider registry={registry} preferenceOf={preferenceOf}>
        {props.children}
      </ComponentsProvider>
    </PreferencesContext.Provider>
  )
}

export function useComponentPreferences(): ComponentPreferences {
  const preferences = useContext(PreferencesContext)
  if (preferences === null) {
    throw new Error('useComponentPreferences must be used inside <StoredComponentsProvider>')
  }
  return preferences
}
