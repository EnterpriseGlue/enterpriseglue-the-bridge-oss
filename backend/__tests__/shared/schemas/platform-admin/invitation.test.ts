import { describe, expect, it } from 'vitest';
import {
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  InvitationCapabilitiesResponseSchema,
  InvitationOnboardingResponseSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/invitation.js';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('generic invitation contracts', () => {
  it('shares the tenant invitation request and reveal-once response across the route and UI', () => {
    expect(CreateInvitationRequestSchema.parse({
      email: 'invitee@example.com',
      resourceType: 'project',
      resourceId: 'project-1',
      role: 'viewer',
      deliveryMethod: 'manual',
    })).toMatchObject({ resourceType: 'project', deliveryMethod: 'manual' });
    expect(CreateInvitationResponseSchema.parse({
      invited: true,
      emailSent: false,
      inviteUrl: 'https://localhost/invite/token',
      oneTimePassword: 'reveal-once-password',
    })).toMatchObject({ invited: true, emailSent: false });
  });

  it('keeps invitation readiness and onboarding acknowledgements explicit', () => {
    expect(InvitationCapabilitiesResponseSchema.parse({ ssoRequired: true, emailConfigured: false }))
      .toEqual({ ssoRequired: true, emailConfigured: false });
    expect(InvitationOnboardingResponseSchema.parse({
      requiresPasswordSet: true,
      tenantSlug: 'default',
      deliveryMethod: 'email',
    })).toMatchObject({ requiresPasswordSet: true, deliveryMethod: 'email' });
  });

  it('publishes the same invitation contracts through OpenAPI', () => {
    const document = generateOpenApi();
    const capabilities = document.paths?.['/api/t/{tenantSlug}/invitations/capabilities']?.get
      ?.responses?.['200']?.content?.['application/json']?.schema;
    const create = document.paths?.['/api/t/{tenantSlug}/invitations']?.post;
    const request = create?.requestBody?.content?.['application/json']?.schema;
    const response = create?.responses?.['201']?.content?.['application/json']?.schema;

    expect(capabilities).toMatchObject({
      type: 'object',
      properties: { ssoRequired: { type: 'boolean' }, emailConfigured: { type: 'boolean' } },
    });
    expect(request).toMatchObject({
      type: 'object',
      properties: { resourceType: { type: 'string', enum: ['tenant', 'project', 'engine'] } },
    });
    expect(response).toMatchObject({
      type: 'object',
      properties: { invited: { type: 'boolean', enum: [true] } },
    });
  });
});
