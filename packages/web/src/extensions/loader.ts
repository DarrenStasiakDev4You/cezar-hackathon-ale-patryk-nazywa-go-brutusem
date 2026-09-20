import type { Extension } from '@open-mercato/cezar-extension-api'
import type { ExtensionInventoryEntry, ExtensionInventoryResponse } from '@open-mercato/cezar-api-client'

import { getExtensions } from '@/api/client'
import type { ExtensionRegistry } from './registry'

export type ExtensionRuntimePhase = 'inventory' | 'import' | 'identity' | 'register' | 'activate'

export interface ExtensionRuntimeDiagnostic {
  readonly candidate: string
  readonly id: string | null
  readonly phase: ExtensionRuntimePhase
  readonly code: string
  readonly message: string
}

export interface ExtensionRuntimeDiagnostics {
  readonly list: () => readonly ExtensionRuntimeDiagnostic[]
  readonly subscribe: (listener: () => void) => () => void
  readonly revision: () => number
  readonly record: (diagnostic: ExtensionRuntimeDiagnostic) => void
}

function createRuntimeDiagnostics(): ExtensionRuntimeDiagnostics {
  let revision = 0
  let entries: readonly ExtensionRuntimeDiagnostic[] = Object.freeze([])
  const listeners = new Set<() => void>()
  return {
    list: () => entries,
    revision: () => revision,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    record(diagnostic) {
      const bounded = Object.freeze({ ...diagnostic, message: diagnostic.message.slice(0, 512) })
      entries = Object.freeze([...entries, bounded])
      revision += 1
      for (const listener of listeners) listener()
    },
  }
}

export const extensionRuntimeDiagnostics = createRuntimeDiagnostics()

type ImportedModule = { readonly default?: unknown }

export interface ExternalExtensionLoaderOptions {
  readonly registry: ExtensionRegistry
  readonly importModule?: (url: string) => Promise<ImportedModule>
  readonly diagnostics?: ExtensionRuntimeDiagnostics
  readonly onDiagnostic?: (diagnostic: ExtensionRuntimeDiagnostic) => void
}

const defaultImport = (url: string): Promise<ImportedModule> => import(/* @vite-ignore */ url) as Promise<ImportedModule>

function report(
  options: ExternalExtensionLoaderOptions,
  entry: ExtensionInventoryEntry,
  phase: ExtensionRuntimePhase,
  code: string,
  message: string,
): void {
  const diagnostic: ExtensionRuntimeDiagnostic = {
    candidate: entry.candidate,
    id: entry.id,
    phase,
    code,
    message,
  }
  ;(options.diagnostics ?? extensionRuntimeDiagnostics).record(diagnostic)
  try {
    options.onDiagnostic?.(diagnostic)
  } catch {
    // A diagnostic reporter must not affect the next package in the sequence.
  }
}

function isIdentityMatch(value: unknown, entry: ExtensionInventoryEntry): value is Extension {
  if (typeof value !== 'object' || value === null) return false
  const manifest = (value as { manifest?: unknown }).manifest
  if (typeof manifest !== 'object' || manifest === null) return false
  const identity = manifest as { id?: unknown; version?: unknown }
  return typeof identity.id === 'string' && identity.id === entry.id
    && typeof identity.version === 'string' && identity.version === entry.version
}

/** Load admitted packages sequentially into the already-created registry. */
export async function loadExternalExtensions(
  inventory: ExtensionInventoryResponse,
  options: ExternalExtensionLoaderOptions,
): Promise<void> {
  if (!inventory.available) return
  for (const entry of inventory.extensions) {
    if (entry.status !== 'ready' || entry.frontendUrl === null || entry.id === null || entry.version === null) continue
    let module: ImportedModule
    try {
      module = await (options.importModule ?? defaultImport)(entry.frontendUrl)
    } catch {
      report(options, entry, 'import', 'import-failed', 'the frontend module could not be loaded')
      continue
    }
    if (!isIdentityMatch(module.default, entry)) {
      report(options, entry, 'identity', 'manifest-mismatch', 'the loaded module manifest does not match the approved package')
      continue
    }
    let record
    try {
      record = options.registry.register(module.default, { grantedPermissions: entry.grantedPermissions })
    } catch {
      report(options, entry, 'register', 'registration-failed', 'the frontend module could not be registered')
      continue
    }
    try {
      const activated = await options.registry.activate(record.id)
      if (activated.status === 'failed') {
        report(options, entry, 'activate', 'activation-failed', activated.error?.message ?? 'the frontend module could not be activated')
      }
    } catch {
      // The real registry normally isolates activation and returns a failed record. This guard is
      // for an unknown registry implementation and keeps one package from stopping the sequence.
      report(options, entry, 'activate', 'activation-failed', 'the frontend module could not be activated')
    }
  }
}

/** Boot bridge: inventory fetch failures are page-local and never reject the cockpit boot. */
export async function loadExternalExtensionsFromServer(
  options: ExternalExtensionLoaderOptions,
): Promise<void> {
  let inventory: ExtensionInventoryResponse
  try {
    inventory = await getExtensions()
  } catch {
    const entry: ExtensionInventoryEntry = {
      candidate: '(local extensions)', id: null, name: null, version: null, description: null,
      entrypoints: { frontend: null, backend: null }, status: 'rejected', requestedPermissions: [],
      grantedPermissions: [], frontendUrl: null, diagnostic: null,
    }
    report(options, entry, 'inventory', 'inventory-unavailable', 'local extensions could not be discovered')
    return
  }
  await loadExternalExtensions(inventory, options)
}
