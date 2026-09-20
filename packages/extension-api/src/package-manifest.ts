import type { ExtensionId } from './ids.ts'
import { validateManifest, type ExtensionManifest, type ManifestIssue } from './manifest.ts'
import type { ExtensionPermission } from './permissions.ts'
import { parseRange, parseVersion, satisfies } from './ranges.ts'

/** The extension API generation implemented by this package. */
export const EXTENSION_API_VERSION = 1

export type EntrypointKind = 'frontend' | 'backend'

export interface ExtensionPackageManifest extends ExtensionManifest {
  readonly id: ExtensionId
  readonly homepage?: string
  readonly repository?: string
  readonly cezar: { readonly apiVersion: number }
  readonly entrypoints: {
    readonly frontend: string
    readonly backend?: string
  }
}

export interface HostIdentity {
  readonly apiVersions: readonly number[]
  readonly release: string
  readonly entrypoints: readonly EntrypointKind[]
}

export type PackageCompatibilityIssue =
  | { readonly code: 'malformed'; readonly message: string; readonly path: string }
  | { readonly code: 'unsupported-api-version'; readonly message: string; readonly expected: readonly number[]; readonly actual: number }
  | { readonly code: 'unsupported-range'; readonly message: string; readonly actual: string }
  | { readonly code: 'release-out-of-range'; readonly message: string; readonly expected: string; readonly actual: string }
  | { readonly code: 'unsupported-entrypoint'; readonly message: string; readonly kind: EntrypointKind }

export interface PackageCompatibility {
  readonly compatible: boolean
  readonly issues: readonly PackageCompatibilityIssue[]
}

const MAX_URL_LENGTH = 2048
const MAX_ENTRYPOINT_LENGTH = 256
const PACKAGE_PERMISSIONS: readonly ExtensionPermission[] = [
  'ui.components',
  'commands.execute',
  'storage',
  'events',
  'network',
  'notifications',
]
const PACKAGE_PERMISSION_SET = new Set<string>(PACKAGE_PERMISSIONS)
const URL_PATTERN = /^https:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/
const ENTRYPOINT_SEGMENT = /^[A-Za-z0-9._-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addUnknownMemberIssues(
  value: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  issues: ManifestIssue[],
): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push({ path: `${prefix}.${key}`, message: 'must not contain unknown members' })
  }
}

function isHttpsUrl(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_URL_LENGTH && URL_PATTERN.test(value)
}

function isEntrypointPath(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENTRYPOINT_LENGTH || !value.startsWith('./')) return false
  const segments = value.slice(2).split('/')
  return segments.length > 0 &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..' && ENTRYPOINT_SEGMENT.test(segment)) &&
    /\.(?:js|mjs)$/.test(value)
}

function validatePackageManifestValue(value: unknown): ManifestIssue[] {
  const issues = validateManifest(value)
  if (!isRecord(value)) return issues

  const cezar = value.cezar
  const entrypoints = value.entrypoints
  const apiVersion = isRecord(cezar) ? cezar.apiVersion : undefined
  const generationIsKnown = apiVersion === EXTENSION_API_VERSION

  if (!isRecord(cezar)) {
    issues.push({
      path: cezar === undefined ? 'cezar.apiVersion' : 'cezar',
      message: cezar === undefined ? 'must be an integer from 1 through 1000' : 'must be an object with an `apiVersion`',
    })
  } else if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion) || apiVersion < 1 || apiVersion > 1000) {
    issues.push({ path: 'cezar.apiVersion', message: 'must be an integer from 1 through 1000' })
  }

  if (!isRecord(entrypoints)) {
    issues.push({
      path: entrypoints === undefined ? 'entrypoints.frontend' : 'entrypoints',
      message: entrypoints === undefined ? 'must be a package-relative .js or .mjs path' : 'must be an object with entrypoint paths',
    })
  } else {
    if (!isEntrypointPath(entrypoints.frontend)) {
      issues.push({ path: 'entrypoints.frontend', message: 'must be a package-relative .js or .mjs path' })
    }
    if (entrypoints.backend !== undefined && !isEntrypointPath(entrypoints.backend)) {
      issues.push({ path: 'entrypoints.backend', message: 'must be a package-relative .js or .mjs path' })
    }
  }

  if (value.homepage !== undefined && !isHttpsUrl(value.homepage)) {
    issues.push({ path: 'homepage', message: `must be an absolute https URL of at most ${MAX_URL_LENGTH} characters` })
  }
  if (value.repository !== undefined && !isHttpsUrl(value.repository)) {
    issues.push({ path: 'repository', message: `must be an absolute https URL of at most ${MAX_URL_LENGTH} characters` })
  }

  if (generationIsKnown) {
    if (isRecord(cezar)) addUnknownMemberIssues(cezar, ['apiVersion'], 'cezar', issues)
    if (isRecord(entrypoints)) addUnknownMemberIssues(entrypoints, ['frontend', 'backend'], 'entrypoints', issues)
    if (Array.isArray(value.permissions)) {
      for (let index = 0; index < value.permissions.length; index += 1) {
        const permission = value.permissions[index]
        if (typeof permission === 'string' && !PACKAGE_PERMISSION_SET.has(permission)) {
          issues.push({ path: `permissions[${index}]`, message: 'must be a permission supported by this API generation' })
        }
      }
    }
  }

  return issues
}

