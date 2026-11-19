import { createContext, useContext } from 'react'
import type { PublicAuthBrandingState } from '../../shared/components/PublicAuthShell'

export const WorkspaceHeaderContext = createContext<{
  branding: PublicAuthBrandingState
  navigation: HTMLDivElement | null
  actions: HTMLDivElement | null
} | null>(null)

export const useWorkspaceHeader = () => useContext(WorkspaceHeaderContext)
