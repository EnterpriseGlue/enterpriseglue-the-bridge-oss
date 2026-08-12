import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ConfigAssignmentSchema,
  ConfigAssignmentsFileSchema,
  ConfigAuthorizationPoliciesFileSchema,
  ConfigEmailConfigurationsFileSchema,
  ConfigEmailTemplatesFileSchema,
  ConfigEngineBackstopMappingsFileSchema,
  ConfigEngineSchema,
  ConfigEngineTenantMappingsFileSchema,
  ConfigEnginesFileSchema,
  ConfigEnvironmentTagsFileSchema,
  ConfigExternalEngineSystemsFileSchema,
  ConfigGitProvidersFileSchema,
  ConfigGroupsFileSchema,
  ConfigIdentityMappingsFileSchema,
  ConfigBundleLoginPolicySchema,
  ConfigIdentityProviderSchema,
  ConfigIdentityProvidersFileSchema,
  ConfigMachinePrincipalsFileSchema,
  ConfigPermissionsFileSchema,
  ConfigPlatformSettingsFileSchema,
  ConfigRolesFileSchema,
  ConfigRoleSchema,
  EnterpriseGlueConfigBundleSchema,
  GovernanceOwnershipApplyRequestSchema,
  GovernanceOwnershipRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import {
  PublicLoginMethodsResponseSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import {
  UpdatePlatformSettingsRequest,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import {
  CreateEngineRequestSchema,
  EngineTenancyConfigurationSchema,
  EngineTenancyErrorResponseSchema,
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyTransitionPreviewRequestSchema,
  EngineTenancyTransitionPreviewResponseSchema,
  EngineTenantReferenceSchema,
  ExternalEngineRegistrationRequestSchema,
  ExternalEngineTenantMappingsUpsertRequestSchema,
  UpdateEngineRequestSchema,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js';

const SCHEMAS: Record<string, z.ZodType> = {
  ConfigAssignmentSchema,
  ConfigAssignmentsFileSchema,
  ConfigAuthorizationPoliciesFileSchema,
  ConfigEmailConfigurationsFileSchema,
  ConfigEmailTemplatesFileSchema,
  ConfigEngineBackstopMappingsFileSchema,
  ConfigEngineSchema,
  ConfigEngineTenantMappingsFileSchema,
  ConfigEnginesFileSchema,
  ConfigEnvironmentTagsFileSchema,
  ConfigExternalEngineSystemsFileSchema,
  ConfigGitProvidersFileSchema,
  ConfigGroupsFileSchema,
  ConfigIdentityMappingsFileSchema,
  ConfigBundleLoginPolicySchema,
  ConfigIdentityProviderSchema,
  ConfigIdentityProvidersFileSchema,
  ConfigMachinePrincipalsFileSchema,
  ConfigPermissionsFileSchema,
  ConfigPlatformSettingsFileSchema,
  ConfigRolesFileSchema,
  ConfigRoleSchema,
  CreateEngineRequestSchema,
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyConfigurationSchema,
  EngineTenancyErrorResponseSchema,
  EngineTenancyTransitionPreviewRequestSchema,
  EngineTenancyTransitionPreviewResponseSchema,
  EngineTenantReferenceSchema,
  EnterpriseGlueConfigBundleSchema,
  ExternalEngineRegistrationRequestSchema,
  ExternalEngineTenantMappingsUpsertRequestSchema,
  GovernanceOwnershipApplyRequestSchema,
  GovernanceOwnershipRequestSchema,
  PublicLoginMethodsResponseSchema,
  UpdatePlatformSettingsRequest,
  UpdateEngineRequestSchema,
};

const repoRoot = resolve(import.meta.dirname, '../../../../..');
const taggedJsonBlock = /<!--\s*enterpriseglue-config-schema:\s*([A-Za-z0-9_]+)\s*-->\s*```json\s*\n([\s\S]*?)\n```/g;
const jsonFence = /^```json\s*$/gm;
const howToDocuments = readdirSync(resolve(repoRoot, 'docs/how-to'), { recursive: true })
  .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.md'))
  .map((entry) => `docs/how-to/${entry}`)
  .filter((documentPath) => readFileSync(resolve(repoRoot, documentPath), 'utf8').includes('```json'));
const DOCUMENTS = [
  ...howToDocuments,
  'docs/reference/engine-tenancy-and-provisioning-api.md',
  'docs/reference/engine-tenancy-data-model.md',
  'docs/reference/access-governance-and-headless-api.md',
].sort();

describe('published machine-readable JSON examples', () => {
  it('discovers every executable JSON example in the published how-to guides', () => {
    expect(DOCUMENTS.length).toBeGreaterThan(0);
  });

  for (const documentPath of DOCUMENTS) {
    it(`${documentPath} stays synchronized with shared schemas`, () => {
      const markdown = readFileSync(resolve(repoRoot, documentPath), 'utf8');
      const matches = [...markdown.matchAll(taggedJsonBlock)];

      expect(matches.length, 'every JSON block must have an enterpriseglue-config-schema annotation')
        .toBe([...markdown.matchAll(jsonFence)].length);
      expect(matches.length, 'the guide must retain at least one executable JSON example').toBeGreaterThan(0);

      for (const match of matches) {
        const [, schemaName, source] = match;
        const schema = SCHEMAS[schemaName];
        expect(schema, `unknown schema annotation ${schemaName}`).toBeDefined();

        let example: unknown;
        expect(() => { example = JSON.parse(source); }, `${documentPath} contains malformed JSON`).not.toThrow();
        const result = schema.safeParse(example);
        expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues, null, 2)).toBe(true);
      }
    });
  }

  it('keeps the complete headless governance and engine envelope executable', () => {
    const examplePath = resolve(repoRoot, 'docs/reference/access-governance-headless.example.json');
    const envelope = JSON.parse(readFileSync(examplePath, 'utf8')) as {
      bundle: unknown;
      files: Record<string, unknown>;
    };

    const bundle = EnterpriseGlueConfigBundleSchema.parse(envelope.bundle);
    expect(bundle.imports).toEqual(['./engines.json']);
    expect(bundle.apiVersion).toBe('enterpriseglue.ai/v1beta1');
    if (bundle.apiVersion !== 'enterpriseglue.ai/v1beta1') throw new Error('Expected v1beta1 bundle');
    expect(bundle.governance).toMatchObject({
      engineRegistrationPolicy: 'external_only',
      governanceSettingsOwnership: 'config_locked',
    });

    const enginesFile = ConfigEnginesFileSchema.parse(envelope.files['./engines.json']);
    expect(enginesFile.engines).toEqual([
      expect.objectContaining({
        type: 'operaton',
        auth: expect.objectContaining({
          passwordRef: 'env://OPERATON_ENGINE_PASSWORD',
        }),
      }),
    ]);
    expect(JSON.stringify(envelope)).not.toContain('"password":');
  });

  it('keeps the complete headless platform-administration envelope executable', async () => {
    const examplePath = resolve(repoRoot, 'docs/reference/headless-platform-administration.example.json');
    const envelope = JSON.parse(readFileSync(examplePath, 'utf8')) as {
      bundle: unknown;
      files: Record<string, unknown>;
    };
    const bundle = EnterpriseGlueConfigBundleSchema.parse(envelope.bundle);
    const expectedFiles = {
      './environment-tags.json': ConfigEnvironmentTagsFileSchema,
      './platform-settings.json': ConfigPlatformSettingsFileSchema,
      './git-providers.json': ConfigGitProvidersFileSchema,
      './email-configurations.json': ConfigEmailConfigurationsFileSchema,
      './email-templates.json': ConfigEmailTemplatesFileSchema,
      './permissions.json': ConfigPermissionsFileSchema,
      './roles.json': ConfigRolesFileSchema,
      './assignments.json': ConfigAssignmentsFileSchema,
      './authorization-policies.json': ConfigAuthorizationPoliciesFileSchema,
      './machine-principals.json': ConfigMachinePrincipalsFileSchema,
      './external-engine-systems.json': ConfigExternalEngineSystemsFileSchema,
    } as const;

    expect(bundle.imports).toEqual(Object.keys(expectedFiles));
    for (const [path, schema] of Object.entries(expectedFiles)) schema.parse(envelope.files[path]);

    const { configBundlePreviewService } = await import(
      '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js'
    );
    expect(configBundlePreviewService.compile(envelope).preview.valid).toBe(true);
    expect(JSON.stringify(envelope)).not.toMatch(/"(?:password|clientSecret|credential|token)"\s*:/);
  });
});
