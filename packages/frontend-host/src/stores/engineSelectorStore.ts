import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface EngineSelectorState {
  selectedEngineId: string | undefined // undefined means no engine selected yet
  activeScope: string | undefined
  selectedEngineIdsByScope: Record<string, string>
  setSelectedEngineId: (id: string | undefined) => void
  setActiveEngineScope: (scope: string) => void
  setSelectedEngineIdForScope: (scope: string, id: string | undefined) => void
}

export const useEngineSelectorStore = create<EngineSelectorState>()(
  persist(
    (set) => ({
      selectedEngineId: undefined,
      activeScope: undefined,
      selectedEngineIdsByScope: {},
      setSelectedEngineId: (id) => set((state) => {
        if (!state.activeScope) return { selectedEngineId: id }
        const selectedEngineIdsByScope = { ...state.selectedEngineIdsByScope }
        if (id) selectedEngineIdsByScope[state.activeScope] = id
        else delete selectedEngineIdsByScope[state.activeScope]
        return { selectedEngineId: id, selectedEngineIdsByScope }
      }),
      setActiveEngineScope: (scope) => set((state) => ({
        activeScope: scope,
        selectedEngineId: state.selectedEngineIdsByScope[scope],
      })),
      setSelectedEngineIdForScope: (scope, id) => set((state) => {
        const selectedEngineIdsByScope = { ...state.selectedEngineIdsByScope }
        if (id) selectedEngineIdsByScope[scope] = id
        else delete selectedEngineIdsByScope[scope]
        return {
          activeScope: scope,
          selectedEngineId: id,
          selectedEngineIdsByScope,
        }
      }),
    }),
    {
      name: 'engine-selector',
      version: 2,
      // Version 1 persisted one unscoped engine ID. It cannot be assigned to
      // a tenant or principal safely, so deliberately discard it on upgrade.
      migrate: () => ({ selectedEngineIdsByScope: {} }),
      partialize: (state) => ({ selectedEngineIdsByScope: state.selectedEngineIdsByScope }),
    }
  )
)
