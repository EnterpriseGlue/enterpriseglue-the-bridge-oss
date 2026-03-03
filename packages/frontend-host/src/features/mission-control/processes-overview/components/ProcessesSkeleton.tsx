import React from 'react'
import Skeleton from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'

export function ProcessesSkeleton() {
  return (
    <div style={{
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      marginTop: '-1px',
      height: 'calc(100vh - var(--header-height) - 40px)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Filter Bar Skeleton */}
      <div style={{
        padding: 'var(--spacing-3)',
        background: 'var(--color-primary)',
        borderBottom: '1px solid var(--color-border-primary)',
        display: 'flex',
        gap: 'var(--spacing-3)',
        alignItems: 'center',
        minHeight: '48px'
      }}>
        <Skeleton width={200} height={40} baseColor="rgba(255,255,255,0.1)" highlightColor="rgba(255,255,255,0.2)" />
        <Skeleton width={120} height={40} baseColor="rgba(255,255,255,0.1)" highlightColor="rgba(255,255,255,0.2)" />
        <Skeleton width={150} height={40} baseColor="rgba(255,255,255,0.1)" highlightColor="rgba(255,255,255,0.2)" />
        <Skeleton width={250} height={40} baseColor="rgba(255,255,255,0.1)" highlightColor="rgba(255,255,255,0.2)" />
        <div style={{ marginLeft: 'auto' }}>
          <Skeleton width={100} height={40} baseColor="rgba(255,255,255,0.1)" highlightColor="rgba(255,255,255,0.2)" />
        </div>
      </div>

      {/* Split Pane Skeleton */}
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
            <Skeleton height={300} />
            <div style={{ marginTop: 'var(--spacing-3)', display: 'flex', gap: 'var(--spacing-3)' }}>
              <Skeleton width={150} height={80} />
              <Skeleton width={150} height={80} />
              <Skeleton width={150} height={80} />
              <Skeleton width={150} height={80} />
            </div>
          </div>
        </div>

        {/* Data Table Area Skeleton */}
        <div style={{
          flex: '0 0 40%',
          background: 'white',
          borderTop: '1px solid var(--color-border-primary)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Action Bar Skeleton */}
          <div style={{
            padding: 'var(--spacing-3)',
            borderBottom: '1px solid var(--color-border-primary)',
            minHeight: '48px',
            display: 'flex',
            alignItems: 'center'
          }}>
            <Skeleton width={200} height={20} />
          </div>

          {/* Table Rows Skeleton */}
          <div style={{ padding: 'var(--spacing-3)', flex: 1 }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{
                display: 'flex',
                gap: 'var(--spacing-3)',
                marginBottom: 'var(--spacing-2)',
                alignItems: 'center'
              }}>
                <Skeleton circle width={24} height={24} />
                <Skeleton width={150} height={20} />
                <Skeleton width={200} height={20} />
                <Skeleton width={80} height={20} />
                <Skeleton width={100} height={20} />
                <Skeleton width={100} height={20} />
                <Skeleton width={120} height={20} />
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--spacing-2)' }}>
                  <Skeleton width={32} height={32} />
                  <Skeleton width={32} height={32} />
                  <Skeleton width={32} height={32} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
