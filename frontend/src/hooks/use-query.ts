import { useCallback, useEffect, useEffectEvent, useState } from "react"

interface QueryState<T> {
  key: string | null
  nonce: number
  data: T | undefined
  error: Error | null
}

/**
 * Load async data keyed by `key`. Whenever the key changes (or `reload()` is
 * called) the fetcher runs again; responses for stale keys are discarded, so
 * fast-changing filters can never show out-of-order results.
 *
 * Pass `null` as the key to skip loading (e.g. until a required filter is set).
 * Previous data is kept while a new request is in flight.
 */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>) {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<QueryState<T>>({
    key: null,
    nonce: -1,
    data: undefined,
    error: null,
  })
  const run = useEffectEvent(fetcher)

  useEffect(() => {
    if (key === null) return
    let cancelled = false
    run().then(
      (data) => {
        if (!cancelled) setState({ key, nonce, data, error: null })
      },
      (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        if (!cancelled) setState((prev) => ({ key, nonce, data: prev.data, error: err }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const loading = key !== null && (state.key !== key || state.nonce !== nonce)

  return { data: state.data, error: state.error, loading, reload }
}
