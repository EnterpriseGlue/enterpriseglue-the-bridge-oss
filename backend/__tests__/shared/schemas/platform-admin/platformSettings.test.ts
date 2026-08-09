import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  derivePlatformGovernanceBehavior,
  EngineRuntimeAuthorizationModeSchema,
  PlatformGovernanceBehaviorSchema,
  UnsupportedEngineRuntimeAuthorizationModeErrorSchema,
  UnsupportedEngineRuntimeAuthorizationModeMessage,
  UpdatePlatformSettingsRequest,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

describe('platform settings runtime authorization contracts', () => {
  it('accepts EnterpriseGlue-authoritative and explicitly synchronized mirrored-backstop modes', () => {
    expect(EngineRuntimeAuthorizationModeSchema.parse('enterpriseglue_authoritative'))
      .toBe('enterpriseglue_authoritative');
    expect(EngineRuntimeAuthorizationModeSchema.parse('mirrored_engine_backstop'))
      .toBe('mirrored_engine_backstop');

    const result = EngineRuntimeAuthorizationModeSchema.safeParse('engine_native_authority');
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues[0]).toMatchObject({
      code: 'invalid_value',
      message: UnsupportedEngineRuntimeAuthorizationModeMessage,
    });
  });

  it('publishes named mode and validation-error schemas on the settings update operation', () => {
    const document = generateOpenApi();
    const schemas = document.components?.schemas;
    const response = document.paths?.['/api/admin/settings']?.put?.responses?.['400'];

    expect(schemas?.EngineRuntimeAuthorizationMode).toMatchObject({
      type: 'string',
      enum: ['enterpriseglue_authoritative', 'mirrored_engine_backstop'],
    });
    expect(schemas?.UnsupportedEngineRuntimeAuthorizationModeError).toBeDefined();
    expect(response?.content?.['application/json']?.schema)
      .toEqual(schemas?.UnsupportedEngineRuntimeAuthorizationModeError);

    expect(UnsupportedEngineRuntimeAuthorizationModeErrorSchema.safeParse({
      error: 'Validation failed',
      issues: [{
        path: 'engineRuntimeAuthorizationMode',
        message: UnsupportedEngineRuntimeAuthorizationModeMessage,
        code: 'invalid_value',
      }],
    }).success).toBe(true);
  });

  it.each([
    {
      name: 'manual portal-owned administration',
      input: {
        engineAccessAuthority: 'manual',
        projectAccessAuthority: 'manual',
        engineOnboardingMode: 'manual_allowed',
        projectEngineTargetMode: 'manual_allowed',
        accessGovernanceOwnershipMode: 'manual',
      } as const,
      expected: {
        manualEngineAccessMutationsAllowed: true,
        manualProjectAccessMutationsAllowed: true,
        manualEngineRegistrationAllowed: true,
        manualProjectEngineTargetMutationsAllowed: true,
        governanceSettingsMutations: 'allowed',
      },
    },
    {
      name: 'configuration-locked SSO access with external engine onboarding',
      input: {
        engineAccessAuthority: 'sso_managed',
        projectAccessAuthority: 'sso_managed',
        engineOnboardingMode: 'external_only',
        projectEngineTargetMode: 'hybrid',
        accessGovernanceOwnershipMode: 'config_locked',
      } as const,
      expected: {
        manualEngineAccessMutationsAllowed: false,
        manualProjectAccessMutationsAllowed: false,
        manualEngineRegistrationAllowed: false,
        manualProjectEngineTargetMutationsAllowed: true,
        governanceSettingsMutations: 'blocked',
      },
    },
    {
      name: 'transition access with drift-warning settings',
      input: {
        engineAccessAuthority: 'transition_to_sso',
        projectAccessAuthority: 'manual',
        engineOnboardingMode: 'hybrid',
        projectEngineTargetMode: 'external_only',
        accessGovernanceOwnershipMode: 'config_warn',
      } as const,
      expected: {
        manualEngineAccessMutationsAllowed: true,
        manualProjectAccessMutationsAllowed: true,
        manualEngineRegistrationAllowed: true,
        manualProjectEngineTargetMutationsAllowed: false,
        governanceSettingsMutations: 'allowed_marks_drift',
      },
    },
  ])('derives independent client behavior for $name', ({ input, expected }) => {
    const behavior = derivePlatformGovernanceBehavior(input);
    expect(PlatformGovernanceBehaviorSchema.parse(behavior)).toEqual(expected);
  });

  it('publishes the independent governance modes and effective client behavior in OpenAPI', () => {
    const document = generateOpenApi();
    const schemas = document.components?.schemas;
    const getSettings = document.paths?.['/api/admin/settings']?.get;
    const putSettings = document.paths?.['/api/admin/settings']?.put;
    const preview = document.paths?.['/api/authz/config-bundles/preview']?.post;
    const diff = document.paths?.['/api/authz/config-bundles/diff']?.post;
    const apply = document.paths?.['/api/authz/config-bundles/apply']?.post;
    const exportBundle = document.paths?.['/api/authz/config-bundles/export']?.get;
    const publicSettings = document.paths?.['/api/auth/platform-settings']?.get;

    expect(schemas?.AccessAuthorityMode?.enum).toEqual(['manual', 'transition_to_sso', 'sso_managed']);
    expect(schemas?.AccessGovernanceOwnershipMode?.enum).toEqual(['manual', 'config_locked', 'config_warn']);
    expect(schemas?.EngineOnboardingMode?.enum).toEqual(['manual_allowed', 'external_only', 'hybrid']);
    expect(schemas?.ProjectEngineTargetPolicyMode?.enum).toEqual(['manual_allowed', 'external_only', 'hybrid']);
    expect(schemas?.PlatformSettings?.properties?.localPasswordLoginMode?.enum).toEqual(['auto', 'enabled', 'disabled']);
    expect(schemas?.PlatformSettings?.properties?.ssoProviderSelectionMode?.enum).toEqual(['auto_redirect_single', 'chooser', 'progressive']);
    expect(schemas?.PlatformGovernanceBehavior?.required).toEqual(expect.arrayContaining([
      'manualEngineAccessMutationsAllowed',
      'manualProjectAccessMutationsAllowed',
      'manualEngineRegistrationAllowed',
      'manualProjectEngineTargetMutationsAllowed',
      'governanceSettingsMutations',
    ]));
    expect(schemas?.PlatformSettings?.required).toEqual(expect.arrayContaining([
      'accessGovernanceSourceRef',
      'accessGovernanceOwnershipMode',
      'accessGovernanceSourceHash',
      'accessGovernanceLastAppliedAt',
      'accessGovernanceDriftStatus',
      'governanceBehavior',
      'localPasswordLoginMode',
      'ssoProviderSelectionMode',
    ]));

    expect(getSettings?.summary).toContain('effective governance behavior');
    expect(putSettings?.description).toContain('does not register engines');
    expect(preview?.description).toContain('Omit bundle.governance');
    expect(diff?.description).toContain('raw manifest explicitly declares');
    expect(apply?.description).toContain('omitted v1beta1 governance');
    expect(exportBundle?.description).toContain('governance block is included only');
    expect(publicSettings?.description).toContain('principal permission snapshot');

    const example = putSettings?.requestBody?.content?.['application/json']?.example;
    expect(UpdatePlatformSettingsRequest.parse(example)).toMatchObject({
      engineAccessAuthority: 'sso_managed',
      engineOnboardingMode: 'external_only',
    });
    expect(UpdatePlatformSettingsRequest.parse({
      localPasswordLoginMode: 'disabled',
      ssoProviderSelectionMode: 'progressive',
    })).toEqual({
      localPasswordLoginMode: 'disabled',
      ssoProviderSelectionMode: 'progressive',
    });
  });

  it('keeps derived behavior and configuration provenance read-only', () => {
    expect(UpdatePlatformSettingsRequest.safeParse({
      governanceBehavior: {
        manualEngineAccessMutationsAllowed: true,
        manualProjectAccessMutationsAllowed: true,
        manualEngineRegistrationAllowed: true,
        manualProjectEngineTargetMutationsAllowed: true,
        governanceSettingsMutations: 'allowed',
      },
    }).success).toBe(false);
    expect(UpdatePlatformSettingsRequest.safeParse({
      accessGovernanceOwnershipMode: 'manual',
    }).success).toBe(false);
  });
});
