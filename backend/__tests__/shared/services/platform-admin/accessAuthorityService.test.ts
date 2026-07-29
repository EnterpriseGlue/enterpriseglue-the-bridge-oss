import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accessAuthorityDomainForResourceType,
  getAccessAuthorityDecision,
} from '@enterpriseglue/shared/services/platform-admin/AccessAuthorityService.js';

const platformSettingsGetMock = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js', () => ({
  platformSettingsService: {
    get: platformSettingsGetMock,
  },
}));

describe('AccessAuthorityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformSettingsGetMock.mockResolvedValue({
      engineAccessAuthority: 'manual',
      projectAccessAuthority: 'manual',
    });
  });

  it.each([
    'engine',
    'engine_set',
    'engine_runtime_resource',
    'engine_runtime_resource_set',
  ])('maps %s to engine access authority', (resourceType) => {
    expect(accessAuthorityDomainForResourceType(resourceType)).toBe('engine');
  });

  it('does not apply engine or project authority to unrelated scopes', async () => {
    expect(accessAuthorityDomainForResourceType('platform')).toBeNull();
    expect(accessAuthorityDomainForResourceType('tenant')).toBeNull();
    await expect(getAccessAuthorityDecision('platform')).resolves.toBeNull();
    expect(platformSettingsGetMock).not.toHaveBeenCalled();
  });

  it('makes every engine resource scope read-only in SSO-managed mode', async () => {
    platformSettingsGetMock.mockResolvedValue({
      engineAccessAuthority: 'sso_managed',
      projectAccessAuthority: 'manual',
    });

    for (const resourceType of [
      'engine',
      'engine_set',
      'engine_runtime_resource',
      'engine_runtime_resource_set',
    ]) {
      await expect(getAccessAuthorityDecision(resourceType)).resolves.toMatchObject({
        domain: 'engine',
        mode: 'sso_managed',
        manualMutationsAllowed: false,
      });
    }
  });

  it('keeps manual mutation available during transition mode', async () => {
    platformSettingsGetMock.mockResolvedValue({
      engineAccessAuthority: 'transition_to_sso',
      projectAccessAuthority: 'transition_to_sso',
    });

    await expect(getAccessAuthorityDecision('engine')).resolves.toMatchObject({
      mode: 'transition_to_sso',
      manualMutationsAllowed: true,
    });
    await expect(getAccessAuthorityDecision('project')).resolves.toMatchObject({
      domain: 'project',
      mode: 'transition_to_sso',
      manualMutationsAllowed: true,
    });
  });
});
