import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ConfigAssignmentSchema,
  ConfigEngineBackstopMappingsFileSchema,
  ConfigEngineSchema,
  ConfigEngineTenantMappingsFileSchema,
  ConfigEnginesFileSchema,
  ConfigIdentityProviderSchema,
  ConfigRoleSchema,
  EnterpriseGlueConfigBundleSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
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
  ConfigEngineBackstopMappingsFileSchema,
  ConfigEngineSchema,
  ConfigEngineTenantMappingsFileSchema,
  ConfigEnginesFileSchema,
  ConfigIdentityProviderSchema,
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
});
