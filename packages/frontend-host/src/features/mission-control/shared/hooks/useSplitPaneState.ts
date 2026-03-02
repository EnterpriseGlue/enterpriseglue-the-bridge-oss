import { useCallback, useEffect } from 'react'
import { useSplitPaneStore } from '../stores/splitPaneStore'

interface UseSplitPaneStateProps {
  storageKey: string
  defaultSize: string | number
}

/**
 * Hook to manage split pane size with Zustand persistence
 * Reusable for any split pane component
 */
export function useSplitPaneState({ storageKey, defaultSize }: UseSplitPaneStateProps) {
  const storedSize = useSplitPaneStore((s) => s.sizes[storageKey])
  const setSize = useSplitPaneStore((s) => s.setSize)
  const hydrateFromLegacyLocalStorage = useSplitPaneStore((s) => s.hydrateFromLegacyLocalStorage)

  useEffect(() => {
    hydrateFromLegacyLocalStorage(storageKey)
  }, [hydrateFromLegacyLocalStorage, storageKey])

  const handleChange = useCallback((newSize: number | string) => {
    setSize(storageKey, newSize)
  }, [setSize, storageKey])

  return {
    size: storedSize ?? defaultSize,
    handleChange,
  }
}
