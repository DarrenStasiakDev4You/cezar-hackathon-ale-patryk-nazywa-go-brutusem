import { describe, expect, it } from 'vitest'

import { TaskHeaderMain } from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { createCoreComponentRegistry } from './core-components'
import { coreDefaultComponentId } from './resolve'
import { ComponentPreferenceError, createComponentPreferences, type ComponentPreferencesStorage } from './preferences'

function setup(initial: Record<string, unknown> = {}, save: ComponentPreferencesStorage['save'] = async () => undefined) {
  const registry = createCoreComponentRegistry({ onDiagnostic: () => {} })
  registry.forExtension(fakeScope('acme.jira').scope).provide(TaskHeaderMain, {
    id: 'acme.jira.task-header',
    title: 'Jira header',
    capabilities: ['shows-title', 'shows-status', 'shows-meta'],
    component: () => null,
  })
  let saved: Record<string, unknown> | undefined
  const storage: ComponentPreferencesStorage = {
    load: async () => initial,
    save: async (value) => {
      saved = value
      await save(value)
    },
  }
  const preferences = createComponentPreferences({
    registry,
    contracts: [TaskHeaderMain],
    storage,
  })
  return { preferences, getSaved: () => saved }
}

describe('component preferences', () => {
  it('hydrates valid choices and preserves unrelated component state on save', async () => {
    const { preferences, getSaved } = setup({ settings: { future: true }, implementations: { [TaskHeaderMain.id]: 'acme.jira.task-header' } })
    await preferences.ready

    expect(preferences.get(TaskHeaderMain.id)).toBe('acme.jira.task-header')
    await preferences.reset(TaskHeaderMain.id)
    expect(getSaved()).toEqual({ settings: { future: true }, implementations: {} })
  })

  it('accepts a compatible implementation and updates readers without a restart', async () => {
    const { preferences, getSaved } = setup()
    await preferences.ready

    await preferences.set(TaskHeaderMain.id, 'acme.jira.task-header')

    expect(preferences.get(TaskHeaderMain.id)).toBe('acme.jira.task-header')
    expect(getSaved()).toEqual({ implementations: { [TaskHeaderMain.id]: 'acme.jira.task-header' } })
  })

  it('never stores core default and reset removes the override', async () => {
    const { preferences } = setup({ implementations: { [TaskHeaderMain.id]: 'acme.jira.task-header' } })
    await preferences.ready

    await expect(preferences.set(TaskHeaderMain.id, coreDefaultComponentId(TaskHeaderMain.id))).rejects.toMatchObject({
      code: 'is-default',
    })
    await preferences.reset(TaskHeaderMain.id)
    expect(preferences.get(TaskHeaderMain.id)).toBeUndefined()
  })

  it('rejects unknown implementations and restores the previous value when saving fails', async () => {
    const { preferences } = setup()
    await preferences.ready

    await expect(preferences.set(TaskHeaderMain.id, 'acme.missing.task-header')).rejects.toMatchObject({
      code: 'not-found',
    })

    const broken = setup({}, async () => {
      throw new Error('read-only')
    }).preferences
    await broken.ready
    await expect(broken.set(TaskHeaderMain.id, 'acme.jira.task-header')).rejects.toBeInstanceOf(ComponentPreferenceError)
    expect(broken.get(TaskHeaderMain.id)).toBeUndefined()
  })

  it('serializes a rapid set and reset from the latest snapshot', async () => {
    let releaseFirst: (() => void) | undefined
    const firstSave = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const saved: Record<string, unknown>[] = []
    const { preferences } = setup({}, async (value) => {
      saved.push(value)
      if (saved.length === 1) await firstSave
    })
    await preferences.ready

    const first = preferences.set(TaskHeaderMain.id, 'acme.jira.task-header')
    const second = preferences.reset(TaskHeaderMain.id)
    releaseFirst?.()
    await Promise.all([first, second])

    expect(saved).toEqual([
      { implementations: { [TaskHeaderMain.id]: 'acme.jira.task-header' } },
      { implementations: {} },
    ])
    expect(preferences.get(TaskHeaderMain.id)).toBeUndefined()
  })
})
