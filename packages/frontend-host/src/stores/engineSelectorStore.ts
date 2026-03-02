import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface EngineSelectorState {
  selectedEngineId: string | undefined // undefined means no engine selected yet
  setSelectedEngineId: (id: string) => void
}

export const useEngineSelectorStore = create<EngineSelectorState>()(
  persist(
    (set) => ({
      selectedEngineId: undefined,
      setSelectedEngineId: (id) => set({ selectedEngineId: id }),
    }),
    {
      name: 'engine-selector',
    }
  )
)
