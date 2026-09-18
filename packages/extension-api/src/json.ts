/** A JSON leaf value. */
export type JsonPrimitive = string | number | boolean | null

/**
 * Any value that survives `JSON.stringify` → `JSON.parse` unchanged. Command arguments and
 * results, event payloads and stored values cross the host/extension boundary as JSON, which
 * keeps a future isolated runtime (a worker or an iframe) possible without an API break. Only
 * component props may carry functions.
 */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

type NonJson = Function | Date | bigint | symbol

/**
 * `true` when `T` survives a JSON round trip; `void` (no payload) counts as JSON. Accepts
 * interfaces, optional fields, arrays and recursive shapes; rejects functions, `Date`, `bigint`
 * and `symbol` anywhere inside `T` (checked ten levels deep — deeper structure is assumed JSON,
 * which is what lets a recursive interface such as a tree terminate).
 *
 * A predicate rather than a constraint: `T extends JsonValue` rejects every plain `interface`
 * (interfaces have no index signature), and a self-referential constraint is a circularity
 * error. The helpers therefore put the check on a parameter —
 * `id: IsJson<P> extends true ? ContributionId : never` — which turns a non-JSON type argument
 * into a compile error at the definition site.
 */
export type IsJson<T> = IsJsonAt<T, []>

// `Depth` only counts levels. Every recursion passes a longer tuple, so no instantiation ever
// repeats its own arguments — which is what makes `JsonValue` and recursive interfaces finite
// instead of a TS2589/TS2615 error.
type IsJsonAt<T, Depth extends readonly unknown[]> = [T] extends [void]
  ? true
  : [T] extends [JsonValue]
    ? true
    : Depth['length'] extends 10
      ? true
      : T extends JsonPrimitive
        ? true
        : T extends NonJson
          ? false
          : T extends readonly (infer U)[]
            ? IsJsonAt<U, [...Depth, unknown]>
            : T extends object
              ? false extends { [K in keyof T]-?: IsJsonAt<Exclude<T[K], undefined>, [...Depth, unknown]> }[keyof T]
                ? false
                : true
              : false
