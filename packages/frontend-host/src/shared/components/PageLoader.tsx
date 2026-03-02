import React from 'react'
import { useLocation } from 'react-router-dom'
import { ProcessesSkeleton } from '../../features/mission-control/processes-overview/components/ProcessesSkeleton'
import { InstanceDetailSkeleton } from '../../features/mission-control/process-instance-detail/components/InstanceDetailSkeleton'
import { LoadingSkeleton, PageSkeleton } from './LoadingSkeleton'

interface PageLoaderProps {
  isLoading: boolean
  children: React.ReactNode
  skeletonType?: 'auto' | 'processes' | 'instance-detail' | 'table' | 'page' | 'card' | 'list'
  rows?: number
}

/**
 * Centralized page loader that shows appropriate skeleton based on route or type
 * 
 * @example
 * // Auto-detect skeleton based on route
 * <PageLoader isLoading={isLoading}>
 *   <YourPageContent />
 * </PageLoader>
 * 
 * @example
 * // Specify skeleton type
 * <PageLoader isLoading={isLoading} skeletonType="table" rows={10}>
 *   <YourTableContent />
 * </PageLoader>
 */
export function PageLoader({ isLoading, children, skeletonType = 'auto', rows = 8 }: PageLoaderProps) {
  const location = useLocation()

  if (!isLoading) {
    return <>{children}</>
  }

  // Auto-detect skeleton based on route
  if (skeletonType === 'auto') {
    const path = location.pathname

    // Mission Control - Processes
    if (path.includes('/mission-control') && !path.includes('/instance/')) {
      return <ProcessesSkeleton />
    }

    // Mission Control - Instance Detail
    if (path.includes('/mission-control/instance/')) {
      return <InstanceDetailSkeleton />
    }

    // Default to page skeleton
    return <PageSkeleton />
  }

  // Use specified skeleton type
  switch (skeletonType) {
    case 'processes':
      return <ProcessesSkeleton />
    
    case 'instance-detail':
      return <InstanceDetailSkeleton />
    
    case 'table':
      return <LoadingSkeleton type="table" rows={rows} />
    
    case 'card':
      return <LoadingSkeleton type="card" />
    
    case 'list':
      return <LoadingSkeleton type="list" rows={rows} />
    
    case 'page':
    default:
      return <PageSkeleton />
  }
}

/**
 * Higher Order Component to wrap pages with loading skeleton
 * 
 * @example
 * export default withLoadingSkeleton(MyPage, {
 *   getIsLoading: (props) => props.isLoading,
 *   skeletonType: 'table'
 * })
 */
interface WithLoadingSkeletonOptions {
  getIsLoading: (props: any) => boolean
  skeletonType?: PageLoaderProps['skeletonType']
  rows?: number
}

export function withLoadingSkeleton<P extends object>(
  Component: React.ComponentType<P>,
  options: WithLoadingSkeletonOptions
) {
  return function WithLoadingSkeletonWrapper(props: P) {
    const isLoading = options.getIsLoading(props)
    
    return (
      <PageLoader 
        isLoading={isLoading} 
        skeletonType={options.skeletonType}
        rows={options.rows}
      >
        <Component {...props} />
      </PageLoader>
    )
  }
}

/**
 * Hook to manage loading state for a page
 * 
 * @example
 * function MyPage() {
 *   const { data, isLoading } = useQuery(...)
 *   const { PageContent } = usePageLoader(isLoading)
 *   
 *   return (
 *     <PageContent>
 *       <YourContent data={data} />
 *     </PageContent>
 *   )
 * }
 */
export function usePageLoader(
  isLoading: boolean,
  skeletonType?: PageLoaderProps['skeletonType'],
  rows?: number
) {
  const PageContent = React.useCallback(
    ({ children }: { children: React.ReactNode }) => (
      <PageLoader isLoading={isLoading} skeletonType={skeletonType} rows={rows}>
        {children}
      </PageLoader>
    ),
    [isLoading, skeletonType, rows]
  )

  return { PageContent, isLoading }
}
