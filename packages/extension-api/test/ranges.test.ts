import { describe, expect, it } from 'vitest'

import { parseRange, satisfies } from '../src/ranges.ts'

describe('parseRange', () => {
  it.each([
    '0.12.0',
    '=0.12.0',
    '^0.12.0',
    '~0.12.3',
    '>=0.12.0',
    '<0.13.0',
    '0.12',
    '0',
    '0.12.x',
    '*',
    '>=0.12.0-rc.1 <0.13.0',
    '^0.12.0 || ^0.13.0',
  ])('accepts %s', (range) => {
    expect(parseRange(range)).not.toBeNull()
  })

  it.each([
    '',
    '   ',
    '0.12.0 - 0.14.0',
    'not-a-range',
    '1.2.3.4',
    '1.x.2',
    '1.2.3-01',
    '>= 0.12.0',
    Array.from({ length: 9 }, (_, index) => `^${index}.0.0`).join(' || '),
    '0.12.0'.repeat(11),
  ])('rejects %s', (range) => {
    expect(parseRange(range)).toBeNull()
  })
})

describe('satisfies', () => {
  it.each<[string, string, boolean]>([
    ['0.12.0', '0.12.0', true],
    ['0.12.0', '0.12.1', false],
    ['^0.12.0', '0.12.9', true],
    ['^0.12.0', '0.13.0', false],
    ['~0.12.3', '0.12.9', true],
    ['~0.12.3', '0.13.0', false],
    ['0.12', '0.12.9', true],
    ['0.12', '0.13.0', false],
    ['0', '0.9.0', true],
    ['>=0.12.0 <0.13.0', '0.12.5', true],
    ['>=0.12.0 <0.13.0', '0.13.0', false],
    ['^0.12.0 || ^0.13.0', '0.13.4', true],
    ['^0.12.0 || ^0.13.0', '0.14.0', false],
    ['^0.12.0', '0.12.0+build.5', true],
    ['^0.12.0', '0.12.0-rc.1', false],
    ['>=0.12.0-rc.1 <0.13.0', '0.12.0-rc.1', true],
    ['>=0.12.0-rc.1 <0.13.0', '0.12.0-rc.2', true],
    ['>=0.12.0-rc.1 <0.13.0', '0.12.1-rc.1', false],
  ])('%s admits %s: %s', (range, version, expected) => {
    const parsed = parseRange(range)
    expect(parsed).not.toBeNull()
    expect(satisfies(version, parsed ?? [])).toBe(expected)
  })
})
