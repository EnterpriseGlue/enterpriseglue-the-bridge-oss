import React, { createContext, useState, ReactNode } from 'react'
import { 
  FeatureFlags, 
  loadFeatureFlags, 
  isFlagEnabled,
  getChildren 
} from '../config/featureFlags'

interface FeatureFlagsContextValue {
  flags: FeatureFlags
  isLoading: boolean
  isEnabled: (key: keyof FeatureFlags) => boolean
  toggleFlag: (key: keyof FeatureFlags) => void
  setFlag: (key: keyof FeatureFlags, value: boolean) => void
  resetFlags: () => void
}

export const FeatureFlagsContext = createContext<FeatureFlagsContextValue | undefined>(undefined)

interface FeatureFlagsProviderProps {
  children: ReactNode
}

export function FeatureFlagsProvider({ children }: FeatureFlagsProviderProps) {
  const [flags, setFlags] = useState<FeatureFlags>(() => loadFeatureFlags())
  const [isLoading] = useState(false)
  
  // Check if a flag is enabled (considering parent-child relationships)
  const isEnabled = (key: keyof FeatureFlags): boolean => {
    return isFlagEnabled(flags, key)
  }
  
  // Toggle a flag
  const toggleFlag = (key: keyof FeatureFlags) => {
    setFlags(prev => {
      const newValue = !prev[key]
      const newFlags = { ...prev, [key]: newValue }
      
      // If disabling a parent, also disable all children
      if (!newValue) {
        const children = getChildren(key)
        children.forEach(child => {
          newFlags[child] = false
        })
      }
      
      return newFlags
    })
  }
  
  // Set a specific flag value
  const setFlag = (key: keyof FeatureFlags, value: boolean) => {
    setFlags(prev => {
      const newFlags = { ...prev, [key]: value }
      
      // If disabling a parent, also disable all children
      if (!value) {
        const children = getChildren(key)
        children.forEach(child => {
          newFlags[child] = false
        })
      }
      
      return newFlags
    })
  }

  const resetFlags = () => {
    setFlags(loadFeatureFlags())
  }
  
  const value: FeatureFlagsContextValue = {
    flags,
    isLoading,
    isEnabled,
    toggleFlag,
    setFlag,
    resetFlags,
  }
  
  // Show loading state while flags are being loaded
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--color-bg-secondary)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            margin: '0 auto var(--spacing-4)',
            border: '3px solid #e0e0e0',
            borderTopColor: '#0f62fe',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
            Loading application...
          </p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    )
  }
  
  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  )
}
