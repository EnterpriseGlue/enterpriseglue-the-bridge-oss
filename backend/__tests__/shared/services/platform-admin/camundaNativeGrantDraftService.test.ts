import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { camundaNativeGrantExternalEngineKey, CamundaNativeGrantDraftService, type GenerateCamundaNativeGrantDraftInput } from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantDraftService.js';
import type { CamundaNativeGrantClassification } from '@enterpriseglue/shared/schemas/platform-admin/camunda-native-grants.js';

const base = {
  bundle: {
    apiVersion: 'enterpriseglue.ai/v1alpha1',
    kind: 'EnterpriseGlueConfigBundle',
    metadata: { key: 'migration.camunda-native', owner: 'platform-admin' },
    tenantKey: 'tenant.acme', mode: 'additive',
    settings: { engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative' },
    imports: ['./engines.json'],
  },
  files: {
    './engines.json': {
      engines: [{
        key: 'engine.camunda7', name: 'Camunda 7', type: 'camunda7', baseUrl: 'https://camunda.example.test/engine-rest', labels: {},
        auth: { type: 'basic', username: 'migration-reader', passwordRef: 'env://CAMUNDA_PASSWORD' },
      }],
    },
  },
};

const proposed: CamundaNativeGrantClassification = {
  sourceAuthorizationId: 'native-a', disposition: 'proposed', reasonCodes: ['group_grant_process_definition'],
  principal: { type: 'group', groupId: 'C7-native-sensitive-ops' }, resourceKind: 'process_definition',
  resourceId: 'payments-order', runtimeTenantId: 'runtime-payments', mappedActionIds: ['engine.runtime.process-definitions.read'],
};
const opaque = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

describe('CamundaNativeGrantDraftService', () => {
  it('generates a deterministic, resource-aware configuration draft without changing authority mode', () => {
    const service = new CamundaNativeGrantDraftService();
    const input: GenerateCamundaNativeGrantDraftInput = {
      base,
      engineKey: 'engine.camunda7',
      classifications: [
        proposed,
        { ...proposed, sourceAuthorizationId: 'native-b', principal: { type: 'group' as const, groupId: 'C7-native-sensitive-audit' } },
        { ...proposed, sourceAuthorizationId: 'native-user', disposition: 'manual_required' as const, reasonCodes: ['user_identity_mapping_required'], principal: { type: 'user' as const }, resourceKind: null, resourceId: null, runtimeTenantId: null, mappedActionIds: [] },
      ],
      groupMappings: [
        { nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'new' as const, key: 'group.imported-operations', name: 'Imported operations' } },
        { nativeGroupId: 'C7-native-sensitive-audit', target: { mode: 'new' as const, key: 'group.imported-audit', name: 'Imported audit' } },
      ],
    };

    const first = service.generate(input);
    const second = service.generate(input);

    expect(first.canonicalHash).toBe(second.canonicalHash);
    expect(first.generated).toEqual({ groupCount: 2, roleCount: 1, runtimeResourceSetCount: 1, assignmentCount: 2 });
    expect(first.manualWorkAuthorizationIds).toEqual(['native-user']);
    expect(first.bundle).toMatchObject({ settings: { engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative' } });
    const files = first.files as Record<string, any>;
    expect(files['./roles.json'].roles).toEqual([expect.objectContaining({ scope: 'engine', permissions: ['engine:instance:view'] })]);
    expect(files['./runtime-resource-sets.json'].runtimeResourceSets).toEqual([expect.objectContaining({
      resourceKind: 'process_definition', selector: { mode: 'keys', keys: ['payments-order'] }, runtimeTenantId: 'runtime-payments',
    })]);
    expect(files['./assignments.json'].assignments).toHaveLength(2);
    expect(JSON.stringify(first)).not.toContain('C7-native-sensitive-ops');
  });

  it('fails closed if a proposal cannot be tied to a target group, an exact resource, or a configured Camunda 7 engine', () => {
    const service = new CamundaNativeGrantDraftService();
    const valid = { base, engineKey: 'engine.camunda7', classifications: [proposed], groupMappings: [] };

    expect(() => service.generate(valid)).toThrow('No EnterpriseGlue group mapping');
    expect(() => service.generate({ ...valid, engineKey: 'engine.other' })).toThrow('target Camunda 7 engine');
    expect(() => service.generate({
      ...valid,
      classifications: [{ ...proposed, resourceId: '*' }],
      groupMappings: [{ nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'new', key: 'group.imported-operations', name: 'Imported operations' } }],
    })).toThrow('missing an exact group resource target');
  });

  it('can bind a draft to an existing UI-registered engine without copying that engine into the bundle', () => {
    const service = new CamundaNativeGrantDraftService();
    const engineKey = camundaNativeGrantExternalEngineKey('engine-added-in-ui');
    const result = service.generate({
      base: {
        bundle: { ...base.bundle, imports: [] },
        files: {},
      },
      engineKey,
      engineReferenceMode: 'existing_registered',
      classifications: [proposed],
      groupMappings: [{ nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'new', key: 'group.imported-operations', name: 'Imported operations' } }],
    });

    const files = result.files as Record<string, any>;
    expect(files['./engines.json']).toBeUndefined();
    expect(files['./runtime-resource-sets.json'].runtimeResourceSets[0].engineRef).toEqual({ engineKey });
    expect(result.bundle).toMatchObject({ settings: { engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative' } });
    expect(camundaNativeGrantExternalEngineKey('engine-added-in-ui')).toBe(engineKey);
    expect(camundaNativeGrantExternalEngineKey('engine-added-in-ui')).not.toContain('engine-added-in-ui');
  });

  it('does not silently use an existing group or configuration object without an explicit compatible mapping', () => {
    const service = new CamundaNativeGrantDraftService();
    expect(() => service.generate({
      base, engineKey: 'engine.camunda7', classifications: [proposed],
      groupMappings: [{ nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'existing', key: 'group.missing' } }],
    })).toThrow('does not exist');
    expect(() => service.generate({
      base: { ...base, files: { ...base.files, './groups.json': { groups: [{ key: 'group.imported-operations', name: 'Existing' }] } } },
      engineKey: 'engine.camunda7', classifications: [proposed],
      groupMappings: [{ nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'new', key: 'group.imported-operations', name: 'Replacement' } }],
    })).toThrow('already exists');
  });

  it('supports an explicitly mapped existing group and a dedicated resource without a runtime tenant', () => {
    const service = new CamundaNativeGrantDraftService();
    const result = service.generate({
      base: { ...base, files: { ...base.files, './groups.json': { groups: [{ key: 'group.existing', name: 'Existing group' }] } } },
      engineKey: 'engine.camunda7', classifications: [{ ...proposed, resourceKind: 'decision_definition', resourceId: 'credit-check', runtimeTenantId: null, mappedActionIds: ['engine.runtime.decisions.read'] }],
      groupMappings: [{ nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'existing', key: 'group.existing' } }],
    });
    expect(result.generated).toMatchObject({ groupCount: 0, runtimeResourceSetCount: 1 });
    expect((result.files as Record<string, any>)['./runtime-resource-sets.json'].runtimeResourceSets[0]).not.toHaveProperty('runtimeTenantId');
  });

  it('unions compatible native rows into one least-privileged resource assignment', () => {
    const service = new CamundaNativeGrantDraftService();
    const result = service.generate({
      base,
      engineKey: 'engine.camunda7',
      classifications: [proposed, { ...proposed, sourceAuthorizationId: 'native-duplicate' }],
      groupMappings: [{ nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'new', key: 'group.imported-operations', name: 'Imported operations' } }],
    });

    expect(result.generated).toEqual({ groupCount: 1, roleCount: 1, runtimeResourceSetCount: 1, assignmentCount: 1 });
    expect((result.files as Record<string, any>)['./assignments.json'].assignments).toHaveLength(1);
  });

  it('rejects malformed source configuration and non-convertible generated content instead of producing a partial draft', () => {
    const service = new CamundaNativeGrantDraftService();
    const mapping = [{ nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'new' as const, key: 'group.imported-operations', name: 'Imported operations', description: 'Reviewed mapping' } }];
    expect(() => service.generate({ base: { ...base, bundle: [] as any }, engineKey: 'engine.camunda7', classifications: [], groupMappings: [] })).toThrow('bundle must be an object');
    expect(() => service.generate({ base: { ...base, bundle: { ...base.bundle, imports: {} as any } }, engineKey: 'engine.camunda7', classifications: [], groupMappings: [] })).toThrow('imports must be an array');
    expect(() => service.generate({ base: { ...base, files: { ...base.files, './groups.json': [] as any } }, engineKey: 'engine.camunda7', classifications: [], groupMappings: [] })).toThrow('./groups.json must be an object');
    expect(() => service.generate({ base: { ...base, files: { ...base.files, './groups.json': { groups: {} } } }, engineKey: 'engine.camunda7', classifications: [], groupMappings: [] })).toThrow('./groups.json.groups must be an array');
    expect(() => service.generate({ base, engineKey: 'engine.camunda7', classifications: [{ ...proposed, mappedActionIds: ['engine.runtime.unknown'] }], groupMappings: mapping })).toThrow('no safe permission mapping');
    expect(() => service.generate({ base, engineKey: 'engine.camunda7', classifications: [proposed], groupMappings: [...mapping, mapping[0]] })).toThrow('unique mapping');
    expect(() => service.generate({
      base: { ...base, bundle: { ...base.bundle, metadata: { key: 'migration.camunda-native' } } }, engineKey: 'engine.camunda7', classifications: [], groupMappings: [],
    })).toThrow('Generated Camunda native-grant draft is invalid');
    expect(() => service.generate({ base, engineKey: '   ', classifications: [], groupMappings: [] })).toThrow('Engine reference key is required');
  });

  it('rejects deterministic key collisions and still creates a valid no-op draft for manual-only input', () => {
    const service = new CamundaNativeGrantDraftService();
    const roleKey = `custom.camunda-native-${opaque('engine.camunda7')}-runtime-read`;
    const resourcePart = opaque('process_definition\u0000payments-order\u0000runtime-payments');
    const setKey = `runtime.camunda-native-${opaque('engine.camunda7')}-process_definition-${resourcePart}`;
    const assignmentKey = `assignment.camunda-native-${opaque(`group.imported-operations\u0000${roleKey}\u0000${setKey}`)}-${resourcePart}`;
    const mapping = [{ nativeGroupId: 'C7-native-sensitive-ops', target: { mode: 'new' as const, key: 'group.imported-operations', name: 'Imported operations' } }];
    expect(() => service.generate({
      base: { ...base, files: { ...base.files, './roles.json': { roles: [{ key: roleKey, name: 'Existing', scope: 'engine', permissions: ['engine:instance:view'] }] } } },
      engineKey: 'engine.camunda7', classifications: [proposed], groupMappings: mapping,
    })).toThrow('role already exists');
    expect(() => service.generate({
      base: { ...base, files: { ...base.files, './runtime-resource-sets.json': { runtimeResourceSets: [{ key: setKey }] }, './assignments.json': { assignments: [{ key: assignmentKey }] } } },
      engineKey: 'engine.camunda7', classifications: [proposed], groupMappings: mapping,
    })).toThrow('keys collide');
    const noOp = service.generate({
      base: { ...base, bundle: { ...base.bundle, imports: ['./engines.json', './roles.json', './groups.json', './runtime-resource-sets.json', './assignments.json'] } }, engineKey: 'engine.camunda7',
      classifications: [{ ...proposed, sourceAuthorizationId: 'manual-only', disposition: 'manual_required', reasonCodes: ['user_identity_mapping_required'], principal: { type: 'user' as const }, resourceKind: null, resourceId: null, runtimeTenantId: null, mappedActionIds: [] }],
      groupMappings: [],
    });
    expect(noOp.generated).toEqual({ groupCount: 0, roleCount: 0, runtimeResourceSetCount: 0, assignmentCount: 0 });
    expect(() => service.generate({
      base: { ...base, files: { ...base.files, './groups.json': { groups: [{}] } } }, engineKey: 'engine.camunda7', classifications: [], groupMappings: [],
    })).toThrow('Generated Camunda native-grant draft is invalid');
  });
});
