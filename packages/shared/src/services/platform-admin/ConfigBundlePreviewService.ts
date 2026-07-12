import { z } from 'zod';
import {
  ConfigAssignmentsFileSchema, ConfigEnginesFileSchema, ConfigEngineSetsFileSchema, ConfigGroupsFileSchema,
  ConfigIdentityMappingsFileSchema, ConfigIdentityProvidersFileSchema, ConfigProjectEngineTargetsFileSchema,
  ConfigRolesFileSchema, ConfigRuntimeResourceSetsFileSchema, EnterpriseGlueConfigBundleSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import { hashCanonicalConfig } from './config-bundle-hash.js';

const FILE_SCHEMAS: Record<string, z.ZodType> = {
  './engines.json': ConfigEnginesFileSchema,
  './engine-sets.json': ConfigEngineSetsFileSchema,
  './runtime-resource-sets.json': ConfigRuntimeResourceSetsFileSchema,
  './roles.json': ConfigRolesFileSchema,
  './groups.json': ConfigGroupsFileSchema,
  './assignments.json': ConfigAssignmentsFileSchema,
  './identity-providers.json': ConfigIdentityProvidersFileSchema,
  './identity-mappings.json': ConfigIdentityMappingsFileSchema,
  './project-engine-targets.json': ConfigProjectEngineTargetsFileSchema,
};

export interface ConfigBundlePreviewInput { bundle: unknown; files: Record<string, unknown>; }
export interface ConfigBundlePreview { valid: boolean; canonicalHash?: string; errors: Array<{ path: string; message: string }>; counts: Record<string, number>; }

function issues(prefix: string, error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: [prefix, ...issue.path].join('.'), message: issue.message }));
}

class ConfigBundlePreviewService {
  preview(input: ConfigBundlePreviewInput): ConfigBundlePreview {
    const parsedBundle = EnterpriseGlueConfigBundleSchema.safeParse(input.bundle);
    if (!parsedBundle.success) return { valid: false, errors: issues('bundle', parsedBundle.error), counts: {} };
    const errors: Array<{ path: string; message: string }> = [];
    const counts: Record<string, number> = {};
    const normalizedFiles: Record<string, unknown> = {};
    for (const path of parsedBundle.data.imports) {
      if (!(path in input.files)) { errors.push({ path, message: 'Imported file is missing' }); continue; }
      const parsed = FILE_SCHEMAS[path].safeParse(input.files[path]);
      if (!parsed.success) { errors.push(...issues(path, parsed.error)); continue; }
      normalizedFiles[path] = parsed.data;
      const firstArray = Object.values(parsed.data as Record<string, unknown>).find(Array.isArray);
      counts[path] = Array.isArray(firstArray) ? firstArray.length : 0;
    }
    for (const path of Object.keys(input.files)) if (!parsedBundle.data.imports.includes(path as never)) errors.push({ path, message: 'File is not declared in bundle imports' });
    if (errors.length > 0) return { valid: false, errors, counts };
    return { valid: true, canonicalHash: hashCanonicalConfig({ bundle: parsedBundle.data, files: normalizedFiles }), errors: [], counts };
  }
}

export const configBundlePreviewService = new ConfigBundlePreviewService();
