import { describe, expect, it, vi } from 'vitest'

import type { ExtensionInventoryResponse } from '@open-mercato/cezar-api-client'
import { loadExternalExtensions, extensionRuntimeDiagnostics } from './loader'

const entry = (overrides: Record<string, unknown> = {}) => ({
  candidate: 'demo', id: 'acme.demo', name: 'Demo', version: '1.0.0', description: null,
  entrypoints: { frontend: './dist/frontend.js', backend: null }, status: 'ready' as const,
  requestedPermissions: ['events'], grantedPermissions: ['events'],
  frontendUrl: '/api/v1/extensions/acme.demo/assets/dist/frontend.js', diagnostic: null,
  ...overrides,
})

function inventory(entries: readonly ReturnType<typeof entry>[]): ExtensionInventoryResponse {
  return { available: true, directory: '~/.cezar/extensions', scannedAt: new Date().toISOString(), extensions: [...entries], diagnostics: [], canApprove: true }
}

describe('local extension browser loader', () => {
  it('imports only admitted packages in order and passes the exact grant', async () => {
    const calls: string[] = []
    const grants: string[][] = []
    const registry = {
      register(extension: any, options: { grantedPermissions: readonly string[] }) {
        calls.push(`register:${extension.manifest.id}`)
        grants.push([...options.grantedPermissions])
        return { id: extension.manifest.id }
      },
      async activate(id: string) { calls.push(`activate:${id}`); return { status: 'active' } },
    }
    const importModule = vi.fn(async (url: string) => {
      calls.push(`import:${url}`)
      const id = url.includes('other') ? 'acme.other' : 'acme.demo'
      const version = id === 'acme.other' ? '2.0.0' : '1.0.0'
      return { default: { manifest: { id, version }, activate: () => {} } }
    })
    const other = entry({ candidate: 'other', id: 'acme.other', version: '2.0.0', grantedPermissions: [], frontendUrl: '/api/v1/extensions/acme.other/assets/dist/frontend.js' })
    await loadExternalExtensions(inventory([entry(), other]), { registry: registry as any, importModule })
    expect(importModule).toHaveBeenCalledTimes(2)
    expect(calls[0]).toContain('/acme.demo/')
    expect(calls[3]).toContain('/acme.other/')
    expect(grants[0]).toEqual(['events'])
  })

  it('continues after an import failure and never imports non-ready entries', async () => {
    const imported: string[] = []
    const reports: string[] = []
    const registry = { register: vi.fn(() => ({ id: 'acme.good' })), activate: vi.fn(async () => ({ status: 'active' })) }
    const bad = entry({ candidate: 'pending', id: 'acme.pending', status: 'permission-required', frontendUrl: null })
    const good = entry({ candidate: 'good', id: 'acme.good', version: '1.1.0', frontendUrl: '/api/v1/extensions/acme.good/assets/dist/frontend.js' })
    await loadExternalExtensions(inventory([bad, good]), {
      registry: registry as any,
      importModule: async (url) => {
        imported.push(url)
        if (url.includes('good')) throw new Error('broken')
        return { default: { manifest: { id: 'acme.good', version: '1.1.0' }, activate: () => {} } }
      },
      onDiagnostic: (diagnostic) => reports.push(diagnostic.code),
    })
    expect(imported).toHaveLength(1)
    expect(reports).toEqual(['import-failed'])
    expect(registry.register).not.toHaveBeenCalled()
  })

  it('rejects a module identity mismatch and continues to the next package', async () => {
    const reports: string[] = []
    const registry = { register: vi.fn(() => ({ id: 'acme.next' })), activate: vi.fn(async () => ({ status: 'active' })) }
    const next = entry({ candidate: 'next', id: 'acme.next' })
    let count = 0
    await loadExternalExtensions(inventory([entry(), next]), {
      registry: registry as any,
      importModule: async () => {
        count += 1
        return { default: { manifest: { id: count === 1 ? 'acme.wrong' : 'acme.next', version: '1.0.0' }, activate: () => {} } }
      },
      onDiagnostic: (diagnostic) => reports.push(diagnostic.code),
    })
    expect(reports).toEqual(['manifest-mismatch'])
    expect(registry.register).toHaveBeenCalledTimes(1)
  })

  it('keeps runtime diagnostics page-local and immutable to consumers', () => {
    const before = extensionRuntimeDiagnostics.list()
    extensionRuntimeDiagnostics.record({ candidate: 'x', id: null, phase: 'import', code: 'test', message: 'test' })
    expect(extensionRuntimeDiagnostics.list()).toHaveLength(before.length + 1)
    expect(Object.isFrozen(extensionRuntimeDiagnostics.list().at(-1))).toBe(true)
  })
})
