import { createHash } from 'node:crypto';
import { configBundlePreviewService, type ConfigBundlePreviewInput } from './ConfigBundlePreviewService.js';
import type { CamundaNativeGrantClassification } from '../../schemas/platform-admin/camunda-native-grants.js';

type GroupMapping =
  | { nativeGroupId: string; target: { mode: 'existing'; key: string } }
  | { nativeGroupId: string; target: { mode: 'new'; key: string; name: string; description?: string } };

export interface GenerateCamundaNativeGrantDraftInput {
  /** A validated existing configuration bundle/export to extend additively. */
  base: ConfigBundlePreviewInput;
  engineKey: string;
  /**
   * A UI/API-registered engine may be referenced for Runtime Resource Sets
   * without being copied into the configuration bundle. The apply endpoint
   * binds this key to the import run's engine id; it never changes that engine.
   */
  engineReferenceMode?: 'configured' | 'existing_registered';
  classifications: CamundaNativeGrantClassification[];
  groupMappings: GroupMapping[];
}

export interface CamundaNativeGrantDraft {
  bundle: unknown;
  files: Record<string, unknown>;
  canonicalHash: string;
  generated: { groupCount: number; roleCount: number; runtimeResourceSetCount: number; assignmentCount: number };
  manualWorkAuthorizationIds: string[];
}

const REQUIRED_IMPORTS = ['./roles.json', './groups.json', './runtime-resource-sets.json', './assignments.json'] as const;
const ACTION_PERMISSION: Record<string, string> = {
  'engine.runtime.process-definitions.read': 'engine:instance:view',
  'engine.runtime.decisions.read': 'engine:instance:view',
};

