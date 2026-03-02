/**
 * Feature Flags Configuration
 * 
 * Environment-driven approach:
 * 1. Default flags defined here
 * 2. Override with VITE_FEATURE_* environment variables
 * 
 * Parent-child relationships:
 * - If voyager is disabled, all its children (starbase, missionControl, engines) are disabled
 * - If missionControl is disabled, all its children (processes, batches, decisions) are disabled
 */

export interface FeatureFlags {
  // Top-level features
  voyager: boolean
  
  // Voyager children
  starbase: boolean
  missionControl: boolean
  engines: boolean
  
  // Mission Control children
  'missionControl.processes': boolean
  'missionControl.batches': boolean
  'missionControl.decisions': boolean
  
  // Starbase children (for future use)
  'starbase.projects': boolean
  'starbase.files': boolean
  
  // UI elements
  notifications: boolean
  userMenu: boolean
}

const featureFlagEnvMap: Record<keyof FeatureFlags, string> = {
  voyager: 'VITE_FEATURE_VOYAGER',

  starbase: 'VITE_FEATURE_STARBASE',
  missionControl: 'VITE_FEATURE_MISSION_CONTROL',
  engines: 'VITE_FEATURE_ENGINES',

  'missionControl.processes': 'VITE_FEATURE_MC_PROCESSES',
  'missionControl.batches': 'VITE_FEATURE_MC_BATCHES',
  'missionControl.decisions': 'VITE_FEATURE_MC_DECISIONS',

  'starbase.projects': 'VITE_FEATURE_SB_PROJECTS',
  'starbase.files': 'VITE_FEATURE_SB_FILES',

  notifications: 'VITE_FEATURE_NOTIFICATIONS',
  userMenu: 'VITE_FEATURE_USER_MENU',
}

export const defaultFlags: FeatureFlags = {
  // Top-level
  voyager: true,
  
  // Voyager children
  starbase: true,
  missionControl: true,
  engines: true,
  
  // Mission Control children
  'missionControl.processes': true,
  'missionControl.batches': true,
  'missionControl.decisions': true,
  
  // Starbase children
  'starbase.projects': true,
  'starbase.files': true,
  
  // UI elements
  notifications: true,
  userMenu: true,
}

/**
 * Parent-child relationships
 * Format: { child: parent }
 */
export const flagHierarchy: Record<string, keyof FeatureFlags | null> = {
  // Voyager children
  starbase: 'voyager',
  missionControl: 'voyager',
  engines: 'voyager',
  
  // Mission Control children
  'missionControl.processes': 'missionControl',
  'missionControl.batches': 'missionControl',
  'missionControl.decisions': 'missionControl',
  
  // Starbase children
  'starbase.projects': 'starbase',
  'starbase.files': 'starbase',
  
  // Top-level have no parents
  voyager: null,
  notifications: null,
  userMenu: null,
}

/**
 * Check if a flag is enabled, considering parent-child relationships
 * Includes circular dependency detection to prevent infinite recursion
 */
export function isFlagEnabled(
  flags: FeatureFlags, 
  key: keyof FeatureFlags,
  visited: Set<keyof FeatureFlags> = new Set()
): boolean {
  // Circular dependency detection
  if (visited.has(key)) {
    console.error(`Circular dependency detected in feature flags: ${Array.from(visited).join(' -> ')} -> ${key}`)
    return false
  }
  
  // First check if the flag itself is enabled
  if (!flags[key]) {
    return false
  }
  
  // Then check if any parent is disabled
  const parent = flagHierarchy[key]
  if (parent) {
    const newVisited = new Set(visited)
    newVisited.add(key)
    if (!isFlagEnabled(flags, parent, newVisited)) {
      return false
    }
  }
  
  return true
}

/**
 * Validate that loaded flags match the FeatureFlags interface
 */
function validateFeatureFlags(data: any): Partial<FeatureFlags> {
  if (!data || typeof data !== 'object') {
    return {}
  }
  
  const validFlags: Partial<FeatureFlags> = {}
  const validKeys = Object.keys(defaultFlags) as (keyof FeatureFlags)[]
  
  for (const key of validKeys) {
    if (key in data && typeof data[key] === 'boolean') {
      validFlags[key] = data[key]
    }
  }
  
  // Warn about invalid keys
  const invalidKeys = Object.keys(data).filter(k => !validKeys.includes(k as keyof FeatureFlags))
  if (invalidKeys.length > 0) {
    console.warn(`Invalid feature flag keys found and ignored: ${invalidKeys.join(', ')}`)
  }
  
  return validFlags
}

/**
 * Load feature flags with priority: env vars > defaults
 * Validates loaded data to ensure type safety
 */
export function loadFeatureFlags(): FeatureFlags {
  const overrides: Partial<FeatureFlags> = {}

  for (const key of Object.keys(featureFlagEnvMap) as (keyof FeatureFlags)[]) {
    const envKey = featureFlagEnvMap[key]
    const raw = (import.meta.env as any)[envKey]

    if (typeof raw === 'boolean') {
      overrides[key] = raw
      continue
    }

    if (typeof raw === 'string') {
      const v = raw.trim().toLowerCase()
      if (v === 'true' || v === '1' || v === 'yes' || v === 'on') {
        overrides[key] = true
      } else if (v === 'false' || v === '0' || v === 'no' || v === 'off') {
        overrides[key] = false
      }
    }
  }

  return { ...defaultFlags, ...validateFeatureFlags(overrides) }
}

/**
 * Get human-readable label for a flag
 */
export function getFlagLabel(key: keyof FeatureFlags): string {
  const labels: Record<keyof FeatureFlags, string> = {
    voyager: 'Voyager',
    starbase: 'Starbase',
    missionControl: 'Mission Control',
    engines: 'Engines',
    'missionControl.processes': 'Processes',
    'missionControl.batches': 'Batches',
    'missionControl.decisions': 'Decisions',
    'starbase.projects': 'Projects',
    'starbase.files': 'Files',
    notifications: 'Notifications',
    userMenu: 'User Menu',
  }
  return labels[key] || key
}

/**
 * Get all children of a flag
 */
export function getChildren(parent: keyof FeatureFlags): (keyof FeatureFlags)[] {
  return Object.entries(flagHierarchy)
    .filter(([_, p]) => p === parent)
    .map(([child]) => child as keyof FeatureFlags)
}
