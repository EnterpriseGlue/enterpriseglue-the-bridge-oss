import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ViewportState = {
  x: number
  y: number
  scale: number
}

type DiagramViewState = {
  // Map of processKey -> viewport state
  viewports: Record<string, ViewportState>
  
  // Save viewport for a process
  saveViewport: (processKey: string, viewport: ViewportState) => void
  
  // Get viewport for a process
  getViewport: (processKey: string) => ViewportState | undefined
  
  // Clear all saved viewports (called when filters change)
  clearViewports: () => void
  
  // Clear viewport for a specific process
  clearViewport: (processKey: string) => void
}

export const useDiagramViewStore = create<DiagramViewState>()(
  persist(
    (set, get) => ({
      viewports: {},
      
      saveViewport: (processKey: string, viewport: ViewportState) => {
        set((state) => ({
          viewports: {
            ...state.viewports,
            [processKey]: viewport
          }
        }))
      },
      
      getViewport: (processKey: string) => {
        return get().viewports[processKey]
      },
      
      clearViewports: () => {
        set({ viewports: {} })
      },
      
      clearViewport: (processKey: string) => {
        set((state) => {
          const { [processKey]: _, ...rest } = state.viewports
          return { viewports: rest }
        })
      }
    }),
    {
      name: 'mission-control-diagram-view'
    }
  )
)
