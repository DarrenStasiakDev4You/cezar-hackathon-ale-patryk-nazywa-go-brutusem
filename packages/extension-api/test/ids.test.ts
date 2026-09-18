import { describe, expect, it } from 'vitest'

import { isValidContributionId, isValidExtensionId } from '../src/index.ts'

describe('isValidExtensionId', () => {
  it.each(['acme.tasks', 'a.b', 'acme-inc.compact-tasks', '0x.9lives', 'cezar.core'])('accepts %s', (id) => {
    expect(isValidExtensionId(id)).toBe(true)
  })

  it('accepts the reserved `cezar` publisher — the host, not the grammar, rejects it', () => {
    expect(isValidExtensionId('cezar.anything')).toBe(true)
  })

  it.each([
    ['one segment', 'acme'],
    ['three segments', 'acme.tasks.extra'],
    ['upper case', 'Acme.tasks'],
    ['leading hyphen', 'acme.-tasks'],
    ['underscore', 'acme.my_tasks'],
    ['empty segment', 'acme..tasks'],
    ['trailing dot', 'acme.tasks.'],
    ['whitespace', ' acme.tasks'],
    ['empty', ''],
  ])('rejects %s', (_label, id) => {
    expect(isValidExtensionId(id)).toBe(false)
  })

  it('allows at most 64 characters', () => {
    const at = `${'a'.repeat(31)}.${'b'.repeat(32)}`
    expect(at).toHaveLength(64)
    expect(isValidExtensionId(at)).toBe(true)
    expect(isValidExtensionId(`${at}b`)).toBe(false)
  })

  it('answers false for a non-string instead of throwing', () => {
    expect(isValidExtensionId(42 as unknown as string)).toBe(false)
    expect(isValidExtensionId(undefined as unknown as string)).toBe(false)
  })
})

describe('isValidContributionId', () => {
  it.each(['acme.tasks.open-next', 'acme.tasks', 'a.b.c.d.e', 'cezar.tasks.list'])('accepts %s', (id) => {
    expect(isValidContributionId(id)).toBe(true)
  })

  it.each([
    ['one segment', 'open-next'],
    ['upper case', 'acme.tasks.OpenNext'],
    ['empty segment', 'acme..open'],
    ['slash', 'acme/tasks.open'],
    ['empty', ''],
  ])('rejects %s', (_label, id) => {
    expect(isValidContributionId(id)).toBe(false)
  })

  it('allows at most 128 characters', () => {
    const at = `acme.${'x'.repeat(123)}`
    expect(at).toHaveLength(128)
    expect(isValidContributionId(at)).toBe(true)
    expect(isValidContributionId(`${at}x`)).toBe(false)
  })

  it('answers false for a non-string instead of throwing', () => {
    expect(isValidContributionId(null as unknown as string)).toBe(false)
  })
})
