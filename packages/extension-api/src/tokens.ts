import { ExtensionDefinitionError } from './errors.ts'
import { isValidContributionId, type ContributionId } from './ids.ts'

/**
 * Validates a token id and returns the token as a plain frozen object. Tokens are compared by
 * `id` (and `version`), never by identity — the host and every extension bundle carry their own
 * copy of this package — so nothing but data goes in, and the type-only phantom member is never
 * set.
 */
export function createToken<Token extends { readonly kind: string; readonly id: ContributionId }>(token: Token): Token {
  if (!isValidContributionId(token.id)) {
    const message = 'must be two or more dot-separated segments of [a-z0-9][a-z0-9-]*, at most 128 characters'
    throw new ExtensionDefinitionError('invalid-id', `Invalid ${token.kind} id ${JSON.stringify(token.id)}: ${message}`, [
      { path: 'id', message },
    ])
  }
  return Object.freeze(token)
}
