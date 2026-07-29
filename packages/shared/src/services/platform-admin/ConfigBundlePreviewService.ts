import { z } from 'zod';
import {
  ConfigAssignmentsFileSchema, ConfigEnginesFileSchema, ConfigEngineBackstopMappingsFileSchema, ConfigEngineSetsFileSchema, ConfigEngineTenantMappingsFileSchema, ConfigGroupsFileSchema,
  ConfigIdentityMappingsFileSchema, ConfigIdentityProvidersFileSchema, ConfigProjectEngineTargetsFileSchema,
  ConfigRolesFileSchema, ConfigRuntimeResourceSetsFileSchema, EnterpriseGlueConfigBundleSchema,
  ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1, ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1,
  configBundleContractMetadataForApiVersion,
  normalizeEnterpriseGlueConfigBundle,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import type { ConfigBundleContractMetadata } from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import { PermissionCatalog, SystemRoleDefinitions, rolePermissionDependencyError } from './permissions.js';
import { hashCanonicalConfig } from './config-bundle-hash.js';
import { isEngineBackstopNativeAuthorizationEngineType } from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js';
import type {
  EngineTenancyPrincipalType,
  EngineTenantReferenceResolver,
} from './EngineTenancyProvisioningService.js';

const FILE_SCHEMAS: Record<string, z.ZodType> = {
  './engines.json': ConfigEnginesFileSchema,
  './engine-backstop-mappings.json': ConfigEngineBackstopMappingsFileSchema,
  './engine-tenant-mappings.json': ConfigEngineTenantMappingsFileSchema,
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
/**
 * An internal-only reference to an already registered engine.  It is used by
 * narrowly scoped migration workflows that add authorization objects to an
 * engine without importing, changing, or taking ownership of that engine's
 * connection configuration.
 */
export interface ConfigBundleExternalEngineReference {
  key: string;
  /** Required by persisted-state diff/apply; preview-only callers need only the key. */
  engineId?: string;
}
export interface ConfigBundlePolicyContext {
  credentiallessCustomerSidecarsEnabled: boolean;
  tenantReferenceResolver?: EngineTenantReferenceResolver | null;
  tenantReferencePrincipalType?: EngineTenancyPrincipalType;
  tenantReferencePrincipalId?: string | null;
  /** Not accepted from public configuration payloads. See ConfigBundleExternalEngineReference. */
  externalEngineReferences?: ConfigBundleExternalEngineReference[];
}
export interface ConfigBundleValidationIssue {
  code?: string;
  path: string;
  message: string;
  severity: 'error';
  remediation: string;
  objectKey?: string;
}
export interface ConfigBundlePreview {
  valid: boolean;
  canonicalHash?: string;
  contract?: ConfigBundleContractMetadata;
  errors: ConfigBundleValidationIssue[];
  counts: Record<string, number>;
  /** Explicit effective permissions for copied config roles; never a runtime authorization source. */
  expandedRolePermissions?: Record<string, string[]>;
  /** Immutable system-role baseline used by each copied custom role. */
  roleTemplateBaselines?: Record<string, { copyFromRoleKey: string; fingerprint: string; permissions: string[] }>;
}

export interface ConfigBundleCompilation {
  preview: ConfigBundlePreview;
  manifest?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

type RawValidationIssue = Pick<ConfigBundleValidationIssue, 'path' | 'message'>;

function issues(prefix: string, error: z.ZodError): RawValidationIssue[] {
  return error.issues.map((issue) => ({ path: [prefix, ...issue.path].join('.'), message: issue.message }));
}

function remediationFor(message: string): string {
  if (message.includes('Imported file is missing')) return 'Add the declared file to the bundle files map, or remove it from bundle.imports.';
  if (message.includes('File is not declared')) return 'Add the file path to bundle.imports, or remove the undeclared file from the bundle.';
  if (message.includes('Unknown permission')) return 'Use a permission id from the EnterpriseGlue permission catalog that matches the role scope.';
  if (message.includes('not tenant-safe')) return 'Use only permissions marked tenant-safe in the EnterpriseGlue permission catalog.';
  if (message.includes('Unknown role key') || message.includes('Unknown group key') || message.includes('Unknown engine key') || message.includes('Unknown Engine Set key') || message.includes('Unknown runtime resource set key')) return 'Define the referenced object in this bundle or use an existing stable key.';
  if (message.includes('scope')) return 'Use values that share the required authorization scope.';
  if (message.includes('Duplicate')) return 'Use one unique stable key or import path for each configuration object.';
  if (message.includes('plaintext') || message.includes('Secret')) return 'Replace the value with an allowed opaque env:// or file:// secret reference.';
  return 'Correct the value at this path and run preview again before applying the bundle.';
}

function objectKeyForPath(path: string, input: ConfigBundlePreviewInput): string | undefined {
  const candidates: Array<{ prefix: string; value: unknown }> = [
    { prefix: 'bundle', value: input.bundle },
    ...Object.entries(input.files).map(([prefix, value]) => ({ prefix, value })),
  ].sort((left, right) => right.prefix.length - left.prefix.length);
  const candidate = candidates.find(({ prefix }) => path === prefix || path.startsWith(`${prefix}.`));
  if (!candidate) return undefined;

  const segments = path.slice(candidate.prefix.length).replace(/^\./, '').split('.').filter(Boolean);
  let current: unknown = candidate.value;
  let objectKey: string | undefined;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') break;
    const next = (current as Record<string, unknown>)[segment];
    // Config-object keys live on entries of a top-level collection. Do not
    // mistake nested reference fields such as principal.key for object keys.
    if (Array.isArray(current) && next && typeof next === 'object' && typeof (next as { key?: unknown }).key === 'string') {
      objectKey = (next as { key: string }).key;
    }
    current = next;
  }
  return objectKey;
}

function enrichIssues(errors: RawValidationIssue[], input: ConfigBundlePreviewInput): ConfigBundleValidationIssue[] {
  return errors.map((issue) => {
    const objectKey = objectKeyForPath(issue.path, input);
    return {
      ...issue,
      severity: 'error',
      remediation: remediationFor(issue.message),
      ...(objectKey ? { objectKey } : {}),
    };
  });
}

function fileEntries(normalizedFiles: Record<string, unknown>, path: string, property: string): any[] {
  const file = normalizedFiles[path] as Record<string, unknown> | undefined;
  const entries = file?.[property];
  return Array.isArray(entries) ? entries : [];
}

function validateEndpointAuthenticationPolicy(
  normalizedFiles: Record<string, unknown>,
  policy: ConfigBundlePolicyContext,
): RawValidationIssue[] {
  return fileEntries(normalizedFiles, './engines.json', 'engines').flatMap((engine, index) => {
    if (engine.auth?.type !== 'none' || policy.credentiallessCustomerSidecarsEnabled) return [];
    return [{
      path: `./engines.json.engines.${index}.auth.type`,
      message: 'Credentialless customer-sidecar endpoints are disabled by platform policy',
    }];
  });
}

/**
 * Ensures a bundle is internally coherent before a future compiler resolves
 * its references against persisted records. This phase deliberately does not
 * touch the database or attempt connectivity/secret resolution.
 */
function externalEngineKeys(policy: ConfigBundlePolicyContext): Set<string> {
  return new Set((policy.externalEngineReferences || [])
    .map((reference) => reference.key?.trim())
    .filter((key): key is string => Boolean(key)));
}

function validateCrossFileReferences(
  normalizedFiles: Record<string, unknown>,
  policy: ConfigBundlePolicyContext,
): RawValidationIssue[] {
  const errors: RawValidationIssue[] = [];
  const roles = fileEntries(normalizedFiles, './roles.json', 'roles');
  const groups = fileEntries(normalizedFiles, './groups.json', 'groups');
  const engines = fileEntries(normalizedFiles, './engines.json', 'engines');
  const engineBackstopMappings = fileEntries(normalizedFiles, './engine-backstop-mappings.json', 'engineBackstopMappings');
  const engineTenantMappings = fileEntries(normalizedFiles, './engine-tenant-mappings.json', 'engineTenantMappings');
  const engineSets = fileEntries(normalizedFiles, './engine-sets.json', 'engineSets');
  const runtimeResourceSets = fileEntries(normalizedFiles, './runtime-resource-sets.json', 'runtimeResourceSets');
  const identityProviders = fileEntries(normalizedFiles, './identity-providers.json', 'identityProviders');
  const identityMappings = fileEntries(normalizedFiles, './identity-mappings.json', 'identityMappings');
  const assignments = fileEntries(normalizedFiles, './assignments.json', 'assignments');
  const targets = fileEntries(normalizedFiles, './project-engine-targets.json', 'projectEngineTargets');

  const roleKeys = new Set([...SystemRoleDefinitions.map((role) => role.key), ...roles.map((role) => role.key)]);
  const groupKeys = new Set(groups.map((group) => group.key));
  const engineKeys = new Set(engines.map((engine) => engine.key));
  const externallyReferencedEngineKeys = externalEngineKeys(policy);
  const engineSetKeys = new Set(engineSets.map((engineSet) => engineSet.key));
  const runtimeResourceSetKeys = new Set(runtimeResourceSets.map((set) => set.key));
  const permissionsByKey = new Map(PermissionCatalog.map((permission) => [permission.key, permission]));

  roles.forEach((role, index) => {
    const path = `./roles.json.roles.${index}`;
    if ('copyFromRoleKey' in role && !roleKeys.has(role.copyFromRoleKey)) {
      errors.push({ path: `${path}.copyFromRoleKey`, message: `Unknown role key: ${role.copyFromRoleKey}` });
    }
    const permissionIds = 'permissions' in role
      ? role.permissions
      : [...(role.addPermissions || []), ...(role.removePermissions || [])];
    for (const permissionId of permissionIds) {
      const permission = permissionsByKey.get(permissionId);
      if (!permission) {
        errors.push({ path: `${path}.permissions`, message: `Unknown permission: ${permissionId}` });
      } else if (role.scope === 'tenant' && !permission.tenantSafe) {
        errors.push({ path: `${path}.permissions`, message: `Permission ${permissionId} is not tenant-safe` });
      } else if (role.scope !== 'tenant' && permission.scope !== role.scope) {
        errors.push({ path: `${path}.permissions`, message: `Permission ${permissionId} has ${permission.scope} scope and cannot be used by a ${role.scope} role` });
      }
    }
  });

  engineSets.forEach((engineSet, index) => {
    if (engineSet.selector.mode !== 'engine_ids') return;
    engineSet.selector.engineKeys.forEach((engineKey: string, engineIndex: number) => {
      if (!engineKeys.has(engineKey)) {
        errors.push({ path: `./engine-sets.json.engineSets.${index}.selector.engineKeys.${engineIndex}`, message: `Unknown engine key: ${engineKey}` });
      }
    });
  });

  engineBackstopMappings.forEach((mapping, index) => {
    const path = `./engine-backstop-mappings.json.engineBackstopMappings.${index}`;
    const engine = engines.find((candidate) => candidate.key === mapping.engineRef.engineKey);
    if (!engine) {
      errors.push({ path: `${path}.engineRef.engineKey`, message: `Unknown engine key: ${mapping.engineRef.engineKey}` });
    } else if (!isEngineBackstopNativeAuthorizationEngineType(engine.type)) {
      errors.push({ path: `${path}.engineRef.engineKey`, message: 'Mirrored backstop mappings require a Camunda 7 or Operaton engine' });
    }
    if (!groupKeys.has(mapping.groupRef.groupKey)) {
      errors.push({ path: `${path}.groupRef.groupKey`, message: `Unknown group key: ${mapping.groupRef.groupKey}` });
    }
  });

  runtimeResourceSets.forEach((set, index) => {
    // Existing-engine references are intentionally accepted only here. This
    // permits a migration to scope authorization to a pre-existing engine,
    // but never lets a bundle silently change its tenancy, deployment target,
    // Engine Set membership, or connection settings.
    if (!engineKeys.has(set.engineRef.engineKey) && !externallyReferencedEngineKeys.has(set.engineRef.engineKey)) {
      errors.push({ path: `./runtime-resource-sets.json.runtimeResourceSets.${index}.engineRef.engineKey`, message: `Unknown engine key: ${set.engineRef.engineKey}` });
    }
  });

  engineTenantMappings.forEach((mapping, index) => {
    const engine = engines.find((candidate) => candidate.key === mapping.engineRef.engineKey);
    const path = `./engine-tenant-mappings.json.engineTenantMappings.${index}`;
    if (!engine) {
      errors.push({ path: `${path}.engineRef.engineKey`, message: `Unknown engine key: ${mapping.engineRef.engineKey}` });
      return;
    }
    if (engine.tenancy.mode !== 'shared') {
      errors.push({ path: `${path}.engineRef.engineKey`, message: `Engine tenant mapping ${mapping.key} requires a shared engine` });
    } else if (engine.tenancy.mappingStrategy !== mapping.strategy) {
      errors.push({
        path: `${path}.strategy`,
        message: `Engine tenant mapping strategy ${mapping.strategy} does not match engine strategy ${engine.tenancy.mappingStrategy}`,
      });
    }
  });

  identityMappings.forEach((mapping, index) => {
    // Providers may be intentionally pre-existing and managed outside this
    // bundle. The persisted diff/apply resolver validates that reference.
    if (!groupKeys.has(mapping.targetGroupKey)) {
      errors.push({ path: `./identity-mappings.json.identityMappings.${index}.targetGroupKey`, message: `Unknown group key: ${mapping.targetGroupKey}` });
    }
  });

  assignments.forEach((assignment, index) => {
    const path = `./assignments.json.assignments.${index}`;
    if (assignment.principal.type === 'group' && !groupKeys.has(assignment.principal.key)) {
      errors.push({ path: `${path}.principal.key`, message: `Unknown group key: ${assignment.principal.key}` });
    }
    if (!roleKeys.has(assignment.roleKey)) {
      errors.push({ path: `${path}.roleKey`, message: `Unknown role key: ${assignment.roleKey}` });
    }
    if (assignment.scope.type === 'engine' && !engineKeys.has(assignment.scope.engineKey)) {
      errors.push({ path: `${path}.scope.engineKey`, message: `Unknown engine key: ${assignment.scope.engineKey}` });
    }
    if (assignment.scope.type === 'engine_set' && !engineSetKeys.has(assignment.scope.engineSetKey)) {
      errors.push({ path: `${path}.scope.engineSetKey`, message: `Unknown Engine Set key: ${assignment.scope.engineSetKey}` });
    }
    if (assignment.scope.type === 'engine_runtime_resource' && !engineKeys.has(assignment.scope.engineKey)) {
      errors.push({ path: `${path}.scope.engineKey`, message: `Unknown engine key: ${assignment.scope.engineKey}` });
    }
    if (assignment.scope.type === 'engine_runtime_resource_set' && !runtimeResourceSetKeys.has(assignment.scope.runtimeResourceSetKey)) {
      errors.push({ path: `${path}.scope.runtimeResourceSetKey`, message: `Unknown runtime resource set key: ${assignment.scope.runtimeResourceSetKey}` });
    }
  });

  targets.forEach((target, index) => {
    if (!engineKeys.has(target.engineRef.engineKey)) {
      errors.push({ path: `./project-engine-targets.json.projectEngineTargets.${index}.engineRef.engineKey`, message: `Unknown engine key: ${target.engineRef.engineKey}` });
    }
  });

  return errors;
}

function expandRoleTemplates(normalizedFiles: Record<string, unknown>): {
  errors: RawValidationIssue[];
  expandedRolePermissions: Record<string, string[]>;
  roleTemplateBaselines: Record<string, { copyFromRoleKey: string; fingerprint: string; permissions: string[] }>;
} {
  const roles = fileEntries(normalizedFiles, './roles.json', 'roles');
  const systemRoles = new Map(SystemRoleDefinitions.map((role) => [role.key, {
    scope: role.scope,
    permissions: role.permissions,
  }]));
  const customRoles = new Map(roles.map((role, index) => [role.key, { role, index }]));
  const resolved = new Map<string, string[]>();
  const roleTemplateBaselines: Record<string, { copyFromRoleKey: string; fingerprint: string; permissions: string[] }> = {};
  const resolving = new Set<string>();
  const errors: RawValidationIssue[] = [];

  const resolve = (key: string): string[] | null => {
    const cached = resolved.get(key);
    if (cached) return cached;
    const systemRole = systemRoles.get(key);
    if (systemRole) return [...systemRole.permissions].sort();
    const entry = customRoles.get(key);
    if (!entry) return null;
    if (resolving.has(key)) {
      errors.push({ path: `./roles.json.roles.${entry.index}.copyFromRoleKey`, message: `Role template cycle detected at ${key}` });
      return null;
    }
    resolving.add(key);
    const { role, index } = entry;
    let permissions: string[];
    if ('permissions' in role) {
      permissions = [...role.permissions];
    } else {
      const parentPermissions = resolve(role.copyFromRoleKey);
      const parent = systemRoles.get(role.copyFromRoleKey) || customRoles.get(role.copyFromRoleKey)?.role;
      if (!parentPermissions || !parent) {
        permissions = [];
      } else {
        if (parent.scope !== role.scope) {
          errors.push({
            path: `./roles.json.roles.${index}.copyFromRoleKey`,
            message: `Role template ${role.copyFromRoleKey} has ${parent.scope} scope and cannot be copied into a ${role.scope} role`,
          });
        }
        const removed = new Set(role.removePermissions || []);
        permissions = [...new Set([...parentPermissions, ...(role.addPermissions || [])])]
          .filter((permission) => !removed.has(permission));
      }
    }
    resolving.delete(key);
    const normalized = [...new Set(permissions)].sort();
    resolved.set(key, normalized);
    return normalized;
  };

  for (const role of roles) {
    const permissions = resolve(role.key);
    if ('copyFromRoleKey' in role && systemRoles.has(role.copyFromRoleKey) && permissions) {
      const baselinePermissions = resolve(role.copyFromRoleKey) || [];
      roleTemplateBaselines[role.key] = {
        copyFromRoleKey: role.copyFromRoleKey,
        fingerprint: hashCanonicalConfig({ roleKey: role.copyFromRoleKey, scope: role.scope, permissions: baselinePermissions }),
        permissions: baselinePermissions,
      };
    }
  }
  return { errors, expandedRolePermissions: Object.fromEntries(resolved.entries()), roleTemplateBaselines };
}

function validateExpandedRolePermissionDependencies(
  normalizedFiles: Record<string, unknown>,
  expandedRolePermissions: Record<string, string[]>,
): RawValidationIssue[] {
  return fileEntries(normalizedFiles, './roles.json', 'roles').flatMap((role, index) => {
    const error = rolePermissionDependencyError(expandedRolePermissions[role.key] || []);
    return error ? [{ path: `./roles.json.roles.${index}.permissions`, message: error }] : [];
  });
}

class ConfigBundlePreviewService {
  compile(input: ConfigBundlePreviewInput, policy: ConfigBundlePolicyContext = { credentiallessCustomerSidecarsEnabled: false }): ConfigBundleCompilation {
    const inputApiVersion = input.bundle && typeof input.bundle === 'object' && !Array.isArray(input.bundle)
      ? (input.bundle as Record<string, unknown>).apiVersion
      : undefined;
    if (
      inputApiVersion !== ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1
      && inputApiVersion !== ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1
    ) {
      return {
        preview: {
          valid: false,
          errors: [{
            code: 'CONFIG_BUNDLE_API_VERSION_UNSUPPORTED',
            path: 'bundle.apiVersion',
            message: `Unsupported configuration apiVersion: ${typeof inputApiVersion === 'string' ? inputApiVersion : 'missing'}.`,
            severity: 'error',
            remediation: `Use ${ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1}; ${ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1} is accepted only for compatibility.`,
          }],
          counts: {},
        },
      };
    }
    const parsedBundle = EnterpriseGlueConfigBundleSchema.safeParse(input.bundle);
    if (!parsedBundle.success) {
      const governanceAliasesPresent = inputApiVersion === ENTERPRISEGLUE_CONFIG_API_VERSION_V1ALPHA1
        && Object.prototype.hasOwnProperty.call(input.bundle as Record<string, unknown>, 'settings');
      return {
        preview: {
          valid: false,
          contract: configBundleContractMetadataForApiVersion(inputApiVersion, governanceAliasesPresent),
          errors: enrichIssues(issues('bundle', parsedBundle.error), input),
          counts: {},
        },
      };
    }
    const normalized = normalizeEnterpriseGlueConfigBundle(parsedBundle.data);
    const errors: RawValidationIssue[] = [];
    const counts: Record<string, number> = {};
    const normalizedFiles: Record<string, unknown> = {};
    for (const path of normalized.bundle.imports) {
      if (!(path in input.files)) { errors.push({ path, message: 'Imported file is missing' }); continue; }
      const parsed = FILE_SCHEMAS[path].safeParse(input.files[path]);
      if (!parsed.success) { errors.push(...issues(path, parsed.error)); continue; }
      normalizedFiles[path] = parsed.data;
      const firstArray = Object.values(parsed.data as Record<string, unknown>).find(Array.isArray);
      counts[path] = Array.isArray(firstArray) ? firstArray.length : 0;
    }
    for (const path of Object.keys(input.files)) if (!normalized.bundle.imports.includes(path as never)) errors.push({ path, message: 'File is not declared in bundle imports' });
    let expandedRolePermissions: Record<string, string[]> | undefined;
    let roleTemplateBaselines: ConfigBundlePreview['roleTemplateBaselines'];
    if (errors.length === 0) {
      errors.push(...validateCrossFileReferences(normalizedFiles, policy));
      errors.push(...validateEndpointAuthenticationPolicy(normalizedFiles, policy));
      if (errors.length === 0) {
        const expanded = expandRoleTemplates(normalizedFiles);
        errors.push(...expanded.errors);
        errors.push(...validateExpandedRolePermissionDependencies(normalizedFiles, expanded.expandedRolePermissions));
        expandedRolePermissions = expanded.expandedRolePermissions;
        roleTemplateBaselines = expanded.roleTemplateBaselines;
      }
    }
    if (errors.length > 0) return { preview: { valid: false, contract: normalized.contract, errors: enrichIssues(errors, input), counts } };
    return {
      preview: {
        valid: true,
        canonicalHash: hashCanonicalConfig({ bundle: normalized.bundle, files: normalizedFiles, expandedRolePermissions, roleTemplateBaselines }),
        contract: normalized.contract,
        errors: [],
        counts,
        expandedRolePermissions,
        roleTemplateBaselines,
      },
      manifest: normalized.bundle,
      files: normalizedFiles,
    };
  }

  preview(input: ConfigBundlePreviewInput, policy?: ConfigBundlePolicyContext): ConfigBundlePreview {
    return this.compile(input, policy).preview;
  }
}

export const configBundlePreviewService = new ConfigBundlePreviewService();
