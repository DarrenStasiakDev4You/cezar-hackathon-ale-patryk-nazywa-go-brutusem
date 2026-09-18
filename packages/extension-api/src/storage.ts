import type { IsJson, JsonValue } from './json.ts'

/**
 * The extension's private key-value store: JSON values, asynchronous, one scope per extension —
 * no extension can read another's keys. Keys are non-empty strings of at most 128 characters.
 * Size limits are the host's and surface as `storage-quota`.
 *
 * Where the data lives (the browser or `~/.cezar`) is the host's choice. Like all Cezar state it
 * may be written, never required: deleting that state loses extension data too, so an extension
 * must work from empty storage.
 */
export interface ExtensionStorage {
  /** Unchecked cast: data may have been written by an older version of the extension — validate it. */
  get<T = JsonValue>(key: string): Promise<T | undefined>
  /**
   * Same JSON predicate as commands and events, so interface-typed values are accepted and a
   * non-JSON value is `never`, a compile error.
   *
   * Spelled `T & (IsJson<T> extends true ? unknown : never)` rather than
   * `IsJson<T> extends true ? T : never`: the two accept exactly the same values, but a host
   * implementing `set` can assert the second form to `JsonValue` only at the cost of a TS2589
   * ("excessively deep") error, and the first form costs nothing.
   */
  set<T>(key: string, value: T & (IsJson<T> extends true ? unknown : never)): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}
