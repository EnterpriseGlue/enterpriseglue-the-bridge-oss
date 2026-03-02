import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DecisionFilterState {
  selectedDefinition: { id: string; label: string; key: string; version: number } | null
  selectedVersion: number | null
  selectedStates: Array<{ id: string; label: string }>
  searchValue: string
  dateFrom: string
  dateTo: string
  timeFrom: string
  timeTo: string
  
  setSelectedDefinition: (definition: { id: string; label: string; key: string; version: number } | null) => void
  setSelectedVersion: (version: number | null) => void
  setSelectedStates: (states: Array<{ id: string; label: string }>) => void
  setSearchValue: (value: string) => void
  setDateRange: (dateFrom: string, dateTo: string) => void
  setTimeFrom: (value: string) => void
  setTimeTo: (value: string) => void
  reset: () => void
}

export const useDecisionsFilterStore = create<DecisionFilterState>()(
  persist(
    (set) => ({
      selectedDefinition: null,
      selectedVersion: null,
      selectedStates: [
        { id: 'evaluated', label: 'Evaluated' }
      ],
      searchValue: '',
      dateFrom: '',
      dateTo: '',
      timeFrom: '',
      timeTo: '',

      setSelectedDefinition: (definition) => set({ selectedDefinition: definition }),
      setSelectedVersion: (version) => set({ selectedVersion: version }),
      setSelectedStates: (states) => set({ selectedStates: states }),
      setSearchValue: (value) => set({ searchValue: value }),
      setDateRange: (dateFrom, dateTo) => set({ dateFrom, dateTo }),
      setTimeFrom: (value) => set({ timeFrom: value }),
      setTimeTo: (value) => set({ timeTo: value }),
      reset: () => set({
        selectedDefinition: null,
        selectedVersion: null,
        selectedStates: [
          { id: 'evaluated', label: 'Evaluated' }
        ],
        searchValue: '',
        dateFrom: '',
        dateTo: '',
        timeFrom: '',
        timeTo: '',
      })
    }),
    {
      name: 'mission-control-decision-filters',
    }
  )
)
