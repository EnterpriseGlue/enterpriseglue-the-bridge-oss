import { useContext } from 'react'
import { FeatureFlagsContext } from '../../contexts/FeatureFlagsContext'
import type { FeatureFlags } from '../../config/featureFlags'

/**
 * Hook to check if a specific feature flag is enabled
 * Considers parent-child relationships automatically
 * 
 */
export function useFeatureFlag(key: keyof FeatureFlags): boolean {
  const context = useContext(FeatureFlagsContext)
  
  if (!context) {
    throw new Error('useFeatureFlag must be used within FeatureFlagsProvider')
  }
  
  return context.isEnabled(key)
}

/**
 * Hook to get full feature flags context
 * Use this when you need to manage flags (admin UI, etc.)
 * 
 * @example
 * const { flags, toggleFlag, resetFlags } = useFeatureFlags()
 */
export function useFeatureFlags() {
  const context = useContext(FeatureFlagsContext)
  
  if (!context) {
    throw new Error('useFeatureFlags must be used within FeatureFlagsProvider')
  }
  
  return context
}
