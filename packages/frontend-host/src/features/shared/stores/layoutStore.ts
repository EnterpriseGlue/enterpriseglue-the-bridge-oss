import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LayoutState {
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  setSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  setSidebarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void
  toggleSidebar: () => void
  toggleSidebarCollapsed: () => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarCollapsed: false,
      setSidebarOpen: (open) => set((state) => ({ 
        sidebarOpen: typeof open === 'function' ? open(state.sidebarOpen) : open 
      })),
      setSidebarCollapsed: (collapsed) => set((state) => ({ 
        sidebarCollapsed: typeof collapsed === 'function' ? collapsed(state.sidebarCollapsed) : collapsed 
      })),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'voyager-layout-store',
    }
  )
)
