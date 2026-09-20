import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'

import type { WorkspaceUiState } from '@open-mercato/cezar-api-client'

import { getWorkspaceUiState, putWorkspaceUiState } from '@/api/client'
import { workspaceQueryKeys } from '@/api/queries'

import { createCoreComponentRegistry } from './core-components'
import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { createComponentPreferences, type ComponentPreferences, type ComponentPreferencesStorage } from './preferences'
import { ComponentsProvider } from './provider'
import type { CockpitComponentRegistry } from './registry'

const PreferencesContext = createContext<ComponentPreferences | null>(null)

/** The workspace UI-state adapter shared with AppearanceProvider and other global preferences. */
export function uiStateComponentStorage(queryClient: QueryClient): ComponentPreferencesStorage {
  return {
    async load() {
      const cached = queryClient.getQueryData<WorkspaceUiState>(workspaceQueryKeys.uiState)
      const state = cached ?? (await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.uiState,
        queryFn: ({ signal }) => getWorkspaceUiState({ signal }),
      }))
      return state?.components ?? {}
    },
    async save(components) {
      const merged = await putWorkspaceUiState({ components })
      queryClient.setQueryData(workspaceQueryKeys.uiState, merged)
    },
  }
}

/**
 * Feeds the page's stored implementation choices into every ComponentHost. The service is created
 * once beside the page's registry; tests may inject one to exercise persistence independently.
 */
export function StoredComponentsProvider(props: {
  readonly registry?: CockpitComponentRegistry
  readonly preferences?: ComponentPreferences
  readonly children: ReactNode
}): ReactElement {
  const queryClient = useQueryClient()
  const [registry] = useState(() => props.registry ?? createCoreComponentRegistry())
  const [preferences] = useState(() =>
    props.preferences ??
    createComponentPreferences({
      registry,
      contracts: CORE_COMPONENT_CONTRACTS,
      storage: uiStateComponentStorage(queryClient),
    }),
  )
  const revision = useSyncExternalStore(preferences.subscribe, preferences.revision)
  const preferenceOf = useCallback(
    (contractId: Parameters<ComponentPreferences['get']>[0]) => preferences.get(contractId) ?? null,
    [preferences, revision],
  )

  return (
    <PreferencesContext.Provider value={preferences}>
      <ComponentsProvider registry={registry} preferenceOf={preferenceOf}>
        {props.children}
      </ComponentsProvider>
    </PreferencesContext.Provider>
  )
}

/** The page's preference service, for the future Settings picker. */
export function useComponentPreferences(): ComponentPreferences {
  const preferences = useContext(PreferencesContext)
  if (preferences === null) throw new Error('cezar: useComponentPreferences() must be called inside <StoredComponentsProvider>')
  return preferences
}
