import type { ComponentCapability } from './components.ts'
import type { ContributionId } from './ids.ts'

/**
 * Why an implementation does not fit a contract. Contracts are named `id@version` in messages.
 *
 * - `contract-id-mismatch` — the implementation was compiled against another contract.
 * - `contract-version-mismatch` — the same contract at another major; a host maps it one to one
 *   to the error code of the same name.
 * - `missing-capability` — a required capability the implementation does not declare.
 * - `malformed` — an input the check cannot read: not an object, a field that throws when read, or
 *   a field of the wrong type. `path` names it (`implementation.capabilities[1]`).
 */
export type ComponentCompatibilityIssue =
  | {
      readonly code: 'contract-id-mismatch'
      readonly message: string
      readonly expected: string
      readonly actual: string
    }
  | {
      readonly code: 'contract-version-mismatch'
      readonly message: string
      readonly expected: number
      readonly actual: number
    }
  | { readonly code: 'missing-capability'; readonly message: string; readonly capability: ComponentCapability }
  | { readonly code: 'malformed'; readonly message: string; readonly path: string }

/** The outcome of {@link checkComponentCompatibility}. Frozen. */
export interface ComponentCompatibility {
  /** `true` exactly when `issues` is empty. */
  readonly compatible: boolean
  readonly issues: readonly ComponentCompatibilityIssue[]
  /** What the host may rely on for this implementation: every required capability, then the
   *  contract's optional ones the implementation declares, in the contract's order. `[]` when
   *  not compatible. */
  readonly capabilities: readonly ComponentCapability[]
  /** Every required capability the implementation does not declare, in the contract's order. `[]`
   *  when there is none, and when an earlier rule stopped the check. */
  readonly missingCapabilities: readonly ComponentCapability[]
  /** Declared names the contract neither requires nor lists as optional, de-duplicated in the
   *  implementation's order. These are never an issue and may include names from a newer
   *  revision of this major. `[]` when an earlier rule stopped the check. */
  readonly customCapabilities: readonly ComponentCapability[]
}

/**
 * Does an implementation fit a contract? Compares declarations only — it cannot prove that the
 * implementation behaves as its capabilities claim. Pure and total: never throws, and never calls
 * a method on its input. Each field is read once; `component` is never read.
 *
 * The rules run in order, and each gates the next:
 * 1. a field that is not readable, or not of its type, is `malformed`, and nothing is compared;
 * 2. `implemented.id` other than `contract.id` is `contract-id-mismatch`, and the check stops;
 * 3. `implemented.version` other than `contract.version` is `contract-version-mismatch`, and the
 *    check stops (a new major is expected to change the required set);
 * 4. each required capability the implementation does not declare is one `missing-capability`.
 *
 * A missing capability list, on either side, counts as `[]`. Declared names that are neither
 * required nor optional are kept as `customCapabilities` and never affect the fit. A capability
 * list is read up to 256 names: a longer one (or a `length` that lies) is `malformed` rather than
 * walked, and each list reports at most one `malformed` issue.
 *
 * @param contract       the contract as the checker knows it (a host passes its own token)
 * @param implementation its `id` and `capabilities` — a `ComponentImplementation` fits, written
 *                       inline too; only those two fields are read
 * @param implemented    the token the implementation was compiled against. Defaults to
 *                       `contract`, which suits an author checking their own implementation's
 *                       capabilities. A host MUST pass the token `provide` received: without it,
 *                       the id and version rules cannot fire.
 */
export function checkComponentCompatibility(
  contract: {
    readonly id: ContributionId
    readonly version: number
    readonly requiredCapabilities?: readonly ComponentCapability[]
    readonly optionalCapabilities?: readonly ComponentCapability[]
  },
  implementation: {
    readonly id: ContributionId
    readonly capabilities?: readonly ComponentCapability[]
    // Listed, never read: a full implementation written inline is then not an excess-property
    // error, while a misspelled key (`capabilites`) still is.
    readonly title?: string
    readonly description?: string
    readonly component?: unknown
  },
  implemented?: { readonly id: ContributionId; readonly version: number },
): ComponentCompatibility {
  const issues: ComponentCompatibilityIssue[] = []
  const read = fieldReader(issues)

  const contractFields = read.object(contract, 'contract')
  const contractId = contractFields && read.string(contractFields, 'id')
  const contractVersion = contractFields && read.version(contractFields, 'version')
  const required = contractFields && read.names(contractFields, 'requiredCapabilities')
  const optional = contractFields && read.names(contractFields, 'optionalCapabilities')

  const implementationFields = read.object(implementation, 'implementation')
  const implementationId = implementationFields && read.string(implementationFields, 'id')
  const declared = implementationFields && read.names(implementationFields, 'capabilities')

  let implementedId = contractId
  let implementedVersion = contractVersion
  if (implemented !== undefined) {
    const implementedFields = read.object(implemented, 'implemented')
    implementedId = implementedFields && read.string(implementedFields, 'id')
    implementedVersion = implementedFields && read.version(implementedFields, 'version')
  }

  if (
    issues.length > 0 ||
    contractId === undefined ||
    contractVersion === undefined ||
    required === undefined ||
    optional === undefined ||
    implementationId === undefined ||
    declared === undefined ||
    implementedId === undefined ||
    implementedVersion === undefined
  ) {
    return result(issues)
  }

  if (implementedId !== contractId) {
    return result([
      {
        code: 'contract-id-mismatch',
        message:
          `${implementationId} implements ${implementedId}@${implementedVersion}, ` +
          `but was checked against ${contractId}@${contractVersion}`,
        expected: contractId,
        actual: implementedId,
      },
    ])
  }
  if (implementedVersion !== contractVersion) {
    return result([
      {
        code: 'contract-version-mismatch',
        message:
          `${implementationId} implements ${contractId}@${implementedVersion}, ` +
          `but this Cezar serves ${contractId}@${contractVersion}`,
        expected: contractVersion,
        actual: implementedVersion,
      },
    ])
  }

  const declaredSet = new Set(declared)
  const requiredSet = new Set(required)
  const optionalSet = new Set(optional)
  const customCapabilities = [...new Set(declared.filter((capability) => !requiredSet.has(capability) && !optionalSet.has(capability)))]
  const missingCapabilities: ComponentCapability[] = []
  for (const capability of requiredSet) {
    if (!declaredSet.has(capability)) {
      missingCapabilities.push(capability)
      issues.push({
        code: 'missing-capability',
        message: `${implementationId} does not declare "${capability}", required by ${contractId}@${contractVersion}`,
        capability,
      })
    }
  }
  if (issues.length > 0) return result(issues, [], missingCapabilities, customCapabilities)

  const reliable = new Set(requiredSet)
  for (const capability of optional) {
    if (declaredSet.has(capability)) reliable.add(capability)
  }
  return result([], [...reliable], [], customCapabilities)
}

