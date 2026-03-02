import React from 'react'
import { SkeletonIcon, SkeletonText } from '@carbon/react'

/**
 * Loading state component for feature flags initialization
 */
export function LoadingState() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--color-bg-secondary)'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 'var(--spacing-5)', display: 'flex', justifyContent: 'center' }}>
          <SkeletonIcon />
        </div>
        <div style={{ width: 'min(420px, 90vw)', marginInline: 'auto' }}>
          <SkeletonText heading width="220px" />
          <div style={{ marginTop: 'var(--spacing-3)' }}>
            <SkeletonText paragraph lineCount={2} />
          </div>
        </div>
      </div>
    </div>
  )
}
