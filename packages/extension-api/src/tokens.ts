import { ExtensionDefinitionError, formatIssues } from './errors.ts'
import { isValidContributionId, type ContributionId } from './ids.ts'
import type { ManifestIssue } from './manifest.ts'

const CONTRIBUTION_ID_RULE = 'must be two or more dot-separated segments of [a-z0-9][a-z0-9-]*, at most 128 characters'

/**
 * Validates a token and returns it as a plain frozen object. Tokens are compared by `id` (and
 * `version`), never by identity — the host and every extension bundle carry their own copy of
 * this package — so nothing but data goes in, and the type-only phantom member is never set.
 *
 * `issues` are the caller's own findings about the token (e.g. a bad contract `version`); they
 * are reported together with an invalid id, so one throw names everything that is wrong.
 */
export function createToken<Token extends { readonly kind: string; readonly id: ContributionId }>(
  token: Token,
  issues: readonly ManifestIssue[] = [],
): Token {
  const all = isValidContributionId(token.id) ? [...issues] : [{ path: 'id', message: CONTRIBUTION_ID_RULE }, ...issues]
  if (all.length > 0) {
    throw new ExtensionDefinitionError('invalid-id', `Invalid ${token.kind} ${describeId(token.id)}: ${formatIssues(all)}`, all)
  }
  return Object.freeze(token)
}

/** Quotes a string id; names the type of anything else — a JS caller may pass any value, and
 *  `JSON.stringify` would itself throw on a `bigint`. */
function describeId(id: unknown): string {
  return typeof id === 'string' ? JSON.stringify(id) : `(${typeof id} id)`
}
