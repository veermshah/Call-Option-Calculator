import { useCallback, useRef, useState } from 'react'

/** State with undo/redo. `set` pushes a history entry; `replace` doesn't. */
export function useHistory<T>(initial: T, limit = 100) {
  const ref = useRef({ past: [] as T[], present: initial, future: [] as T[] })
  const [, render] = useState(0)
  const commit = () => render((n) => n + 1)

  const resolve = (next: T | ((prev: T) => T)) =>
    typeof next === 'function' ? (next as (p: T) => T)(ref.current.present) : next

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const h = ref.current
      const value = resolve(next)
      if (value === h.present) return
      h.past = [...h.past.slice(-(limit - 1)), h.present]
      h.future = []
      h.present = value
      commit()
    },
    [limit]
  )

  const replace = useCallback((next: T | ((prev: T) => T)) => {
    ref.current.present = resolve(next)
    commit()
  }, [])

  const undo = useCallback(() => {
    const h = ref.current
    const p = h.past.pop()
    if (p === undefined) return
    h.future.push(h.present)
    h.present = p
    commit()
  }, [])

  const redo = useCallback(() => {
    const h = ref.current
    const f = h.future.pop()
    if (f === undefined) return
    h.past.push(h.present)
    h.present = f
    commit()
  }, [])

  return {
    present: ref.current.present,
    set,
    replace,
    undo,
    redo,
    canUndo: ref.current.past.length > 0,
    canRedo: ref.current.future.length > 0
  }
}
