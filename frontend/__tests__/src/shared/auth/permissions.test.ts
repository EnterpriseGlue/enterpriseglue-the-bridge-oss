import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV_PLATFORM_PERMISSIONS,
  EnginePermission,
  hasAdminRouteAccess,
  hasEnginesUiAccess,
  hasMissionControlSectionAccess,
  hasMissionControlUiAccess,
  hasStarbaseUiAccess,
  MISSION_CONTROL_BATCH_DELETE_ENGINE_PERMISSIONS,
  MISSION_CONTROL_PROCESSES_ENGINE_PERMISSIONS,
  PlatformPermission,
  ProjectPermission,
} from '@src/shared/auth/permissions';
import { evaluateActionSnapshot } from '@src/shared/auth/guards';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

const baseSnapshot: CurrentUserPermissions = {
  userId: 'user-1',
  platform: [],
  projects: [],
  engines: [],
  generatedAt: 1,
};

const baseUser = undefined;

describe('frontend permission helpers', () => {
  it('maps generic admin route access to required permissions', () => {
    expect(
      hasAdminRouteAccess(
        { ...baseSnapshot, platform: [PlatformPermission.AUTHZ_ROLES_VIEW] },
        baseUser,
        [PlatformPermission.AUTHZ_ROLES_VIEW]
      )
    ).toBe(true);

    expect(hasAdminRouteAccess(baseSnapshot, baseUser, [PlatformPermission.AUTHZ_ROLES_VIEW])).toBe(false);
  });

  it('maps admin navigation permissions to generic admin route access', () => {
    expect(hasAdminRouteAccess(
      { ...baseSnapshot, platform: [ADMIN_NAV_PLATFORM_PERMISSIONS[0]] },
      baseUser
    )).toBe(true);
  });

  it('maps Engines UI access to platform create permission or engine-scoped access', () => {
    expect(
      hasEnginesUiAccess(
        { ...baseSnapshot, platform: [PlatformPermission.ENGINE_CREATE] },
        baseUser
      )
    ).toBe(true);

    expect(
      hasEnginesUiAccess(
        {
          ...baseSnapshot,
          engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.MEMBERS_VIEW] }],
        },
        baseUser
      )
    ).toBe(true);

    expect(
      hasEnginesUiAccess(
        {
          ...baseSnapshot,
          engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.SECRETS_MANAGE] }],
        },
        baseUser
      )
    ).toBe(true);

    expect(hasEnginesUiAccess(baseSnapshot, baseUser)).toBe(false);
  });

  it('maps Mission Control UI and section access to runtime engine permissions', () => {
    const processViewer = {
      ...baseSnapshot,
      engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.INSTANCE_VIEW] }],
    };
    const deleteBatchUser = {
      ...baseSnapshot,
      engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.INSTANCE_VIEW, EnginePermission.INSTANCE_DELETE] }],
    };
    const splitPermissions = {
      ...baseSnapshot,
      engines: [
        { resourceId: 'engine-1', permissions: [EnginePermission.INSTANCE_VIEW] },
        { resourceId: 'engine-2', permissions: [EnginePermission.INSTANCE_DELETE] },
      ],
    };

    expect(hasMissionControlUiAccess(processViewer, baseUser)).toBe(true);
    expect(hasMissionControlSectionAccess(processViewer, baseUser, MISSION_CONTROL_PROCESSES_ENGINE_PERMISSIONS)).toBe(true);
    expect(hasMissionControlSectionAccess(deleteBatchUser, baseUser, MISSION_CONTROL_BATCH_DELETE_ENGINE_PERMISSIONS)).toBe(true);
    expect(hasMissionControlSectionAccess(splitPermissions, baseUser, MISSION_CONTROL_BATCH_DELETE_ENGINE_PERMISSIONS)).toBe(false);
    expect(hasMissionControlUiAccess(baseSnapshot, baseUser)).toBe(false);
  });

  it('maps Starbase UI access to project create permission or project-scoped access', () => {
    expect(
      hasStarbaseUiAccess(
        { ...baseSnapshot, platform: [PlatformPermission.PROJECT_CREATE] },
        baseUser
      )
    ).toBe(true);

    expect(
      hasStarbaseUiAccess(
        {
          ...baseSnapshot,
          projects: [{ resourceId: 'project-1', permissions: ['project:files:view'] }],
        },
        baseUser
      )
    ).toBe(true);

    expect(hasStarbaseUiAccess(baseSnapshot, baseUser)).toBe(false);
  });

  it('evaluates Starbase project collection reads from visible project snapshots', () => {
    const allowed = evaluateActionSnapshot(
      {
        ...baseSnapshot,
        projects: [{ resourceId: 'project-1', permissions: [ProjectPermission.FILES_VIEW] }],
      },
      'project.projects.read',
      { type: 'project', id: null }
    );
    const denied = evaluateActionSnapshot(
      {
        ...baseSnapshot,
        projects: [{ resourceId: 'project-1', permissions: [ProjectPermission.FILES_EDIT] }],
      },
      'project.projects.read',
      { type: 'project', id: null }
    );

    expect(allowed.allowed).toBe(true);
    expect(allowed.resourceType).toBe('project');
    expect(allowed.resourceId).toBeNull();
    expect(denied.allowed).toBe(false);
  });
});
