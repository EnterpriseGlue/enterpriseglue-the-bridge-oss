import React, { ReactNode } from 'react'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import type { FeatureFlags } from '../../config/featureFlags'

interface FeatureFlagGuardProps {
  flag: keyof FeatureFlags
  children: ReactNode
  fallback?: ReactNode
}

/**
 * Component that conditionally renders children based on feature flag
 * Automatically handles parent-child relationships
 * 
 * @example with fallback
 * <FeatureFlagGuard flag="notifications" fallback={<div>Feature disabled</div>}>
 *   <NotificationBell />
 * </FeatureFlagGuard>
 */
export function FeatureFlagGuard({ flag, children, fallback = null }: FeatureFlagGuardProps) {
  const isEnabled = useFeatureFlag(flag)
  
  return isEnabled ? <>{children}</> : <>{fallback}</>
}
