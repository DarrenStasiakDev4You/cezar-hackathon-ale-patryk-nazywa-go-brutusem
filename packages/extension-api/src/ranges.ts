export type ComparatorOperator = '=' | '>' | '>=' | '<' | '<='

export interface SemverVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly (string | number)[]
}

export interface Comparator {
  readonly operator: ComparatorOperator
  readonly version: SemverVersion
}

export type ComparatorSet = readonly Comparator[]

const MAX_RANGE_LENGTH = 64
const MAX_COMPARATOR_SETS = 8
const BUILD_IDENTIFIER = '[0-9A-Za-z-]+'
const PRE_RELEASE_IDENTIFIER = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
const VERSION_PART = '(?:0|[1-9][0-9]*)'
const PRE_RELEASE = `(?:-${PRE_RELEASE_IDENTIFIER}(?:[.]${PRE_RELEASE_IDENTIFIER})*)?`
const BUILD = `(?:[+]${BUILD_IDENTIFIER}(?:[.]${BUILD_IDENTIFIER})*)?`
const FULL_VERSION = new RegExp(`^(${VERSION_PART})[.](${VERSION_PART})[.](${VERSION_PART})${PRE_RELEASE}${BUILD}$`)
const RANGE_VERSION = new RegExp(
  `^(0|[1-9][0-9]*|[xX*])(?:[.](0|[1-9][0-9]*|[xX*]))?(?:[.](0|[1-9][0-9]*|[xX*]))?${PRE_RELEASE}${BUILD}$`,
)

interface RangeVersion extends SemverVersion {
  readonly specified: number
  readonly wildcard: boolean
}

function parseIdentifiers(text: string | undefined): readonly (string | number)[] {
  if (text === undefined) return []
  return text.split('.').map((identifier) => (/^(0|[1-9][0-9]*)$/.test(identifier) ? Number(identifier) : identifier))
}

function parseVersionParts(match: RegExpExecArray, specified: number, wildcard: boolean): RangeVersion {
  const prereleaseStart = match[0].indexOf('-')
  const buildStart = match[0].indexOf('+')
  const prerelease = prereleaseStart < 0 ? undefined : match[0].slice(prereleaseStart + 1, buildStart < 0 ? undefined : buildStart)
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: parseIdentifiers(prerelease),
    specified,
    wildcard,
  }
}

function parseRangeVersion(text: string): RangeVersion | null {
  const match = RANGE_VERSION.exec(text)
  if (match === null) return null

  const parts = [match[1], match[2], match[3]]
  const wildcard = parts.some((part) => part === undefined || part === 'x' || part === 'X' || part === '*')
  const firstWildcard = parts.findIndex((part) => part === undefined || part === 'x' || part === 'X' || part === '*')
  if (firstWildcard >= 0 && parts.slice(firstWildcard + 1).some((part) => part !== undefined && !['x', 'X', '*'].includes(part))) {
    return null
  }

  const specified = parts.filter((part) => part !== undefined && !['x', 'X', '*'].includes(part)).length
  if (specified !== 3 && (text.includes('-') || text.includes('+'))) return null
  const prereleaseStart = text.indexOf('-')
  const buildStart = text.indexOf('+')
  if (prereleaseStart >= 0) {
    const prerelease = text.slice(prereleaseStart + 1, buildStart < 0 ? undefined : buildStart)
    if (prerelease.split('.').some((identifier) => /^0[0-9]+$/.test(identifier))) return null
  }
  return parseVersionParts(match, specified, wildcard)
}

export function parseVersion(text: string): SemverVersion | null {
  if (typeof text !== 'string' || FULL_VERSION.exec(text) === null) return null
  const parsed = parseRangeVersion(text)
  return parsed === null ? null : {
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    prerelease: parsed.prerelease,
  }
}

function withoutRangeFields(version: RangeVersion): SemverVersion {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch,
    prerelease: version.prerelease,
  }
}

