import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SplitPaneSize = string | number

interface SplitPaneState {
  sizes: Record<string, SplitPaneSize>

  setSize: (storageKey: string, size: SplitPaneSize) => void
  hydrateFromLegacyLocalStorage: (storageKey: string) => void
}

function parseLegacySize(raw: string): SplitPaneSize {
  if (raw.includes('%')) return raw
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? raw : n
}

export const useSplitPaneStore = create<SplitPaneState>()(
  persist(
    (set, get) => ({
      sizes: {},

      setSize: (storageKey, size) => {
        set((state) => ({
          sizes: {
            ...state.sizes,
            [storageKey]: size,
          },
        }))
      },

      hydrateFromLegacyLocalStorage: (storageKey) => {
        const existing = get().sizes[storageKey]
        if (existing !== undefined) return

        const legacy = localStorage.getItem(storageKey)
        if (!legacy) return

        const parsed = parseLegacySize(legacy)

        set((state) => ({
          sizes: {
            ...state.sizes,
            [storageKey]: parsed,
          },
        }))

        // Remove legacy entry to avoid confusion; the persisted zustand store is now the source of truth.
        try {
          localStorage.removeItem(storageKey)
        } catch {
          // ignore
        }
      },
    }),
    {
      name: 'mission-control-split-pane-sizes',
    },
  ),
)
