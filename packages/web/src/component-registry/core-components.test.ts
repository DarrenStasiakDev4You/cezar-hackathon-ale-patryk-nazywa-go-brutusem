import { describe, expect, it } from 'vitest'

import { checkComponentCompatibility, TaskHeaderMain } from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { coreTaskHeaderMain, registerCoreComponents } from './core-components'
import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { createComponentRegistry } from './registry'
import { coreDefaultComponentId, missingCoreDefaults, resolveComponent } from './resolve'

/** A registry filled the way `main.tsx` fills it. */
function bootRegistry() {
  const registry = createComponentRegistry({ contracts: CORE_COMPONENT_CONTRACTS, onDiagnostic: () => {} })
  registerCoreComponents(registry)
  return registry
}

describe('core defaults: the gate', () => {
  it('serves the task header’s main part', () => {
    expect(CORE_COMPONENT_CONTRACTS).toEqual([TaskHeaderMain])
  })

  it('leaves no served contract without core’s default on a registry filled the way main.tsx fills it', () => {
    expect(missingCoreDefaults(bootRegistry(), CORE_COMPONENT_CONTRACTS)).toEqual([])
  })

  it('fails without registerCoreComponents, so the check is shown to fail', () => {
    const registry = createComponentRegistry({ contracts: CORE_COMPONENT_CONTRACTS })

    expect(missingCoreDefaults(registry, CORE_COMPONENT_CONTRACTS)).toEqual(['cezar.task.header.main'])
  })
})

describe('coreTaskHeaderMain', () => {
  it('fits its contract and declares all three capabilities', () => {
    expect(checkComponentCompatibility(TaskHeaderMain, coreTaskHeaderMain)).toEqual({
      compatible: true,
      issues: [],
      capabilities: ['shows-title', 'shows-status', 'shows-meta'],
    })
  })

  it('is registered as core’s default, which renders and is always the fallback', () => {
    const registry = bootRegistry()

    expect(registry.get(coreDefaultComponentId(TaskHeaderMain.id))).toMatchObject({
      componentId: 'cezar.task.header.main.default',
      extensionId: null,
      compatible: true,
      component: coreTaskHeaderMain.component,
    })
    const resolution = resolveComponent(registry, TaskHeaderMain)
    if (resolution.status !== 'resolved') throw new Error('expected core’s default')
    expect(resolution.component.componentId).toBe('cezar.task.header.main.default')
    expect(resolution.fallback).toBe(resolution.component)
  })

  it('keeps core’s id: registered before the extension host, it cannot be taken by an extension', () => {
    const registry = bootRegistry()
    const components = registry.forExtension(fakeScope('cezar.task').scope)

    expect(() =>
      components.provide(TaskHeaderMain, { ...coreTaskHeaderMain, title: 'Impostor header' }),
    ).toThrow(/already provided by core/)
    expect(registry.get(coreTaskHeaderMain.id)?.extensionId).toBeNull()
  })
})
