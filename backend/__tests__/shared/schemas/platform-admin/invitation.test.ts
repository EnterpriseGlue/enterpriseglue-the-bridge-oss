import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  InvitationCapabilitiesResponseSchema,
  InvitationInfoSchema,
  InvitationOnboardingResponseSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/invitation.js';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('generic invitation contracts', () => {
  it('publishes tenant-bound aliases with the same payloads as root compatibility routes', () => {
    const document = generateOpenApi();
    for (const [suffix, method] of [
      ['auth/onboarding/login-methods', 'get'],
      ['auth/onboarding/providers/{providerId}/start', 'get'],
      ['auth/onboarding/providers/{providerId}/login', 'post'],
      ['auth/complete-onboarding', 'post'],
      ['invitations/{token}', 'get'],
      ['invitations/{token}/verify-otp', 'post'],
      ['invitations/{token}/redeem', 'post'],
    ]) {
      const root = document.paths?.[`/api/${suffix}`]?.[method];
      const scoped = document.paths?.[`/api/t/{tenantSlug}/${suffix}`]?.[method];
      expect(scoped).toBeDefined();
      expect(scoped?.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'tenantSlug', in: 'path', required: true }),
      ]));
      expect(scoped?.requestBody).toEqual(root?.requestBody);
      expect(scoped?.responses?.['200'] || scoped?.responses?.['302'])
        .toEqual(root?.responses?.['200'] || root?.responses?.['302']);
    }
  });
  it('keeps the public SSO enrollment example aligned with canonical response schemas', async () => {
    // OpenAPI initializes Zod's extension before loading its schema graph.
    const { PublicLoginMethodsResponseSchema } = await import('@enterpriseglue/shared/schemas/platform-admin/authz.js');
    const example = JSON.parse(readFileSync(new URL('../../../../test/fixtures/public-api/invitation-enrollment.json', import.meta.url), 'utf8'));
    expect(InvitationOnboardingResponseSchema.parse(example.acknowledgment)).toEqual(example.acknowledgment);
    expect(PublicLoginMethodsResponseSchema.parse(example.methods)).toEqual(example.methods);
  });
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
    expect(InvitationOnboardingResponseSchema.parse({ requiresPasswordSet: false, enrollmentMode: 'provider', tenantSlug: 'alpha', deliveryMethod: 'email' }))
      .toMatchObject({ requiresPasswordSet: false, enrollmentMode: 'provider' });
    expect(InvitationCapabilitiesResponseSchema.parse({ ssoRequired: true, emailConfigured: false }))
      .toEqual({ ssoRequired: true, emailConfigured: false });
    expect(InvitationOnboardingResponseSchema.parse({
      requiresPasswordSet: true,
      tenantSlug: 'default',
      deliveryMethod: 'email',
    })).toMatchObject({ requiresPasswordSet: true, deliveryMethod: 'email' });
    expect(InvitationInfoSchema.parse({
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'platform_user',
      resourceName: null,
      resourceRole: null,
      resourceRoles: [],
      deliveryMethod: 'manual',
      expiresAt: 1_700_000_000_000,
      status: 'onboarding',
    })).toMatchObject({ resourceType: 'platform_user', status: 'onboarding' });
    expect(CreateInvitationRequestSchema.safeParse({
      email: 'invitee@example.com',
      resourceType: 'platform_user',
    }).success).toBe(false);
  });

  it('publishes the same invitation contracts through OpenAPI', () => {
    const document = generateOpenApi();
    for (const [path, method] of [
      ['/api/auth/onboarding/login-methods', 'get'],
      ['/api/auth/onboarding/providers/{providerId}/start', 'get'],
      ['/api/auth/onboarding/providers/{providerId}/login', 'post'],
    ]) expect(document.paths?.[path]?.[method]).toBeDefined();
    const capabilities = document.paths?.['/api/t/{tenantSlug}/invitations/capabilities']?.get
      ?.responses?.['200']?.content?.['application/json']?.schema;
    const create = document.paths?.['/api/t/{tenantSlug}/invitations']?.post;
    const request = create?.requestBody?.content?.['application/json']?.schema;
    const response = create?.responses?.['201']?.content?.['application/json']?.schema;
    const invitationInfo = document.paths?.['/api/invitations/{token}']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema;
    const otp = document.paths?.['/api/invitations/{token}/verify-otp']?.post;
    const onboarding = document.paths?.['/api/auth/complete-onboarding']?.post?.requestBody
      ?.content?.['application/json']?.schema;

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
    expect(invitationInfo).toMatchObject({
      type: 'object',
      properties: { status: { type: 'string', enum: ['pending', 'expired', 'onboarding'] } },
    });
    expect(otp?.requestBody?.content?.['application/json']?.schema).toMatchObject({
      type: 'object',
      properties: { oneTimePassword: { type: 'string', minLength: 1 } },
    });
    expect(onboarding).toMatchObject({
      type: 'object',
      properties: { newPassword: { type: 'string', minLength: 8 } },
    });
  });
});
