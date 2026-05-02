import { useState, useEffect, useCallback } from 'react'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = []
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    fn()
      .then(data => { if (!cancelled) setState({ data, loading: false, error: null }) })
      .catch(err => { if (!cancelled) setState({ data: null, loading: false, error: (err as Error).message }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  return { ...state, reload }
}
