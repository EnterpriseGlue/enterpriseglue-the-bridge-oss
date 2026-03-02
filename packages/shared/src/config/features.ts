/**
 * Feature Flags Configuration
 * 
 * Backend feature flags for platform features.
 * Controlled via environment variables for safe rollout.
 */

import dotenv from 'dotenv';

dotenv.config();

export interface FeatureFlags {
  // Phase 2: Project Collaboration
  projectCollaboration: boolean;
  
  // Phase 3: Engine Management
  engineOwnership: boolean;
  environmentTags: boolean;
  
  // Phase 4: Authorization
  contextAwareAuth: boolean;
  
  // Phase 5: Platform Admin
  platformAdminUI: boolean;
  
  // Development
  devMode: boolean;
  impersonation: boolean;
}

export const features: FeatureFlags = {
  // Phase 2: Project collaboration features
  projectCollaboration: process.env.PROJECT_COLLAB_ENABLED === 'true',
  
  // Phase 3: Engine ownership and environment tags
  engineOwnership: process.env.ENGINE_OWNERSHIP_ENABLED === 'true',
  environmentTags: process.env.ENV_TAGS_ENABLED === 'true',
  
  // Phase 4: Context-aware authorization middleware
  contextAwareAuth: process.env.CONTEXT_AUTH_ENABLED === 'true',
  
  // Phase 5: Platform admin UI
  platformAdminUI: process.env.PLATFORM_ADMIN_ENABLED === 'true',
  
  // Development mode
  devMode: process.env.NODE_ENV === 'development',
  
  // Impersonation - NEVER enable in production
  impersonation: process.env.IMPERSONATION_ENABLED === 'true' && 
                 process.env.NODE_ENV !== 'production',
};

// Safety check: Refuse to start if impersonation is enabled in production
if (process.env.NODE_ENV === 'production' && process.env.IMPERSONATION_ENABLED === 'true') {
  throw new Error('FATAL: Impersonation cannot be enabled in production!');
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return features[feature];
}

/**
 * Log current feature flag state (for debugging)
 */
export function logFeatureFlags(): void {
  console.log('Feature Flags:');
  for (const [key, value] of Object.entries(features)) {
    console.log(`  ${key}: ${value ? '✅ enabled' : '❌ disabled'}`);
  }
}
