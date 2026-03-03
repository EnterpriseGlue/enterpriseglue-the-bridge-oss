import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FlowNodeItem {
  id: string
  name: string
  type: string
  x: number
}

interface ProcessFilterState {
  selectedProcess: { id: string; label: string; key: string; version: number } | null
  selectedVersion: number | null
  flowNode: string
  flowNodes: FlowNodeItem[]
  selectedStates: Array<{ id: string; label: string }>
  searchValue: string
  dateFrom: string
  dateTo: string
  timeFrom: string
  timeTo: string
  
  setSelectedProcess: (process: { id: string; label: string; key: string; version: number } | null) => void
  setSelectedVersion: (version: number | null) => void
  setFlowNode: (node: string) => void
  setFlowNodes: (nodes: FlowNodeItem[]) => void
  setSelectedStates: (states: Array<{ id: string; label: string }>) => void
  setSearchValue: (value: string) => void
  setDateRange: (dateFrom: string, dateTo: string) => void
  setTimeFrom: (value: string) => void
  setTimeTo: (value: string) => void
  reset: () => void
}

export const useProcessesFilterStore = create<ProcessFilterState>()(
  persist(
    (set) => ({
      selectedProcess: null,
      selectedVersion: null,
      flowNode: '',
      flowNodes: [],
      selectedStates: [
        { id: 'active', label: 'Active' },
        { id: 'incidents', label: 'Incidents' }
      ],
      searchValue: '',
      dateFrom: '',
      dateTo: '',
      timeFrom: '',
      timeTo: '',

      setSelectedProcess: (process) => set({ selectedProcess: process }),
      setSelectedVersion: (version) => set({ selectedVersion: version }),
      setFlowNode: (node) => set({ flowNode: node }),
      setFlowNodes: (nodes) => set({ flowNodes: nodes }),
      setSelectedStates: (states) => set({ selectedStates: states }),
      setSearchValue: (value) => set({ searchValue: value }),
      setDateRange: (dateFrom, dateTo) => set({ dateFrom, dateTo }),
      setTimeFrom: (value) => set({ timeFrom: value }),
      setTimeTo: (value) => set({ timeTo: value }),
      reset: () => set({
        selectedProcess: null,
        selectedVersion: null,
        flowNode: '',
        flowNodes: [],
        selectedStates: [
          { id: 'active', label: 'Active' },
          { id: 'incidents', label: 'Incidents' }
        ],
        searchValue: '',
        dateFrom: '',
        dateTo: '',
        timeFrom: '',
        timeTo: '',
      })
    }),
    {
      name: 'mission-control-process-filters',
    }
  )
)
