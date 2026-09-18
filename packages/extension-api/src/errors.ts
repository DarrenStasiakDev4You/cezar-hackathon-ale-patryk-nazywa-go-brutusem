import type { ManifestIssue } from './manifest.ts'

/**
 * Thrown by this package's helpers at definition time — when an extension module loads — never
 * by the host. `invalid-manifest` comes from {@link defineExtension}; `invalid-id` from the token
 * helpers (`defineCommand`, `defineEvent`, `defineComponentContract`) when a token is malformed.
 */
export class ExtensionDefinitionError extends Error {
  override readonly name = 'ExtensionDefinitionError' as const
  readonly code: 'invalid-manifest' | 'invalid-id'
  /** Every rule the definition broke, not only the first. */
  readonly issues: readonly ManifestIssue[]

  constructor(code: 'invalid-manifest' | 'invalid-id', message: string, issues: readonly ManifestIssue[]) {
    super(message)
    this.code = code
    this.issues = Object.freeze([...issues])
  }
}

/** `path: message; path: message` — one line for an error message. */
export function formatIssues(issues: readonly ManifestIssue[]): string {
  return issues.map(({ path, message }) => (path === '' ? message : `${path} ${message}`)).join('; ')
}
