import { useRef } from 'react'

/** Keep frozen JSON data stable when its serialized value has not changed. */
export function useFrozenJson<T>(value: T): T {
  const key = JSON.stringify(value)
  const kept = useRef<{ key: string; value: T } | null>(null)
  if (kept.current === null || kept.current.key !== key) kept.current = { key, value: deepFreeze(value) }
  return kept.current.value
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
