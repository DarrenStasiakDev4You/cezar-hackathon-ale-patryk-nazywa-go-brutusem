import { getApiScope } from '@open-mercato/cezar-api-client'
import type { ComponentSettingsScope, ContributionId, JsonValue } from '@open-mercato/cezar-extension-api'
import { getUiState, getWorkspaceUiState, putUiState, putWorkspaceUiState } from '../api/client'

export type ComponentSettingsTarget = { readonly scope: 'global' } | { readonly scope: 'project'; readonly projectId: string }
export interface ComponentSettingsStore {
  get(target: ComponentSettingsTarget, componentId: ContributionId): Promise<JsonValue | undefined>
  set(target: ComponentSettingsTarget, componentId: ContributionId, value: JsonValue): Promise<void>
  clear(target: ComponentSettingsTarget, componentId: ContributionId): Promise<void>
  subscribe(listener: (target: ComponentSettingsTarget, componentId: ContributionId) => void): () => void
}
export type ComponentSettingsErrorCode = 'invalid-settings' | 'settings-unavailable' | 'disposed'
export class ComponentSettingsError extends Error { override readonly name = 'ComponentSettingsError'; constructor(readonly code: ComponentSettingsErrorCode, message: string) { super(message) } }

export function createMemoryComponentSettingsStore(initial: Readonly<Record<string, JsonValue>> = {}): ComponentSettingsStore {
  const values = new Map(Object.entries(initial)); const listeners = new Set<ComponentSettingsStore['subscribe'] extends (listener: infer L) => unknown ? L : never>()
  const key = (target: ComponentSettingsTarget, id: string) => `${target.scope}:${target.scope === 'project' ? `${target.projectId}:` : ''}${id}`
  const notify = (target: ComponentSettingsTarget, id: ContributionId) => { for (const listener of [...listeners]) { try { listener(target, id) } catch {} } }
  return {
    async get(target, id) { return values.get(key(target, id)) },
    async set(target, id, value) { values.set(key(target, id), value); notify(target, id) },
    async clear(target, id) { values.delete(key(target, id)); notify(target, id) },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

export function resolveComponentProjectId(): string | null {
  if (typeof window === 'undefined') return getApiScope()
  const match = /^\/p\/([^/]+)(?:\/|$)/.exec(window.location.pathname)
  return match?.[1] === undefined ? null : decodeURIComponent(match[1])
}

export function targetForScope(scope: ComponentSettingsScope, resolve: () => string | null): ComponentSettingsTarget {
  if (scope === 'global') return { scope: 'global' }
  const projectId = resolve(); if (!projectId) throw new ComponentSettingsError('settings-unavailable', 'Project-scoped settings need an active project')
  return { scope: 'project', projectId }
}

export function createPersistentComponentSettingsStore(options: { readonly resolveProjectId?: () => string | null } = {}): ComponentSettingsStore {
  const resolve = options.resolveProjectId ?? resolveComponentProjectId; const listeners = new Set<(target: ComponentSettingsTarget, id: ContributionId) => void>(); const tails = new Map<string, Promise<void>>()
  const verify = (target: ComponentSettingsTarget) => { if (target.scope === 'project' && target.projectId !== resolve()) throw new ComponentSettingsError('settings-unavailable', 'The active project changed before the settings operation completed') }
  const read = async (target: ComponentSettingsTarget) => { verify(target); const state = target.scope === 'global' ? await getWorkspaceUiState() : await getUiState(); const value = state.componentSettings; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Record<string, boolean>> : {} }
  const write = async (target: ComponentSettingsTarget, map: Record<string, Record<string, boolean>>) => { verify(target); if (target.scope === 'global') await putWorkspaceUiState({ componentSettings: map }); else await putUiState({ componentSettings: map }) }
  const notify = (target: ComponentSettingsTarget, id: ContributionId) => { for (const listener of [...listeners]) { try { listener(target, id) } catch {} } }
  const enqueue = (target: ComponentSettingsTarget, task: () => Promise<void>) => { const key = `${target.scope}:${target.scope === 'project' ? target.projectId : ''}`; const previous = tails.get(key) ?? Promise.resolve(); const next = previous.catch(() => {}).then(task); const settled = next.catch(() => {}).finally(() => { if (tails.get(key) === settled) tails.delete(key) }); tails.set(key, settled); return next }
  return {
    async get(target, id) { return (await read(target))[id] },
    set(target, id, value) { return enqueue(target, async () => { const map = await read(target); if (!isBooleanMap(value)) throw new ComponentSettingsError('invalid-settings', 'Component settings must be a boolean map'); await write(target, { ...map, [id]: value as Record<string, boolean> }); notify(target, id) }) },
    clear(target, id) { return enqueue(target, async () => { const map = await read(target); if (!(id in map)) return; const next = { ...map }; delete next[id]; await write(target, next); notify(target, id) }) },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}
function isBooleanMap(value: unknown): value is Record<string, boolean> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'boolean') }
