import * as React from 'react'

import { LayoutRegistry } from '@/lib/layout-elements'

const LayoutRegistryContext = React.createContext<LayoutRegistry | null>(null)

export function LayoutRegistryProvider({ children }: { children: React.ReactNode }) {
  const registry = React.useState(() => new LayoutRegistry())[0]
  return <LayoutRegistryContext.Provider value={registry}>{children}</LayoutRegistryContext.Provider>
}

export function useLayoutRegistry(): LayoutRegistry {
  const registry = React.useContext(LayoutRegistryContext)
  if (!registry) {
    throw new Error('useLayoutRegistry must be used inside LayoutRegistryProvider')
  }
  // Subscribe here so discovery consumers re-render when a wrapper mounts, unmounts, or attaches
  // its visual node. The registry itself remains stable for the lifetime of the provider.
  React.useSyncExternalStore(
    registry.subscribe.bind(registry),
    registry.getExternalSnapshot.bind(registry),
    registry.getExternalSnapshot.bind(registry),
  )
  return registry
}

export function useLayoutSnapshot() {
  return useLayoutRegistry().getSnapshot()
}
