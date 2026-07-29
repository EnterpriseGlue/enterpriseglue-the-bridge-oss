import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PlatformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/db/entities/PlatformSettings.js';
import { EngineBackstopSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import { encrypt, isEncrypted, safeDecrypt } from '@enterpriseglue/shared/services/encryption.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  isEncrypted: vi.fn((value: string) => value.startsWith('v2:') || value.startsWith('enc:')),
  safeDecrypt: vi.fn((value: string) => value.startsWith('enc:') ? value.slice(4) : value),
}));

describe('PlatformSettingsService', () => {
  const service = new PlatformSettingsService();

  beforeEach(() => {
    vi.clearAllMocks();
    (encrypt as unknown as Mock).mockImplementation((value: string) => `enc:${value}`);
    (isEncrypted as unknown as Mock).mockImplementation((value: string) => value.startsWith('v2:') || value.startsWith('enc:'));
    (safeDecrypt as unknown as Mock).mockImplementation((value: string) => value.startsWith('enc:') ? value.slice(4) : value);
  });

  it('returns defaults when settings missing', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const settings = await service.get();
    expect(settings.syncPushEnabled).toBe(true);
    expect(settings.inviteAllowAllDomains).toBe(true);
    expect(settings.defaultDeployRoles).toContain('owner');
    expect(settings.engineOnboardingMode).toBe('manual_allowed');
    expect(settings.projectEngineTargetMode).toBe('manual_allowed');
    expect(settings.engineRuntimeAuthorizationMode).toBe('enterpriseglue_authoritative');
    expect(settings.governanceBehavior).toEqual({
      manualEngineAccessMutationsAllowed: true,
      manualProjectAccessMutationsAllowed: true,
      manualEngineRegistrationAllowed: true,
      manualProjectEngineTargetMutationsAllowed: true,
      governanceSettingsMutations: 'allowed',
    });
    expect(settings.credentiallessCustomerSidecarsEnabled).toBe(false);
    expect(settings.ssoAllEnginesAssignmentMappingsEnabled).toBe(true);
    expect(settings.ssoEngineOwnerAssignmentMappingsEnabled).toBe(false);
    expect(settings.ssoEngineDelegateAssignmentMappingsEnabled).toBe(false);
    expect(settings.ssoRegexClaimMappingsEnabled).toBe(false);
    expect(settings.ssoBroadEntitlementMappingsEnabled).toBe(false);
    expect(settings.ssoSecretViewMappingsEnabled).toBe(false);
    expect(settings.ssoUnredactedAuditMappingsEnabled).toBe(false);
    expect(settings.ssoPermanentDeleteMappingsEnabled).toBe(false);
  });

  it('returns derived behavior for independent access, onboarding, target, and ownership modes', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'default',
        defaultEnvironmentTagId: null,
        syncPushEnabled: true,
        syncPullEnabled: false,
        gitProjectTokenSharingEnabled: false,
        defaultDeployRoles: JSON.stringify(['owner']),
        engineOnboardingMode: 'external_only',
        projectEngineTargetMode: 'hybrid',
        engineAccessAuthority: 'sso_managed',
        projectAccessAuthority: 'manual',
        engineRuntimeAuthorizationMode: 'mirrored_engine_backstop',
        accessGovernanceOwnershipMode: 'config_warn',
        accessGovernanceDriftStatus: 'drifted',
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const settings = await service.get();
    expect(settings.governanceBehavior).toEqual({
      manualEngineAccessMutationsAllowed: false,
      manualProjectAccessMutationsAllowed: true,
      manualEngineRegistrationAllowed: false,
      manualProjectEngineTargetMutationsAllowed: true,
      governanceSettingsMutations: 'allowed_marks_drift',
    });
    expect(settings.accessGovernanceDriftStatus).toBe('drifted');
  });

  it('inserts new settings when absent', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ syncPullEnabled: true }, 'admin-1');
    expect(repo.insert).toHaveBeenCalled();
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({
      engineOnboardingMode: 'manual_allowed',
      projectEngineTargetMode: 'manual_allowed',
      engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
      credentiallessCustomerSidecarsEnabled: false,
      ssoAllEnginesAssignmentMappingsEnabled: true,
      ssoEngineOwnerAssignmentMappingsEnabled: false,
      ssoEngineDelegateAssignmentMappingsEnabled: false,
      ssoRegexClaimMappingsEnabled: false,
      ssoBroadEntitlementMappingsEnabled: false,
      ssoSecretViewMappingsEnabled: false,
      ssoUnredactedAuditMappingsEnabled: false,
      ssoPermanentDeleteMappingsEnabled: false,
    }));
    (expect(repo.update) as any).not.toHaveBeenCalled();
  });

  it('updates existing settings', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ syncPullEnabled: true }, 'admin-1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      syncPullEnabled: true,
      updatedById: 'admin-1',
    }));
    (expect(repo.insert) as any).not.toHaveBeenCalled();
  });

  it('persists engine onboarding mode updates', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ engineOnboardingMode: 'external_only' }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      engineOnboardingMode: 'external_only',
      updatedById: 'admin-1',
    }));
  });

  it('persists project-engine target policy mode updates', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ projectEngineTargetMode: 'external_only' }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      projectEngineTargetMode: 'external_only',
      updatedById: 'admin-1',
    }));
  });

  it('rejects portal governance changes when configuration owns the settings', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'default',
        accessGovernanceSourceRef: 'config_bundle:acme.authz',
        accessGovernanceOwnershipMode: 'config_locked',
      }),
      insert: vi.fn(),
      update: vi.fn(),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(service.update({ engineAccessAuthority: 'sso_managed' }, 'admin-1'))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('allows config-warning governance changes and records drift', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'default',
        accessGovernanceSourceRef: 'config_bundle:acme.authz',
        accessGovernanceOwnershipMode: 'config_warn',
      }),
      insert: vi.fn(),
      update: vi.fn(),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ engineAccessAuthority: 'transition_to_sso' }, 'admin-1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      engineAccessAuthority: 'transition_to_sso',
      accessGovernanceDriftStatus: 'drifted',
    }));
  });

  it('persists the authoritative runtime authorization mode without a backstop prerequisite', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative' }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
      updatedById: 'admin-1',
    }));
  });

  it('requires a successful backstop receipt before enabling mirrored mode', async () => {
    const repo = { findOneBy: vi.fn().mockResolvedValue({ id: 'default' }), insert: vi.fn(), update: vi.fn() };
    const backstopRepo = { findOne: vi.fn().mockResolvedValue(null) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        if (entity === EngineBackstopSyncRun) return backstopRepo;
        throw new Error('Unexpected repository');
      },
    });
    await expect(service.update({ engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' }, 'admin-1'))
      .rejects.toThrow('requires at least one successful');
    expect(repo.update).not.toHaveBeenCalled();

    backstopRepo.findOne.mockResolvedValue({ id: 'run-1', status: 'succeeded' });
    await service.update({ engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' }, 'admin-1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      engineRuntimeAuthorizationMode: 'mirrored_engine_backstop',
    }));
  });

  it('persists the credentialless customer-sidecar policy', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ credentiallessCustomerSidecarsEnabled: true }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      credentiallessCustomerSidecarsEnabled: true,
      updatedById: 'admin-1',
    }));
  });

  it('persists all-engine SSO assignment mapping guardrail updates', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ ssoAllEnginesAssignmentMappingsEnabled: false }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      ssoAllEnginesAssignmentMappingsEnabled: false,
      updatedById: 'admin-1',
    }));
  });

  it('persists SSO engine governance assignment guardrail updates', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({
      ssoEngineOwnerAssignmentMappingsEnabled: true,
      ssoEngineDelegateAssignmentMappingsEnabled: true,
    }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      ssoEngineOwnerAssignmentMappingsEnabled: true,
      ssoEngineDelegateAssignmentMappingsEnabled: true,
      updatedById: 'admin-1',
    }));
  });

  it('persists SSO regex claim mapping guardrail updates', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ ssoRegexClaimMappingsEnabled: true }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      ssoRegexClaimMappingsEnabled: true,
      updatedById: 'admin-1',
    }));
  });

  it('persists broad entitlement mapping guardrail updates', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ ssoBroadEntitlementMappingsEnabled: true }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      ssoBroadEntitlementMappingsEnabled: true,
      updatedById: 'admin-1',
    }));
  });

  it('persists SSO sensitive permission mapping guardrail updates', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({
      ssoSecretViewMappingsEnabled: true,
      ssoUnredactedAuditMappingsEnabled: true,
      ssoPermanentDeleteMappingsEnabled: true,
    }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      ssoSecretViewMappingsEnabled: true,
      ssoUnredactedAuditMappingsEnabled: true,
      ssoPermanentDeleteMappingsEnabled: true,
      updatedById: 'admin-1',
    }));
  });

  it('masks pii auth token in get() response', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'default',
        defaultEnvironmentTagId: null,
        syncPushEnabled: true,
        syncPullEnabled: false,
        defaultDeployRoles: JSON.stringify(['owner']),
        inviteAllowAllDomains: true,
        inviteAllowedDomains: JSON.stringify([]),
        piiRegexEnabled: true,
        piiExternalProviderEnabled: true,
        piiExternalProviderType: 'presidio',
        piiExternalProviderEndpoint: 'https://presidio.local',
        piiExternalProviderAuthHeader: 'Authorization',
        piiExternalProviderAuthToken: 'enc:secret-token',
        piiExternalProviderProjectId: null,
        piiExternalProviderRegion: null,
        piiRedactionStyle: '<TYPE>',
        piiScopes: JSON.stringify(['logs']),
        piiMaxPayloadSizeBytes: 1024,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const settings = await service.get();
    expect(settings.piiExternalProviderAuthToken).toBeNull();
  });

  it('returns decrypted pii auth token from getWithSecrets()', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'default',
        defaultEnvironmentTagId: null,
        syncPushEnabled: true,
        syncPullEnabled: false,
        defaultDeployRoles: JSON.stringify(['owner']),
        inviteAllowAllDomains: true,
        inviteAllowedDomains: JSON.stringify([]),
        piiRegexEnabled: true,
        piiExternalProviderEnabled: true,
        piiExternalProviderType: 'presidio',
        piiExternalProviderEndpoint: 'https://presidio.local',
        piiExternalProviderAuthHeader: 'Authorization',
        piiExternalProviderAuthToken: 'enc:secret-token',
        piiExternalProviderProjectId: null,
        piiExternalProviderRegion: null,
        piiRedactionStyle: '<TYPE>',
        piiScopes: JSON.stringify(['logs']),
        piiMaxPayloadSizeBytes: 1024,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const settings = await service.getWithSecrets();
    expect(safeDecrypt).toHaveBeenCalledWith('enc:secret-token');
    expect(settings.piiExternalProviderAuthToken).toBe('secret-token');
  });

  it('encrypts pii auth token before updating existing settings', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn(),
      update: vi.fn(),
    };

    (isEncrypted as unknown as Mock).mockReturnValue(false);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await service.update({ piiExternalProviderAuthToken: 'plain-token' }, 'admin-1');

    expect(encrypt).toHaveBeenCalledWith('plain-token');
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'default' },
      expect.objectContaining({ piiExternalProviderAuthToken: 'enc:plain-token' })
    );
  });
});
