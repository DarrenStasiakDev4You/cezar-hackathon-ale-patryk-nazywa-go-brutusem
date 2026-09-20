import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setApiBaseUrl } from '@open-mercato/cezar-api-client'
import { App } from './app'
import { createQueryClient } from './api/query-client'
import { registerCoreCommands } from './commands/core-commands'
import { createCommandRegistry } from './commands/registry'
import { createCoreComponentRegistry } from './component-registry/core-components'
import { CORE_COMPONENT_CONTRACTS } from './component-registry/core-contracts'
import { createComponentPreferences } from './component-registry/preferences'
import { uiStateComponentStorage } from './component-registry/stored-components-provider'
import { createPersistentComponentSettingsStore, resolveComponentProjectId } from './component-registry/settings'
import { createEventBus } from './events/bus'
import { BUILTIN_EXTENSIONS } from './extensions/builtin-extensions'
import { cockpitServices, extensionLifecycleEvents, startExtensionHost } from './extensions/host'
import './styles/index.css'

/**
 * Where the API lives, resolved before anything can fetch.
 *
 * Empty — same origin — is the bundled cockpit's case and the default: the service serves this
 * page and owns `/api/v1/*` under the same authority. The two overrides exist for the case this
 * whole split was for, a cockpit talking to a service somewhere else:
 *
 * - `VITE_CEZ_API_BASE` bakes it in at build time, for a bundle shipped separately.
 * - `<meta name="cez-api-base" content="…">` sets it at RUN time, so an operator can point a
 *   deployed bundle at a different service without rebuilding it. It wins, because the HTML is
 *   served per deployment while the bundle is baked once.
 */
function resolveApiBase(): string {
  const meta = document.querySelector('meta[name="cez-api-base"]')?.getAttribute('content')
  return meta?.trim() || import.meta.env.VITE_CEZ_API_BASE || ''
}

setApiBaseUrl(resolveApiBase())

// One query client, one command registry and one event bus for the page, created here rather than
// inside <App> so the extension host can share them (specs `2026-09-19-command-api` and
// `2026-09-19-extension-event-api`). Core commands are registered and the bus exists before the
// host starts, so both are there before any extension activates.
const queryClient = createQueryClient()
const commands = createCommandRegistry()
registerCoreCommands(commands, { queryClient })
const events = createEventBus()
// The component registry (spec `2026-09-19-component-registry`) records every implementation of a
// component contract with its provenance. Core's defaults are registered here, before the host
// starts, as the core commands are, so core always keeps its own ids and every served contract
// has a default to render and to fall back to (spec `2026-09-19-component-host`).
const components = createCoreComponentRegistry({
  settings: createPersistentComponentSettingsStore({ resolveProjectId: resolveComponentProjectId }),
  resolveProjectId: resolveComponentProjectId,
})
const componentPreferences = createComponentPreferences({
  registry: components,
  contracts: CORE_COMPONENT_CONTRACTS,
  storage: uiStateComponentStorage(queryClient),
})

// Extensions compiled into the cockpit (spec `2026-09-18-extension-registry`). Started outside the
// React tree and never awaited: the host never throws and its `ready` never rejects, so no
// extension can delay or break the boot. The list ships empty. Each activation emits
// `cezar.extension.activated` on the bus.
startExtensionHost({
  extensions: BUILTIN_EXTENSIONS,
  services: cockpitServices({ commands, events, components }),
  onStatusChange: extensionLifecycleEvents(events),
})

const container = document.getElementById('root')
if (!container) throw new Error('cezar: #root container is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App
      queryClient={queryClient}
      commands={commands}
      events={events}
      components={components}
      componentPreferences={componentPreferences}
    />
  </StrictMode>,
)
