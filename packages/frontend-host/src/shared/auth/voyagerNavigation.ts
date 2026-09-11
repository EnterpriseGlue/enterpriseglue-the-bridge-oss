export interface VoyagerNavigationInput {
  voyagerEnabled: boolean
  starbaseEnabled: boolean
  missionControlEnabled: boolean
  enginesEnabled: boolean
  starbaseAllowed: boolean
  missionControlAllowed: boolean
  enginesAllowed: boolean
  hasNativeVoyagerItems: boolean
}

export interface VoyagerNavigationVisibility {
  showVoyagerMenu: boolean
  showStarbaseMenu: boolean
  showMissionControlMenu: boolean
  showEnginesMenu: boolean
}

/**
 * Product navigation follows capability and permission decisions. Platform
 * administration is an additional responsibility, not an alternate shell,
 * so it must never suppress otherwise-authorized Voyager destinations.
 */
export function resolveVoyagerNavigationVisibility({
  voyagerEnabled,
  starbaseEnabled,
  missionControlEnabled,
  enginesEnabled,
  starbaseAllowed,
  missionControlAllowed,
  enginesAllowed,
  hasNativeVoyagerItems,
}: VoyagerNavigationInput): VoyagerNavigationVisibility {
  const showStarbaseMenu = voyagerEnabled && starbaseEnabled && starbaseAllowed
  const showMissionControlMenu = voyagerEnabled && missionControlEnabled && missionControlAllowed
  const showEnginesMenu = voyagerEnabled && enginesEnabled && enginesAllowed
  const showVoyagerMenu = voyagerEnabled && (
    showStarbaseMenu ||
    showMissionControlMenu ||
    showEnginesMenu ||
    hasNativeVoyagerItems
  )

  return { showVoyagerMenu, showStarbaseMenu, showMissionControlMenu, showEnginesMenu }
}

