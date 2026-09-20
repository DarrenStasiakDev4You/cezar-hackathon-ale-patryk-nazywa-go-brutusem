import type { ExtensionId } from './ids.ts'
import { validateManifest, type ExtensionManifest, type ManifestIssue } from './manifest.ts'
import type { ExtensionPermission } from './permissions.ts'

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
      value.permissions.forEach((permission, index) => {
        if (typeof permission === 'string' && !PACKAGE_PERMISSION_SET.has(permission)) {
          issues.push({ path: `permissions[${index}]`, message: 'must be a permission supported by this API generation' })
        }
      })
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
