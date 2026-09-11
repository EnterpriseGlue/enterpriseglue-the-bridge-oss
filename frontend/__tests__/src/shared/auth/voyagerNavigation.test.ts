import { describe, expect, it } from 'vitest'
import {
  EnginePermission,
  PlatformPermission,
  hasEnginesUiAccess,
  hasMissionControlUiAccess,
  hasStarbaseUiAccess,
} from '@src/shared/auth/permissions'
import { resolveVoyagerNavigationVisibility } from '@src/shared/auth/voyagerNavigation'

function visibilityFor(permissions: any) {
  return resolveVoyagerNavigationVisibility({
    voyagerEnabled: true,
    starbaseEnabled: true,
    missionControlEnabled: true,
    enginesEnabled: true,
    starbaseAllowed: hasStarbaseUiAccess(permissions),
    missionControlAllowed: hasMissionControlUiAccess(permissions),
    enginesAllowed: hasEnginesUiAccess(permissions),
    hasNativeVoyagerItems: false,
  })
}

describe('Voyager navigation authorization', () => {
  it('keeps Mission Control visible for a platform-settings administrator who has engine access', () => {
    const permissions = {
      platform: [PlatformPermission.SETTINGS_MANAGE],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.INSTANCE_VIEW] }],
    }

    expect(visibilityFor(permissions)).toEqual({
      showVoyagerMenu: true,
      showStarbaseMenu: false,
      showMissionControlMenu: true,
      showEnginesMenu: true,
    })
  })

  it('does not treat platform-settings authority as Mission Control access', () => {
    const permissions = {
      platform: [PlatformPermission.SETTINGS_MANAGE],
      projects: [],
      engines: [],
    }

    const visibility = visibilityFor(permissions)
    expect(visibility.showMissionControlMenu).toBe(false)
    expect(visibility.showVoyagerMenu).toBe(false)
  })

  it('keeps Voyager hidden when its feature is disabled even for authorized users', () => {
    const visibility = resolveVoyagerNavigationVisibility({
      voyagerEnabled: false,
      starbaseEnabled: true,
      missionControlEnabled: true,
      enginesEnabled: true,
      starbaseAllowed: true,
      missionControlAllowed: true,
      enginesAllowed: true,
      hasNativeVoyagerItems: true,
    })

    expect(visibility).toEqual({
      showVoyagerMenu: false,
      showStarbaseMenu: false,
      showMissionControlMenu: false,
      showEnginesMenu: false,
    })
  })
})

