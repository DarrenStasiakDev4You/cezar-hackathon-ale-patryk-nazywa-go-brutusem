import type { ExtensionContext } from './context.ts'
import { ExtensionDefinitionError, formatIssues } from './errors.ts'
import { validateManifest, type ExtensionManifest, type ManifestIssue } from './manifest.ts'

/** An extension module's default export — usually written through {@link defineExtension}. */
export interface Extension {
  readonly manifest: ExtensionManifest
  /** Register everything the extension contributes. Awaited once by the host. */
  activate(context: ExtensionContext): void | Promise<void>
  /** Release what `subscriptions` does not cover. Everything registered through the context is disposed after it anyway. */
  deactivate?(): void | Promise<void>
}

/**
 * Declares an extension: the identity function for type inference (so `activate(context)` is
 * typed without annotations), plus fail-fast validation so a broken extension fails when its
 * module loads rather than when the host first calls it.
 *
 * Returns the same object with its manifest frozen. Throws {@link ExtensionDefinitionError}
 * (code `invalid-manifest`, with every issue — paths relative to the extension, e.g.
 * `manifest.id`) when the manifest breaks a rule of {@link validateManifest}, or `activate` —
 * or a present `deactivate` — is not a function.
 */
export function defineExtension<E extends Extension>(extension: E): E {
  const issues: ManifestIssue[] = []
  const candidate: unknown = extension

  if (typeof candidate !== 'object' || candidate === null) {
    issues.push({ path: '', message: 'must be an object with `manifest` and `activate`' })
  } else {
    const { manifest, activate, deactivate } = candidate as Record<string, unknown>
    for (const { path, message } of validateManifest(manifest)) {
      issues.push({ path: path === '' ? 'manifest' : `manifest.${path}`, message })
    }
    if (typeof activate !== 'function') {
      issues.push({ path: 'activate', message: 'must be a function' })
    }
    if (deactivate !== undefined && typeof deactivate !== 'function') {
      issues.push({ path: 'deactivate', message: 'must be a function when present' })
    }
  }

  if (issues.length > 0) {
    throw new ExtensionDefinitionError(
      'invalid-manifest',
      `Invalid extension ${describe(extension)}: ${formatIssues(issues)}`,
      issues,
    )
  }

  Object.freeze(extension.manifest.engines)
  Object.freeze(extension.manifest)
  return extension
}

function describe(extension: unknown): string {
  const id = (extension as { manifest?: { id?: unknown } } | null)?.manifest?.id
  return typeof id === 'string' && id !== '' ? `"${id}"` : '(no id)'
}
