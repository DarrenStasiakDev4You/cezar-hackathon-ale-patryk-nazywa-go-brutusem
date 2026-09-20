import { isValidExtensionId, type ExtensionId } from './ids.ts'
import type { ExtensionPermission } from './permissions.ts'

/**
 * Who an extension is and which Cezar releases it runs on. Identity and compatibility only —
 * everything an extension contributes is registered imperatively through its
 * {@link ExtensionContext} in `activate`.
 */
export interface ExtensionManifest {
  readonly id: ExtensionId
  /** Display name. */
  readonly name: string
  /** The extension's own semver version, e.g. `1.4.0` or `2.0.0-beta.1`. */
  readonly version: string
  readonly description?: string
  readonly author?: string
  /** Semver range over the Cezar release version, e.g. `^0.12.0`. The host refuses to activate outside it. */
  readonly engines: { readonly cezar: string }
  /** Permissions this extension requests. A request is not a grant; omitted means none. */
  readonly permissions?: readonly ExtensionPermission[]
}

/** One broken manifest rule. `path` is the dotted key path (`engines.cezar`); `''` is the manifest itself. */
export interface ManifestIssue {
  readonly path: string
  readonly message: string
}

const MAX_NAME_LENGTH = 80
const MAX_ENGINE_RANGE_LENGTH = 64
const MAX_PERMISSIONS = 32
const MAX_PERMISSION_NAME_LENGTH = 64

// The grammar from semver.org (§ "Is there a suggested regular expression"), verbatim.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const PERMISSION_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks a manifest against every rule of {@link ExtensionManifest}. `[]` means valid.
 *
 * Pure and total: it never throws, whatever it is given. Unknown keys are ignored, so a manifest
 * written for a newer Cezar still validates here — the host's `engines.cezar` check decides
 * whether it activates. This is the single source of the manifest rules: the loader calls it
 * rather than re-deriving them.
 */
export function validateManifest(value: unknown): ManifestIssue[] {
  try {
    return collectIssues(value)
  } catch {
    // Only an exotic input (a throwing getter, a revoked proxy) can get here.
    return [{ path: '', message: 'must be a readable object' }]
  }
}

function collectIssues(value: unknown): ManifestIssue[] {
  if (!isRecord(value)) return [{ path: '', message: 'must be an object' }]

  const issues: ManifestIssue[] = []
  const issue = (path: string, message: string): void => {
    issues.push({ path, message })
  }

  const { id, name, version, description, author, engines, permissions } = value

  if (typeof id !== 'string') {
    issue('id', 'must be a string')
  } else if (!isValidExtensionId(id)) {
    issue('id', 'must be `publisher.name`: two dot-separated segments of [a-z0-9][a-z0-9-]*, at most 64 characters')
  }

  if (typeof name !== 'string' || name.trim() === '') {
    issue('name', 'must be a non-empty string')
  } else if (name.length > MAX_NAME_LENGTH) {
    issue('name', `must be at most ${MAX_NAME_LENGTH} characters`)
  }

  if (typeof version !== 'string') {
    issue('version', 'must be a string')
  } else if (!SEMVER.test(version)) {
    issue('version', 'must be a semver version, e.g. 1.4.0 or 2.0.0-beta.1')
  }

  if (description !== undefined && typeof description !== 'string') {
    issue('description', 'must be a string when present')
  }
  if (author !== undefined && typeof author !== 'string') {
    issue('author', 'must be a string when present')
  }

  if (!isRecord(engines)) {
    issue('engines', 'must be an object with a `cezar` version range')
  } else {
    const range = engines.cezar
    if (typeof range !== 'string' || range.trim() === '') {
      issue('engines.cezar', 'must be a non-empty semver range, e.g. ^0.12.0')
    } else if (range.length > MAX_ENGINE_RANGE_LENGTH) {
      issue('engines.cezar', `must be at most ${MAX_ENGINE_RANGE_LENGTH} characters`)
    }
  }

  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      issue('permissions', 'must be an array of permission names when present')
    } else {
      if (permissions.length > MAX_PERMISSIONS) issue('permissions', `must have at most ${MAX_PERMISSIONS} entries`)
      const seen = new Map<string, number>()
      permissions.forEach((permission, index) => {
        const path = `permissions[${index}]`
        if (
          typeof permission !== 'string' ||
          permission.length === 0 ||
          permission.length > MAX_PERMISSION_NAME_LENGTH ||
          !PERMISSION_NAME.test(permission)
        ) {
          issue(
            path,
            `must be one or more dot-separated segments of [a-z][a-z0-9-]*, at most ${MAX_PERMISSION_NAME_LENGTH} characters`,
          )
          return
        }
        const previous = seen.get(permission)
        if (previous !== undefined) issue(path, `must be unique — it repeats permissions[${previous}]`)
        else seen.set(permission, index)
      })
    }
  }

  return issues
}