function boundary(version: RangeVersion, position: number): SemverVersion {
  if (position <= 0) return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
  if (position === 1) return { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [] }
  return { major: version.major, minor: version.minor, patch: version.patch + 1, prerelease: [] }
}

function parseComparator(text: string): ComparatorSet | null {
  const match = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(text)
  if (match === null) return null
  const operator = match[1] as '^' | '~' | '>=' | '<=' | '>' | '<' | '=' | undefined
  const version = parseRangeVersion(match[2] ?? '')
  if (version === null) return null
  if (version.wildcard && version.specified === 0) return []

  if (operator === '^' || operator === '~') {
    const upper = operator === '^'
      ? version.major > 0
        ? boundary(version, 0)
        : version.specified < 3
          ? version.specified === 1
            ? boundary(version, 0)
            : boundary(version, 1)
          : version.minor > 0
            ? boundary(version, 1)
            : boundary(version, 2)
      : boundary(version, version.specified <= 1 ? 0 : 1)
    return [
      { operator: '>=', version: withoutRangeFields(version) },
      { operator: '<', version: upper },
    ]
  }

  if (version.wildcard || version.specified < 3) {
    if (operator === undefined || operator === '=') {
      if (version.specified === 0) return []
      return [
        { operator: '>=', version: withoutRangeFields(version) },
        { operator: '<', version: boundary(version, version.specified - 1) },
      ]
    }
    if (operator === '>') {
      return [{ operator: '>=', version: boundary(version, version.specified - 1) }]
    }
    if (operator === '<=') {
      return [{ operator: '<', version: boundary(version, version.specified - 1) }]
    }
    return [{ operator, version: withoutRangeFields(version) }]
  }

  return [{ operator: operator ?? '=', version: withoutRangeFields(version) }]
}

/** Parses the supported range subset. `null` means the input is not understood. */
export function parseRange(text: string): ComparatorSet[] | null {
  if (typeof text !== 'string' || text.length > MAX_RANGE_LENGTH) return null
  const alternatives = text.trim().split('||')
  if (alternatives.length > MAX_COMPARATOR_SETS || alternatives.some((alternative) => alternative.trim() === '')) return null

  const sets: ComparatorSet[] = []
  for (const alternative of alternatives) {
    const tokens = alternative.trim().match(/\S+/g)
    if (tokens === null) return null
    const comparators: Comparator[] = []
    for (const token of tokens) {
      const parsed = parseComparator(token)
      if (parsed === null) return null
      comparators.push(...parsed)
    }
    sets.push(comparators)
  }
  return sets
}

function compareIdentifiers(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'number') return -1
  if (typeof right === 'number') return 1
  return left < right ? -1 : left > right ? 1 : 0
}

function compareVersions(left: SemverVersion, right: SemverVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    const comparison = compareIdentifiers(leftIdentifier, rightIdentifier)
    if (comparison !== 0) return comparison
  }
  return 0
}

function satisfiesComparator(version: SemverVersion, comparator: Comparator): boolean {
  const comparison = compareVersions(version, comparator.version)
  switch (comparator.operator) {
    case '=': return comparison === 0
    case '>': return comparison > 0
    case '>=': return comparison >= 0
    case '<': return comparison < 0
    case '<=': return comparison <= 0
  }
}

function hasMatchingPrereleaseComparator(version: SemverVersion, set: ComparatorSet): boolean {
  return set.some((comparator) =>
    comparator.version.prerelease.length > 0 &&
    comparator.version.major === version.major &&
    comparator.version.minor === version.minor &&
    comparator.version.patch === version.patch,
  )
}

/** Returns whether a full semver release is admitted by any parsed comparator set. */
export function satisfies(version: string | SemverVersion, sets: readonly ComparatorSet[]): boolean {
  const parsed = typeof version === 'string' ? parseVersion(version) : version
  if (parsed === null || parsed === undefined) return false
  return sets.some((set) =>
    set.every((comparator) => satisfiesComparator(parsed, comparator)) &&
    (parsed.prerelease.length === 0 || hasMatchingPrereleaseComparator(parsed, set)),
  )
}
