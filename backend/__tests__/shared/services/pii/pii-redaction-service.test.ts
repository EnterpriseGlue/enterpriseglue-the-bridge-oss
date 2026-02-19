import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { piiRedactionService } from '../../../../src/shared/services/pii/PiiRedactionService.js';
import { platformSettingsService } from '@shared/services/platform-admin/index.js';

vi.mock('@shared/services/platform-admin/index.js', () => ({
  platformSettingsService: {
    getWithSecrets: vi.fn(),
  },
}));

type TestSettings = {
  piiRegexEnabled: boolean;
  piiExternalProviderEnabled: boolean;
  piiExternalProviderType: string | null;
  piiExternalProviderEndpoint: string | null;
  piiExternalProviderAuthHeader: string | null;
  piiExternalProviderAuthToken: string | null;
  piiExternalProviderProjectId: string | null;
  piiExternalProviderRegion: string | null;
  piiRedactionStyle: string;
  piiScopes: string[];
  piiMaxPayloadSizeBytes: number;
};

const defaultSettings = (overrides: Partial<TestSettings> = {}): TestSettings => ({
  piiRegexEnabled: false,
  piiExternalProviderEnabled: false,
  piiExternalProviderType: null,
  piiExternalProviderEndpoint: null,
  piiExternalProviderAuthHeader: null,
  piiExternalProviderAuthToken: null,
  piiExternalProviderProjectId: null,
  piiExternalProviderRegion: null,
  piiRedactionStyle: '<TYPE>',
  piiScopes: ['processDetails', 'history', 'logs', 'errors', 'audit'],
  piiMaxPayloadSizeBytes: 262144,
  ...overrides,
});

describe('PiiRedactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns payload unchanged when redaction is disabled', async () => {
    (platformSettingsService.getWithSecrets as unknown as Mock).mockResolvedValue(defaultSettings());

    const req = { app: { locals: {} }, tenant: undefined } as any;
    const payload = { message: 'contact me at john.doe@example.com' };

    const redacted = await piiRedactionService.redactPayload(req, payload, 'logs');

    expect(redacted).toEqual(payload);
    expect(platformSettingsService.getWithSecrets).toHaveBeenCalledTimes(1);
  });

  it('redacts payload when regex is enabled for requested scope', async () => {
    (platformSettingsService.getWithSecrets as unknown as Mock).mockResolvedValue(
      defaultSettings({ piiRegexEnabled: true, piiScopes: ['logs'] })
    );

    const req = { app: { locals: {} }, tenant: undefined } as any;
    const payload = { message: 'send to john.doe@example.com' };

    const redacted = await piiRedactionService.redactPayload(req, payload, 'logs');

    expect(redacted.message).not.toContain('john.doe@example.com');
    expect(redacted.message).toContain('EMAIL');
  });

  it('does not redact when scope is not enabled', async () => {
    (platformSettingsService.getWithSecrets as unknown as Mock).mockResolvedValue(
      defaultSettings({ piiRegexEnabled: true, piiScopes: ['history'] })
    );

    const req = { app: { locals: {} }, tenant: undefined } as any;
    const payload = { message: 'email john.doe@example.com' };

    const redacted = await piiRedactionService.redactPayload(req, payload, 'logs');

    expect(redacted).toEqual(payload);
  });

  it('uses tenant resolver when present and bypasses platform default settings', async () => {
    (platformSettingsService.getWithSecrets as unknown as Mock).mockResolvedValue(defaultSettings());

    const piiSettingsResolver = vi.fn().mockResolvedValue(
      defaultSettings({ piiRegexEnabled: true, piiScopes: ['audit'] })
    );

    const req = {
      app: { locals: { piiSettingsResolver } },
      tenant: { tenantId: 'tenant-1' },
    } as any;

    const redacted = await piiRedactionService.redactPayload(
      req,
      { details: 'owner: john.doe@example.com' },
      'audit'
    );

    expect(piiSettingsResolver).toHaveBeenCalledTimes(1);
    expect(platformSettingsService.getWithSecrets).not.toHaveBeenCalled();
    expect(redacted.details).toContain('EMAIL');
  });
});
