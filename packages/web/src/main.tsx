import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setApiBaseUrl } from '@open-mercato/cezar-api-client'
import { App } from './app'
import { createQueryClient } from './api/query-client'
import { registerCoreCommands } from './commands/core-commands'
import { createCommandRegistry } from './commands/registry'
import { BUILTIN_EXTENSIONS } from './extensions/builtin-extensions'
import { cockpitServices, startExtensionHost } from './extensions/host'
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

// One query client and one command registry for the page, created here rather than inside <App> so
// the extension host can share them (spec `2026-09-19-command-api`). Core commands are registered
// before the host starts, so they exist before any extension activates.
const queryClient = createQueryClient()
const commands = createCommandRegistry()
registerCoreCommands(commands, { queryClient })

// Extensions compiled into the cockpit (spec `2026-09-18-extension-registry`). Started outside the
// React tree and never awaited: the host never throws and its `ready` never rejects, so no
// extension can delay or break the boot. The list ships empty.
startExtensionHost({ extensions: BUILTIN_EXTENSIONS, services: cockpitServices({ commands }) })

const container = document.getElementById('root')
if (!container) throw new Error('cezar: #root container is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App queryClient={queryClient} />
  </StrictMode>,
)
