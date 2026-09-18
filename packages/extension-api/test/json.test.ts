import { describe, expectTypeOf, it } from 'vitest'

import type { IsJson, JsonValue } from '../src/index.ts'

// Type tests: `npm run typecheck` (tsconfig.test.json) is what checks them; at runtime they are
// no-ops. They pin the `IsJson` construction against the repository's TypeScript version.

interface Payload {
  name: string
  count: number
  tags?: string[]
  nested: { readonly at: string | null; flags: readonly boolean[] }
}
interface WithCallback {
  name: string
  onDone: () => void
}
interface WithDate {
  name: string
  at: Date
}
interface WithOptionalDate {
  at?: Date
}
interface Tree {
  name: string
  children: Tree[]
}
interface TreeWithDates {
  children: TreeWithDates[]
  leaf?: { at: Date }
}

/** The parameter-position check the token helpers use, in isolation. */
function jsonOnly<T>(value: IsJson<T> extends true ? T : never): T {
  return value
}

describe('IsJson', () => {
  it('accepts JSON primitives, void and JsonValue itself', () => {
    expectTypeOf<IsJson<string>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<number>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<boolean>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<null>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<'a' | 'b'>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<void>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<JsonValue>>().toEqualTypeOf<true>()
  })

  it('accepts interfaces with optional, nested and array fields', () => {
    expectTypeOf<IsJson<Payload>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<Payload[]>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<[name: string, count: number]>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<Record<string, number>>>().toEqualTypeOf<true>()
  })

  it('terminates on recursive shapes — JsonValue itself and a recursive interface', () => {
    expectTypeOf<IsJson<readonly JsonValue[]>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<Tree>>().toEqualTypeOf<true>()
    expectTypeOf<IsJson<TreeWithDates>>().toEqualTypeOf<false>()
  })

  it('rejects functions, Date, bigint and symbol — at any depth', () => {
    expectTypeOf<IsJson<() => void>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<Date>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<bigint>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<symbol>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<WithCallback>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<WithDate>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<WithOptionalDate>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<Date[]>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<{ deep: { deeper: { at: Date } } }>>().toEqualTypeOf<false>()
  })

  it('rejects unknown and a top-level undefined union', () => {
    expectTypeOf<IsJson<unknown>>().toEqualTypeOf<false>()
    expectTypeOf<IsJson<string | undefined>>().not.toEqualTypeOf<true>()
  })

  it('turns a non-JSON type argument into a compile error at the call site', () => {
    const payload: Payload = { name: 'a', count: 1, nested: { at: null, flags: [] } }
    expectTypeOf(jsonOnly<Payload>(payload)).toEqualTypeOf<Payload>()
    expectTypeOf(jsonOnly({ name: 'a', count: 1 })).toEqualTypeOf<{ name: string; count: number }>()
    // A value read back from storage can be written again.
    const rewrite = (stored: JsonValue) => jsonOnly(stored)
    expectTypeOf(rewrite).returns.toEqualTypeOf<JsonValue>()

    const unused = (): void => {
      // @ts-expect-error — a function field is not JSON
      jsonOnly<WithCallback>({ name: 'a', onDone: () => {} })
      // @ts-expect-error — a Date field is not JSON
      jsonOnly<WithDate>({ name: 'a', at: new Date() })
      // @ts-expect-error — nor is an inferred one
      jsonOnly({ at: new Date() })
    }
    expectTypeOf(unused).toBeFunction()
  })
})
