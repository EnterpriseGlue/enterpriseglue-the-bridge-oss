import React from 'react'
import Skeleton from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'

export function InstanceDetailSkeleton() {
  return (
    <div style={{
      height: 'calc(100vh - var(--header-height))',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header Skeleton */}
      <div style={{
        padding: 'var(--spacing-3)',
        borderBottom: '1px solid var(--color-border-primary)',
        background: 'white',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-3)'
      }}>
        <Skeleton width={32} height={32} />
        <Skeleton width={300} height={24} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-2)' }}>
          <Skeleton width={100} height={36} />
          <Skeleton width={100} height={36} />
        </div>
      </div>

      {/* Split Pane Content Skeleton */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Diagram Area Skeleton */}
        <div style={{
          flex: '0 0 60%',
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--spacing-5)'
        }}>
          <div style={{ width: '80%', maxWidth: '800px' }}>
            <Skeleton height={350} />
          </div>
        </div>

        {/* Details Area Skeleton */}
        <div style={{
          flex: '0 0 40%',
          background: 'white',
          borderTop: '1px solid var(--color-border-primary)',
          padding: 'var(--spacing-4)'
        }}>
          {/* Tabs Skeleton */}
          <div style={{
            display: 'flex',
            gap: 'var(--spacing-3)',
            marginBottom: 'var(--spacing-4)',
            borderBottom: '1px solid var(--color-border-primary)',
            paddingBottom: 'var(--spacing-2)'
          }}>
            <Skeleton width={100} height={32} />
            <Skeleton width={100} height={32} />
            <Skeleton width={100} height={32} />
          </div>

          {/* Content Skeleton */}
          <div>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{
                display: 'flex',
                gap: 'var(--spacing-3)',
                marginBottom: 'var(--spacing-3)',
                alignItems: 'center'
              }}>
                <Skeleton width={150} height={20} />
                <Skeleton width={250} height={20} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
