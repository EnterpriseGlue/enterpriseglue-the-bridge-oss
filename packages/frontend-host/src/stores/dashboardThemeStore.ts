import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DashboardThemeState {
  futuristicMode: boolean
  setFuturisticMode: (mode: boolean) => void
  toggleFuturisticMode: () => void
}

export const useDashboardThemeStore = create<DashboardThemeState>()(
  persist(
    (set) => ({
      futuristicMode: false,
      setFuturisticMode: (mode) => set({ futuristicMode: mode }),
      toggleFuturisticMode: () => set((state) => ({ futuristicMode: !state.futuristicMode }))
    }),
    {
      name: 'dashboard-theme-preference'
    }
  )
)
