import { z } from 'zod';
import {
  ConfigAssignmentsFileSchema, ConfigEnginesFileSchema, ConfigEngineSetsFileSchema, ConfigGroupsFileSchema,
  ConfigIdentityMappingsFileSchema, ConfigIdentityProvidersFileSchema, ConfigProjectEngineTargetsFileSchema,
  ConfigRolesFileSchema, ConfigRuntimeResourceSetsFileSchema, EnterpriseGlueConfigBundleSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import { PermissionCatalog, SystemRoleDefinitions } from './permissions.js';
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
export interface ConfigBundlePreview {
  valid: boolean;
  canonicalHash?: string;
  errors: Array<{ path: string; message: string }>;
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

function issues(prefix: string, error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: [prefix, ...issue.path].join('.'), message: issue.message }));
}

function fileEntries(normalizedFiles: Record<string, unknown>, path: string, property: string): any[] {
  const file = normalizedFiles[path] as Record<string, unknown> | undefined;
  const entries = file?.[property];
  return Array.isArray(entries) ? entries : [];
}

/**
 * Ensures a bundle is internally coherent before a future compiler resolves
 * its references against persisted records. This phase deliberately does not
 * touch the database or attempt connectivity/secret resolution.
 */
function validateCrossFileReferences(normalizedFiles: Record<string, unknown>): Array<{ path: string; message: string }> {
  const errors: Array<{ path: string; message: string }> = [];
  const roles = fileEntries(normalizedFiles, './roles.json', 'roles');
  const groups = fileEntries(normalizedFiles, './groups.json', 'groups');
  const engines = fileEntries(normalizedFiles, './engines.json', 'engines');
  const engineSets = fileEntries(normalizedFiles, './engine-sets.json', 'engineSets');
  const runtimeResourceSets = fileEntries(normalizedFiles, './runtime-resource-sets.json', 'runtimeResourceSets');
  const identityProviders = fileEntries(normalizedFiles, './identity-providers.json', 'identityProviders');
  const identityMappings = fileEntries(normalizedFiles, './identity-mappings.json', 'identityMappings');
  const assignments = fileEntries(normalizedFiles, './assignments.json', 'assignments');
  const targets = fileEntries(normalizedFiles, './project-engine-targets.json', 'projectEngineTargets');

  const roleKeys = new Set([...SystemRoleDefinitions.map((role) => role.key), ...roles.map((role) => role.key)]);
  const groupKeys = new Set(groups.map((group) => group.key));
  const engineKeys = new Set(engines.map((engine) => engine.key));
  const engineSetKeys = new Set(engineSets.map((engineSet) => engineSet.key));
  const runtimeResourceSetKeys = new Set(runtimeResourceSets.map((set) => set.key));
  const permissionScopes = new Map(PermissionCatalog.map((permission) => [permission.key, permission.scope]));

  roles.forEach((role, index) => {
    const path = `./roles.json.roles.${index}`;
    if ('copyFromRoleKey' in role && !roleKeys.has(role.copyFromRoleKey)) {
      errors.push({ path: `${path}.copyFromRoleKey`, message: `Unknown role key: ${role.copyFromRoleKey}` });
    }
    const permissionIds = 'permissions' in role
      ? role.permissions
      : [...(role.addPermissions || []), ...(role.removePermissions || [])];
    for (const permissionId of permissionIds) {
      const permissionScope = permissionScopes.get(permissionId);
      if (!permissionScope) {
        errors.push({ path: `${path}.permissions`, message: `Unknown permission: ${permissionId}` });
      } else if (permissionScope !== role.scope) {
        errors.push({ path: `${path}.permissions`, message: `Permission ${permissionId} has ${permissionScope} scope and cannot be used by a ${role.scope} role` });
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

  runtimeResourceSets.forEach((set, index) => {
    if (!engineKeys.has(set.engineRef.engineKey)) {
      errors.push({ path: `./runtime-resource-sets.json.runtimeResourceSets.${index}.engineRef.engineKey`, message: `Unknown engine key: ${set.engineRef.engineKey}` });
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
  errors: Array<{ path: string; message: string }>;
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
  const errors: Array<{ path: string; message: string }> = [];

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

class ConfigBundlePreviewService {
  compile(input: ConfigBundlePreviewInput): ConfigBundleCompilation {
    const parsedBundle = EnterpriseGlueConfigBundleSchema.safeParse(input.bundle);
    if (!parsedBundle.success) return { preview: { valid: false, errors: issues('bundle', parsedBundle.error), counts: {} } };
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
    let expandedRolePermissions: Record<string, string[]> | undefined;
    let roleTemplateBaselines: ConfigBundlePreview['roleTemplateBaselines'];
    if (errors.length === 0) {
      errors.push(...validateCrossFileReferences(normalizedFiles));
      if (errors.length === 0) {
        const expanded = expandRoleTemplates(normalizedFiles);
        errors.push(...expanded.errors);
        expandedRolePermissions = expanded.expandedRolePermissions;
        roleTemplateBaselines = expanded.roleTemplateBaselines;
      }
    }
    if (errors.length > 0) return { preview: { valid: false, errors, counts } };
    return {
      preview: {
        valid: true,
        canonicalHash: hashCanonicalConfig({ bundle: parsedBundle.data, files: normalizedFiles, expandedRolePermissions, roleTemplateBaselines }),
        errors: [],
        counts,
        expandedRolePermissions,
        roleTemplateBaselines,
      },
      manifest: parsedBundle.data,
      files: normalizedFiles,
    };
  }

  preview(input: ConfigBundlePreviewInput): ConfigBundlePreview {
    return this.compile(input).preview;
  }
}

export const configBundlePreviewService = new ConfigBundlePreviewService();