function opaqueKeyPart(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

/** Stable opaque key used only inside a native-grant migration draft. */
export function camundaNativeGrantExternalEngineKey(engineId: string): string {
  const normalized = engineId.trim();
  if (!normalized) throw new Error('Engine id is required');
  return `external.camunda-native-${opaqueKeyPart(normalized)}`;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function entries(files: Record<string, unknown>, path: string, property: string): Array<Record<string, unknown>> {
  const file = requireObject(files[path] || {}, path);
  const value = file[property];
  if (value === undefined) {
    file[property] = [];
    files[path] = file;
  }
  if (!Array.isArray(file[property])) throw new Error(`${path}.${property} must be an array`);
  return file[property] as Array<Record<string, unknown>>;
}

function keySet(items: Array<Record<string, unknown>>): Set<string> {
  return new Set(items.map((item) => typeof item.key === 'string' ? item.key : '').filter(Boolean));
}

function exactlyOne<T>(values: T[], description: string): T {
  if (values.length !== 1) throw new Error(description);
  return values[0];
}

/**
 * Builds a deterministic additive configuration draft from only convertible,
 * exact group READ grants. It never creates an engine-wide substitute for a
 * resource-specific grant and never includes manual/blocked native grants.
 */
export class CamundaNativeGrantDraftService {
  generate(input: GenerateCamundaNativeGrantDraftInput): CamundaNativeGrantDraft {
    const bundle = structuredClone(input.base.bundle);
    const files = structuredClone(input.base.files);
    const manifest = requireObject(bundle, 'bundle');
    const imports = manifest.imports;
    if (!Array.isArray(imports)) throw new Error('Bundle imports must be an array');
    imports.push(...REQUIRED_IMPORTS);
    manifest.imports = [...new Set(imports)].sort();

    const engineKey = input.engineKey.trim();
    if (!engineKey) throw new Error('Engine reference key is required');
    const engineReferenceMode = input.engineReferenceMode || 'configured';
    const configuredEngines = engineReferenceMode === 'configured'
      ? entries(files, './engines.json', 'engines')
      : [];
    if (engineReferenceMode === 'configured' && !configuredEngines.some((engine) => engine.key === engineKey && engine.type === 'camunda7')) {
      throw new Error('The base configuration must contain the target Camunda 7 engine');
    }

    const groups = entries(files, './groups.json', 'groups');
    const roles = entries(files, './roles.json', 'roles');
    const runtimeResourceSets = entries(files, './runtime-resource-sets.json', 'runtimeResourceSets');
    const assignments = entries(files, './assignments.json', 'assignments');
    const groupMappings = new Map<string, GroupMapping>();
    for (const mapping of input.groupMappings) {
      const nativeGroupId = mapping.nativeGroupId.trim();
      if (!nativeGroupId || groupMappings.has(nativeGroupId)) throw new Error('Each native group needs one unique mapping');
      groupMappings.set(nativeGroupId, { ...mapping, nativeGroupId });
    }

    const groupKeys = keySet(groups);
    for (const mapping of groupMappings.values()) {
      if (mapping.target.mode === 'existing' && !groupKeys.has(mapping.target.key)) throw new Error(`Mapped EnterpriseGlue group does not exist: ${mapping.target.key}`);
      if (mapping.target.mode === 'new') {
        if (groupKeys.has(mapping.target.key)) throw new Error(`Generated EnterpriseGlue group already exists: ${mapping.target.key}`);
        groups.push({ key: mapping.target.key, name: mapping.target.name, ...(mapping.target.description ? { description: mapping.target.description } : {}), ownershipMode: 'config_locked' });
        groupKeys.add(mapping.target.key);
      }
    }

    const convertible = input.classifications
      .filter((classification) => classification.disposition === 'proposed')
      .sort((left, right) => left.sourceAuthorizationId.localeCompare(right.sourceAuthorizationId));
    const manualWorkAuthorizationIds = input.classifications
      .filter((classification) => classification.disposition !== 'proposed')
      .map((classification) => classification.sourceAuthorizationId)
      .sort();
    const roleKey = `custom.camunda-native-${opaqueKeyPart(engineKey)}-runtime-read`;
    if (convertible.length > 0 && keySet(roles).has(roleKey)) throw new Error(`Generated migration role already exists: ${roleKey}`);
    const actionIds = new Set(convertible.flatMap((classification) => classification.mappedActionIds));
    const permissionIds = [...actionIds].map((actionId) => ACTION_PERMISSION[actionId]);
    if (permissionIds.some((permission) => !permission)) throw new Error('A proposed native grant has no safe permission mapping');
    if (convertible.length > 0) {
      roles.push({
        key: roleKey,
        name: 'Imported Camunda runtime reader',
        description: 'Least-privileged role generated from reviewed Camunda 7 READ grants.',
        scope: 'engine',
        permissions: [...new Set(permissionIds)].sort(),
        ownershipMode: 'config_locked',
      });
    }

    const existingSetKeys = keySet(runtimeResourceSets);
    const generatedSetKeys = new Set<string>();
    const assignmentKeys = keySet(assignments);
    const generatedAssignmentKeys = new Set<string>();
    const generatedAssignmentIdentities = new Set<string>();
    for (const classification of convertible) {
      if (!classification.principal.groupId || !classification.resourceKind || !classification.resourceId || classification.resourceId === '*') {
        throw new Error(`Proposed authorization ${classification.sourceAuthorizationId} is missing an exact group resource target`);
      }
      const mapping = exactlyOne([...groupMappings.values()].filter((candidate) => candidate.nativeGroupId === classification.principal.groupId), `No EnterpriseGlue group mapping for native group ${classification.principal.groupId}`);
      const targetGroupKey = mapping.target.key;
      const resourcePart = opaqueKeyPart(`${classification.resourceKind}\u0000${classification.resourceId}\u0000${classification.runtimeTenantId || ''}`);
      const runtimeResourceSetKey = `runtime.camunda-native-${opaqueKeyPart(engineKey)}-${classification.resourceKind}-${resourcePart}`;
      const assignmentIdentity = `${targetGroupKey}\u0000${roleKey}\u0000${runtimeResourceSetKey}`;
      const assignmentKey = `assignment.camunda-native-${opaqueKeyPart(assignmentIdentity)}-${resourcePart}`;
      if (existingSetKeys.has(runtimeResourceSetKey) || (!generatedAssignmentIdentities.has(assignmentIdentity) && assignmentKeys.has(assignmentKey))) throw new Error('Generated migration keys collide with existing configuration');
      if (!generatedSetKeys.has(runtimeResourceSetKey)) {
        runtimeResourceSets.push({
          key: runtimeResourceSetKey,
          name: `Imported Camunda ${classification.resourceKind.replace('_', ' ')} reader`,
          description: 'Exact runtime resource scope generated from a reviewed native Camunda 7 grant.',
          engineRef: { engineKey },
          resourceKind: classification.resourceKind,
          selector: { mode: 'keys', keys: [classification.resourceId] },
          ...(classification.runtimeTenantId ? { runtimeTenantId: classification.runtimeTenantId } : {}),
          ownershipMode: 'config_locked',
        });
        generatedSetKeys.add(runtimeResourceSetKey);
      }
      if (!generatedAssignmentIdentities.has(assignmentIdentity)) {
        assignments.push({
          key: assignmentKey,
          principal: { type: 'group', key: targetGroupKey },
          roleKey,
          scope: { type: 'engine_runtime_resource_set', runtimeResourceSetKey },
          ownershipMode: 'config_locked',
        });
        assignmentKeys.add(assignmentKey);
        generatedAssignmentKeys.add(assignmentKey);
        generatedAssignmentIdentities.add(assignmentIdentity);
      }
    }

    const compiled = configBundlePreviewService.compile({ bundle, files }, {
      credentiallessCustomerSidecarsEnabled: false,
      ...(engineReferenceMode === 'existing_registered'
        ? { externalEngineReferences: [{ key: engineKey }] }
        : {}),
    });
    if (!compiled.preview.valid || !compiled.preview.canonicalHash) {
      const detail = compiled.preview.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
      throw new Error(`Generated Camunda native-grant draft is invalid: ${detail}`);
    }
    return {
      bundle,
      files,
      canonicalHash: compiled.preview.canonicalHash,
      generated: {
        groupCount: [...groupMappings.values()].filter((mapping) => mapping.target.mode === 'new').length,
        roleCount: convertible.length > 0 ? 1 : 0,
        runtimeResourceSetCount: generatedSetKeys.size,
        assignmentCount: generatedAssignmentKeys.size,
      },
      manualWorkAuthorizationIds,
    };
  }
}

export const camundaNativeGrantDraftService = new CamundaNativeGrantDraftService();
