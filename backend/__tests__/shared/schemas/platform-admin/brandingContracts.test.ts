import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  PlatformBrandingSchema,
  PublicPlatformBrandingSchema,
  UpdatePlatformBrandingRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

const platformBranding = {
  logoUrl: null,
  loginLogoUrl: null,
  loginTitleVerticalOffset: 0,
  loginTitleColor: null,
  logoTitle: 'EnterpriseGlue',
  logoScale: 100,
  titleFontUrl: null,
  titleFontWeight: '600',
  titleFontSize: 14,
  titleVerticalOffset: 0,
  menuAccentColor: null,
  faviconUrl: null,
};

describe('platform branding contracts', () => {
  it('keeps the public login contract limited to non-secret branding', () => {
    expect(PlatformBrandingSchema.parse(platformBranding)).toEqual(platformBranding);
    expect(PublicPlatformBrandingSchema.parse(platformBranding)).toEqual(platformBranding);
  });

  it('keeps administrator update bounds in the shared route contract', () => {
    expect(UpdatePlatformBrandingRequestSchema.parse({
      loginTitleColor: '#123456',
      logoScale: 200,
      titleFontSize: 32,
    })).toMatchObject({ logoScale: 200 });
    expect(UpdatePlatformBrandingRequestSchema.safeParse({ loginTitleColor: 'red' }).success).toBe(false);
    expect(UpdatePlatformBrandingRequestSchema.safeParse({ logoScale: 201 }).success).toBe(false);
  });

  it('publishes both response boundaries through OpenAPI', () => {
    const document = generateOpenApi();
    const admin = document.paths?.['/api/admin/branding']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema;
    const update = document.paths?.['/api/admin/branding']?.put?.requestBody
      ?.content?.['application/json']?.schema;
    const publicBranding = document.paths?.['/api/auth/branding']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema;

    expect(admin).toMatchObject({ type: 'object', properties: { logoScale: { type: 'number' } } });
    expect(update).toMatchObject({ type: 'object', properties: { logoScale: { maximum: 200 } } });
    expect(publicBranding).toMatchObject({ type: 'object', properties: { logoScale: { type: 'number' } } });
    expect(publicBranding).not.toMatchObject({
      properties: { ssoAutoRedirectSingleProvider: expect.anything() },
    });
  });
});
