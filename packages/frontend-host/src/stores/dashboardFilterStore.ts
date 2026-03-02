import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DashboardFilterState {
  timePeriod: number // days
  setTimePeriod: (days: number) => void
}

export const useDashboardFilterStore = create<DashboardFilterState>()(
  persist(
    (set) => ({
      timePeriod: 7, // default to 7 days
      setTimePeriod: (days) => set({ timePeriod: days }),
    }),
    {
      name: 'dashboard-filter',
    }
  )
)
