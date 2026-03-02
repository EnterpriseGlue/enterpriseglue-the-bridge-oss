import React from 'react'
import Skeleton from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'

interface LoadingSkeletonProps {
  type?: 'page' | 'table' | 'card' | 'list'
  rows?: number
  height?: number | string
}

/**
 * Reusable loading skeleton component for different UI patterns
 */
export function LoadingSkeleton({ type = 'page', rows = 5, height = 400 }: LoadingSkeletonProps) {
  switch (type) {
    case 'table':
      return (
        <div style={{ padding: 'var(--spacing-3)' }}>
          {/* Table Header */}
          <div style={{
            display: 'flex',
            gap: 'var(--spacing-3)',
            marginBottom: 'var(--spacing-3)',
            paddingBottom: 'var(--spacing-2)',
            borderBottom: '1px solid var(--color-border-primary)'
          }}>
            <Skeleton width={40} height={20} />
            <Skeleton width={150} height={20} />
            <Skeleton width={200} height={20} />
            <Skeleton width={100} height={20} />
            <Skeleton width={120} height={20} />
          </div>
          
          {/* Table Rows */}
          {[...Array(rows)].map((_, i) => (
            <div key={i} style={{
              display: 'flex',
              gap: 'var(--spacing-3)',
              marginBottom: 'var(--spacing-2)',
              alignItems: 'center'
            }}>
              <Skeleton width={40} height={20} />
              <Skeleton width={150} height={20} />
              <Skeleton width={200} height={20} />
              <Skeleton width={100} height={20} />
              <Skeleton width={120} height={20} />
            </div>
          ))}
        </div>
      )

    case 'card':
      return (
        <div style={{ padding: 'var(--spacing-3)' }}>
          <Skeleton height={200} style={{ marginBottom: 'var(--spacing-3)' }} />
          <Skeleton width="60%" height={24} style={{ marginBottom: 'var(--spacing-2)' }} />
          <Skeleton count={3} />
        </div>
      )

    case 'list':
      return (
        <div style={{ padding: 'var(--spacing-3)' }}>
          {[...Array(rows)].map((_, i) => (
            <div key={i} style={{
              display: 'flex',
              gap: 'var(--spacing-3)',
              marginBottom: 'var(--spacing-3)',
              alignItems: 'center'
            }}>
              <Skeleton circle width={48} height={48} />
              <div style={{ flex: 1 }}>
                <Skeleton width="40%" height={20} style={{ marginBottom: 'var(--spacing-1)' }} />
                <Skeleton width="80%" height={16} />
              </div>
            </div>
          ))}
        </div>
      )

    case 'page':
    default:
      return (
        <div style={{ padding: 'var(--spacing-5)' }}>
          <Skeleton width="30%" height={32} style={{ marginBottom: 'var(--spacing-4)' }} />
          <Skeleton height={height} />
        </div>
      )
  }
}

/**
 * Full page skeleton with header and content
 */
export function PageSkeleton() {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg-primary)'
    }}>
      {/* Header Skeleton */}
      <div style={{
        padding: 'var(--spacing-3)',
        borderBottom: '1px solid var(--color-border-primary)',
        background: 'white'
      }}>
        <Skeleton width={200} height={32} />
      </div>

      {/* Content Skeleton */}
      <div style={{ flex: 1, padding: 'var(--spacing-5)' }}>
        <Skeleton width="40%" height={40} style={{ marginBottom: 'var(--spacing-4)' }} />
        <Skeleton height={300} style={{ marginBottom: 'var(--spacing-3)' }} />
        <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
          <Skeleton width="32%" height={200} />
          <Skeleton width="32%" height={200} />
          <Skeleton width="32%" height={200} />
        </div>
      </div>
    </div>
  )
}