function result(
  issues: readonly ComponentCompatibilityIssue[],
  capabilities: readonly ComponentCapability[] = [],
  missingCapabilities: readonly ComponentCapability[] = [],
  customCapabilities: readonly ComponentCapability[] = [],
): ComponentCompatibility {
  return Object.freeze({
    compatible: issues.length === 0,
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
    capabilities: Object.freeze(capabilities),
    missingCapabilities: Object.freeze(missingCapabilities),
    customCapabilities: Object.freeze(customCapabilities),
  })
}

/** The most names a capability list may hold before the check stops reading it: far above the 32
 *  a contract may declare, so only a hostile or broken list reaches it. */
const MAX_LIST_LENGTH = 256

/** A field's owner and the dotted path it is reported under. */
interface Fields {
  readonly source: object
  readonly path: string
}

interface FieldReader {
  object(value: unknown, path: string): Fields | undefined
  string(fields: Fields, key: string): string | undefined
  version(fields: Fields, key: string): number | undefined
  /** A capability list: absent is `[]`; otherwise an array of at most {@link MAX_LIST_LENGTH}
   *  strings. Reading stops at the first bad element, so a list yields at most one issue. */
  names(fields: Fields, key: string): ComponentCapability[] | undefined
}

/**
 * Reads untrusted input one field at a time, each inside its own `try`: a getter or proxy trap
 * that throws, or a value of the wrong type, becomes a `malformed` issue at that field's path and
 * the read answers `undefined`. It only reads properties and never calls a method on the input.
 */
function fieldReader(issues: ComponentCompatibilityIssue[]): FieldReader {
  const malformed = (path: string, rule: string): undefined => {
    issues.push({ code: 'malformed', message: `${path} ${rule}`, path })
    return undefined
  }

  const field = (source: object, key: string, path: string): { readonly value: unknown } | undefined => {
    try {
      return { value: (source as Record<string, unknown>)[key] }
    } catch {
      return malformed(path, 'could not be read')
    }
  }

  return {
    object(value, path) {
      if (typeof value === 'object' && value !== null) return { source: value, path }
      return malformed(path, 'must be an object')
    },

    string(fields, key) {
      const path = `${fields.path}.${key}`
      const read = field(fields.source, key, path)
      if (read === undefined) return undefined
      return typeof read.value === 'string' ? read.value : malformed(path, 'must be a string')
    },

    version(fields, key) {
      const path = `${fields.path}.${key}`
      const read = field(fields.source, key, path)
      if (read === undefined) return undefined
      const { value } = read
      return typeof value === 'number' && Number.isInteger(value) && value >= 1
        ? value
        : malformed(path, 'must be a positive integer')
    },

    names(fields, key) {
      const path = `${fields.path}.${key}`
      const read = field(fields.source, key, path)
      if (read === undefined) return undefined
      const list = read.value
      if (list === undefined) return []

      let length: unknown
      try {
        if (!Array.isArray(list)) return malformed(path, 'must be an array of strings')
        length = list.length
      } catch {
        return malformed(path, 'could not be read')
      }
      if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
        return malformed(path, 'must be an array of strings')
      }
      if (length > MAX_LIST_LENGTH) return malformed(path, `must hold at most ${MAX_LIST_LENGTH} names`)

      const names: ComponentCapability[] = []
      for (let index = 0; index < length; index += 1) {
        const elementPath = `${path}[${index}]`
        const element = field(list as object, String(index), elementPath)
        if (element === undefined) return undefined
        if (typeof element.value !== 'string') return malformed(elementPath, 'must be a string')
        names.push(element.value)
      }
      return names
    },
  }
}
