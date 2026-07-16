import { describe, expect, it } from 'vitest';
import {
  EngineMemberAddResponseSchema,
  EngineMemberCapabilitiesSchema,
  EngineMemberLookupSchema,
  EngineEnvironmentUpdateResponseSchema,
  ReissuedManualEngineInvitationSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/engine-management.js';

describe('Engine member contracts', () => {
  it('models lookup modes and invitation capabilities shared by OpenAPI and the UI', () => {
    expect(EngineMemberLookupSchema.parse({
      mode: 'direct-add-only',
      user: null,
    })).toEqual({ mode: 'direct-add-only', user: null });
    expect(EngineMemberCapabilitiesSchema.parse({ ssoRequired: true, emailConfigured: false }))
      .toEqual({ ssoRequired: true, emailConfigured: false });
  });

  it('distinguishes direct adds from invitations and manual reissues', () => {
    expect(EngineMemberAddResponseSchema.parse({
      id: 'assignment-1',
      userId: 'user-1',
      role: 'operator',
      user: { id: 'user-1', email: 'member@example.com' },
      invited: false,
    })).toMatchObject({ invited: false, userId: 'user-1' });
    expect(EngineMemberAddResponseSchema.parse({
      invited: true,
      emailSent: false,
      inviteUrl: 'https://localhost/invite/token',
      oneTimePassword: 'one-time-password',
    })).toMatchObject({ invited: true, emailSent: false });
    expect(ReissuedManualEngineInvitationSchema.parse({
      invited: true,
      emailSent: false,
      inviteUrl: 'https://localhost/invite/token',
      oneTimePassword: 'one-time-password',
    })).toMatchObject({ invited: true, emailSent: false });
  });

  it('shares the environment update acknowledgement with OpenAPI and the engine UI', () => {
    expect(EngineEnvironmentUpdateResponseSchema.parse({ message: 'Environment tag updated' }))
      .toEqual({ message: 'Environment tag updated' });
    expect(EngineEnvironmentUpdateResponseSchema.safeParse({ message: 'Updated' }).success).toBe(false);
  });
});
