import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PlatformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/db/entities/PlatformSettings.js';
import { EngineBackstopSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { blindIndex, encrypt, isEncrypted, safeDecrypt } from '@enterpriseglue/shared/services/encryption.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.startsWith('encrypted:') ? value.slice('encrypted:'.length) : value.startsWith('enc:') ? value.slice(4) : value),
  blindIndex: vi.fn((_domain: string, value: string) => value.includes('replacement.example.test') ? 'd'.repeat(64) : 'c'.repeat(64)),
  isEncrypted: vi.fn((value: string) => value.startsWith('v2:') || value.startsWith('enc:')),
  safeDecrypt: vi.fn((value: string) => value.startsWith('enc:') ? value.slice(4) : value),
}));

describe('PlatformSettingsService', () => {
  const currentBackstopCommitments = vi.fn(async () => ({
    sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64), connectionCommitment: 'c'.repeat(64),
  }));
  const service = new PlatformSettingsService(currentBackstopCommitments);

  beforeEach(() => {
    vi.clearAllMocks();
    (encrypt as unknown as Mock).mockImplementation((value: string) => `enc:${value}`);
    (isEncrypted as unknown as Mock).mockImplementation((value: string) => value.startsWith('v2:') || value.startsWith('enc:'));
    (safeDecrypt as unknown as Mock).mockImplementation((value: string) => value.startsWith('enc:') ? value.slice(4) : value);
    (blindIndex as unknown as Mock).mockImplementation((_domain: string, value: string) => value.includes('replacement.example.test') ? 'd'.repeat(64) : 'c'.repeat(64));
    currentBackstopCommitments.mockResolvedValue({
      sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64), connectionCommitment: 'c'.repeat(64),
    });
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
    expect(settings.localPasswordLoginMode).toBe('auto');
    expect(settings.ssoProviderSelectionMode).toBe('auto_redirect_single');
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
        engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
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
      localPasswordLoginMode: 'auto',
      ssoProviderSelectionMode: 'auto_redirect_single',
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

  it('persists ordinary-login and provider-selection policy independently from governance ownership', async () => {
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

    await service.update({
      localPasswordLoginMode: 'disabled',
      ssoProviderSelectionMode: 'progressive',
    }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      localPasswordLoginMode: 'disabled',
      ssoProviderSelectionMode: 'progressive',
      updatedById: 'admin-1',
    }));
  });

  it('rejects an invalid local-login mode at the service boundary', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'default', accessGovernanceOwnershipMode: 'manual' }),
      insert: vi.fn(),
      update: vi.fn(),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(service.update({ localPasswordLoginMode: 'unexpected' as never }, 'admin-1'))
      .rejects.toThrow('Invalid local password login mode');
    expect(repo.update).not.toHaveBeenCalled();
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
    const backstopRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
    const engine = {
      id: 'engine-1', type: 'operaton', lifecycleStatus: 'active', baseUrl: 'https://engine.example.test/engine-rest',
      connectionMode: 'direct', authType: 'basic', username: 'service-account', passwordEnc: 'encrypted-secret',
      oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
    };
    const engineRepo = { findOne: vi.fn().mockResolvedValue(engine) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return repo;
        if (entity === EngineBackstopSyncRun) return backstopRepo;
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });
    await expect(service.update({ engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' }, 'admin-1'))
      .rejects.toThrow('requires at least one active');
    expect(repo.update).not.toHaveBeenCalled();

    backstopRepo.find.mockResolvedValue([{
      id: 'run-1', engineId: 'engine-1', status: 'succeeded', rollbackOfRunId: null, observedOfRunId: null,
      tenantId: 'tenant-a', sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64),
      encryptedDetailedSnapshot: `encrypted:${JSON.stringify({
        version: 1, ownershipForRunId: 'run-1', connectionCommitment: 'c'.repeat(64),
        ownedGrants: [{ id: 'native-1', nativeGroupId: 'operators', camundaResourceType: 6, resourceKey: 'payments' }],
      })}`,
      detailedSnapshotExpiresAt: null,
    }]);
    await service.update({ engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' }, 'admin-1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'default' }, expect.objectContaining({
      engineRuntimeAuthorizationMode: 'mirrored_engine_backstop',
    }));

    backstopRepo.findOne.mockResolvedValue({ status: 'out_of_sync' });
    await expect(service.update({ engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' }, 'admin-1'))
      .rejects.toThrow('requires at least one active');

    backstopRepo.findOne.mockResolvedValue(null);
    currentBackstopCommitments.mockResolvedValue({
      sourceHash: 'changed'.padEnd(64, 'c'), desiredHash: 'b'.repeat(64), connectionCommitment: 'c'.repeat(64),
    });
    await expect(service.update({ engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' }, 'admin-1'))
      .rejects.toThrow('requires at least one active');

    currentBackstopCommitments.mockResolvedValue({
      sourceHash: 'a'.repeat(64), desiredHash: 'b'.repeat(64), connectionCommitment: 'c'.repeat(64),
    });
    engineRepo.findOne.mockResolvedValue({ ...engine, baseUrl: 'https://replacement.example.test/engine-rest' });
    await expect(service.update({ engineRuntimeAuthorizationMode: 'mirrored_engine_backstop' }, 'admin-1'))
      .rejects.toThrow('requires at least one active');
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