/** Returns every package-manifest issue without executing extension code. */
export function validatePackageManifest(value: unknown): ManifestIssue[] {
  try {
    return validatePackageManifestValue(value)
  } catch {
    return [{ path: '', message: 'must be a readable object' }]
  }
}

function malformed(path: string, message: string): PackageCompatibilityIssue {
  return { code: 'malformed', path, message }
}

function freezeCompatibility(issues: PackageCompatibilityIssue[]): PackageCompatibility {
  const frozenIssues = issues.map((issue) => Object.freeze(issue))
  return Object.freeze({
    compatible: frozenIssues.length === 0,
    issues: Object.freeze(frozenIssues),
  })
}

function hostIssues(value: unknown): PackageCompatibilityIssue[] {
  if (!isRecord(value)) return [malformed('host', 'must be an object')]

  const issues: PackageCompatibilityIssue[] = []
  const apiVersions = value.apiVersions
  if (!Array.isArray(apiVersions)) {
    issues.push(malformed('host.apiVersions', 'must be an array of API version numbers'))
  } else {
    for (let index = 0; index < apiVersions.length; index += 1) {
      const version = apiVersions[index]
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        issues.push(malformed(`host.apiVersions[${index}]`, 'must be a positive integer'))
      }
    }
  }

  const release = value.release
  if (typeof release !== 'string' || parseVersion(release) === null) {
    issues.push(malformed('host.release', 'must be a semver version'))
  }

  const entrypoints = value.entrypoints
  if (!Array.isArray(entrypoints)) {
    issues.push(malformed('host.entrypoints', 'must be an array of entrypoint kinds'))
  } else {
    for (let index = 0; index < entrypoints.length; index += 1) {
      const kind = entrypoints[index]
      if (kind !== 'frontend' && kind !== 'backend') {
        issues.push(malformed(`host.entrypoints[${index}]`, 'must be `frontend` or `backend`'))
      }
    }
  }
  return issues
}

function readPackageFields(value: unknown): {
  readonly apiVersion: number
  readonly releaseRange: string
  readonly entrypoints: Record<string, unknown>
} {
  const manifest = value as Record<string, unknown>
  const cezar = manifest.cezar as Record<string, unknown>
  return {
    apiVersion: cezar.apiVersion as number,
    releaseRange: (manifest.engines as Record<string, unknown>).cezar as string,
    entrypoints: manifest.entrypoints as Record<string, unknown>,
  }
}

function containsNumber(values: readonly number[], expected: number): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true
  }
  return false
}

function containsEntrypoint(values: readonly EntrypointKind[], expected: EntrypointKind): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true
  }
  return false
}

function copyNumbers(values: readonly number[]): readonly number[] {
  const copy: number[] = []
  for (let index = 0; index < values.length; index += 1) copy.push(values[index] as number)
  return Object.freeze(copy)
}

function describeNumbers(values: readonly number[]): string {
  let description = ''
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) description += ', '
    description += String(values[index])
  }
  return description
}

/** Decides whether a package can run on a host without executing the package. */
export function checkPackageCompatibility(manifest: unknown, host: HostIdentity): PackageCompatibility {
  try {
    const hostProblems = hostIssues(host)
    if (hostProblems.length > 0) return freezeCompatibility(hostProblems)

    const manifestProblems = validatePackageManifest(manifest).map((issue) =>
      malformed(issue.path, issue.message),
    )
    if (manifestProblems.length > 0) return freezeCompatibility(manifestProblems)

    const identity = host as HostIdentity
    const fields = readPackageFields(manifest)
    if (!containsNumber(identity.apiVersions, fields.apiVersion)) {
      return freezeCompatibility([{
        code: 'unsupported-api-version',
        message: `extension API version ${fields.apiVersion} is not supported; this Cezar supports ${describeNumbers(identity.apiVersions) || 'none'}`,
        expected: copyNumbers(identity.apiVersions),
        actual: fields.apiVersion,
      }])
    }

    const parsedRange = parseRange(fields.releaseRange)
    if (parsedRange === null) {
      return freezeCompatibility([{
        code: 'unsupported-range',
        message: 'engines.cezar uses an unsupported range; use bare, ^, ~, comparison, partial, AND or OR forms',
        actual: fields.releaseRange,
      }])
    }

    if (!satisfies(identity.release, parsedRange)) {
      return freezeCompatibility([{
        code: 'release-out-of-range',
        message: `Cezar release ${identity.release} is outside engines.cezar range ${fields.releaseRange}`,
        expected: fields.releaseRange,
        actual: identity.release,
      }])
    }

    const supportedEntrypoints = identity.entrypoints
    for (const kind of ['frontend', 'backend'] as const) {
      if (fields.entrypoints[kind] !== undefined && !containsEntrypoint(supportedEntrypoints, kind)) {
        return freezeCompatibility([{
          code: 'unsupported-entrypoint',
          message: `${kind} entrypoint is valid, but this Cezar version does not support ${kind} extensions`,
          kind,
        }])
      }
    }
    return freezeCompatibility([])
  } catch {
    return freezeCompatibility([malformed('host', 'must be a readable object')])
  }
}
