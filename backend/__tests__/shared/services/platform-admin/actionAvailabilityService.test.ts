import { describe, expect, it } from 'vitest';
import { calculateCurrentUserActionAvailability } from '../../../../../packages/shared/src/services/platform-admin/ActionAvailabilityService.js';
import type { CurrentUserPermissions } from '../../../../../packages/shared/src/schemas/platform-admin/authz.js';

const snapshot: CurrentUserPermissions = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  platform: [
    'platform:engine:create',
    'platform:settings:manage',
    'platform:authz:roles:manage',
  ],
  projects: [{
    resourceId: 'project-1',
    permissions: [
      'project:members:manage',
      'project:deployment-targets:manage',
    ],
  }],
  engines: [{
    resourceId: 'engine-1',
    permissions: [
      'engine:edit',
      'engine:delete',
      'engine:members:manage',
      'engine:ownership:transfer',
    ],
    runtimePermissions: [],
  }],
  authorizationVersion: 'authz:test',
  generatedAt: 1,
};

describe('calculateCurrentUserActionAvailability', () => {
  it('publishes allowed frontend actions from effective permissions', () => {
    const result = calculateCurrentUserActionAvailability(snapshot, {
      engineOnboardingMode: 'manual_allowed',
      projectEngineTargetMode: 'manual_allowed',
      engineAccessAuthority: 'manual',
      projectAccessAuthority: 'manual',
      accessGovernanceOwnershipMode: 'manual',
    });

    expect(result.platformActionAvailability.allowedActions).toContain('engine.inventory.create');
    expect(result.platformActionAvailability.allowedActions).toContain('platform.governance.settings.manage');
    expect(result.projects[0].actionAvailability.allowedActions).toContain('project.members.add');
    expect(result.engines[0].actionAvailability.allowedActions).toContain('engine.members.add');
  });

  it('publishes platform-permission actions whose audit resource is a platform-admin subresource', () => {
    const result = calculateCurrentUserActionAvailability({
      platform: [
        'platform:sso-assignments:view',
        'platform:sso-assignments:manage',
        'platform:engine-sets:view',
        'platform:api-clients:view',
      ],
      projects: [],
      engines: [],
    }, {});

    expect(result.platformActionAvailability.allowedActions).toEqual(expect.arrayContaining([
      'platform.sso.engine-assignments.read',
      'platform.sso.engine-assignments.manage',
      'platform.sso.group-mappings.read',
      'platform.sso.group-mappings.manage',
      'platform.engine-sets.read',
      'platform.api-clients.read',
    ]));
  });

  it('turns SSO-managed membership changes into source-aware restrictions', () => {
    const result = calculateCurrentUserActionAvailability(snapshot, {
      engineAccessAuthority: 'sso_managed',
      projectAccessAuthority: 'sso_managed',
      accessGovernanceSourceRef: 'bundle:workforce-access',
    });

    expect(result.engines[0].actionAvailability.restrictions['engine.members.add']).toMatchObject({
      reasonCode: 'engine_access_sso_managed',
      managementSource: 'sso',
      sourceRef: 'bundle:workforce-access',
    });
    expect(result.projects[0].actionAvailability.restrictions['project.members.remove']).toMatchObject({
      reasonCode: 'project_access_sso_managed',
    });
    expect(result.platformActionAvailability.restrictions['platform.authz.assignments.create.engine-access']).toBeDefined();
    expect(result.platformActionAvailability.restrictions['platform.governance.project-access.manage']).toBeDefined();
  });

  it('separates configuration editing from connection tests for source-owned engines', () => {
    const result = calculateCurrentUserActionAvailability(snapshot, {}, [{
      id: 'engine-1',
      ownershipMode: 'config_locked',
      sourceRef: 'bundle:engines',
    }]);

    expect(result.engines[0].actionAvailability.restrictions['engine.inventory.configuration.update']).toMatchObject({
      reasonCode: 'engine_config_locked',
      managementSource: 'configuration',
    });
    expect(result.engines[0].actionAvailability.allowedActions).toContain('engine.inventory.update');
  });

  it('enforces external-only registration and deployment-target policies', () => {
    const result = calculateCurrentUserActionAvailability(snapshot, {
      engineOnboardingMode: 'external_only',
      projectEngineTargetMode: 'external_only',
    });

    expect(result.platformActionAvailability.restrictions['engine.inventory.create']?.reasonCode)
      .toBe('engine_onboarding_external_only');
    expect(result.projects[0].actionAvailability.restrictions['project.deployment-targets.manage']?.reasonCode)
      .toBe('project_engine_targets_external_only');
    expect(result.engines[0].actionAvailability.restrictions['engine.inventory.delete']?.reasonCode)
      .toBe('engine_inventory_external_only');
  });

  it('does not expose management restrictions for actions the principal cannot otherwise perform', () => {
    const result = calculateCurrentUserActionAvailability({
      platform: [],
      projects: [{ resourceId: 'project-1', permissions: [] }],
      engines: [{ resourceId: 'engine-1', permissions: [], runtimePermissions: [] }],
    }, {
      engineAccessAuthority: 'sso_managed',
      projectAccessAuthority: 'sso_managed',
    });

    expect(result.platformActionAvailability.restrictions).toEqual({});
    expect(result.projects[0].actionAvailability.restrictions).toEqual({});
    expect(result.engines[0].actionAvailability.restrictions).toEqual({});
  });

  it('produces a stable version and changes it when policy availability changes', () => {
    const first = calculateCurrentUserActionAvailability(snapshot, { engineAccessAuthority: 'manual' });
    const repeat = calculateCurrentUserActionAvailability(snapshot, { engineAccessAuthority: 'manual' });
    const changed = calculateCurrentUserActionAvailability(snapshot, { engineAccessAuthority: 'sso_managed' });

    expect(repeat.version).toBe(first.version);
    expect(changed.version).not.toBe(first.version);
  });
});
