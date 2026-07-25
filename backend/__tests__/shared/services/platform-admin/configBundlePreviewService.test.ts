import { describe, expect, it } from 'vitest';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { SystemRoleDefinitions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

const bundle = { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle', metadata: { key: 'acme.authz', owner: 'platform' }, tenantKey: 'acme', mode: 'preview_only', settings: {}, imports: ['./groups.json'] };
describe('configBundlePreviewService', () => {
  it('validates declared files and produces a deterministic canonical hash', () => {
    const input = { bundle, files: { './groups.json': { groups: [{ key: 'group.ops', name: 'Ops' }] } } };
    const first = configBundlePreviewService.preview(input);
    expect(first).toMatchObject({ valid: true, counts: { './groups.json': 1 }, canonicalHash: expect.any(String) });
    expect(configBundlePreviewService.preview(input).canonicalHash).toBe(first.canonicalHash);
  });
  it('rejects missing and undeclared files before apply can mutate state', () => {
    expect(configBundlePreviewService.preview({ bundle, files: { './roles.json': { roles: [] } } })).toMatchObject({ valid: false });
  });

  it('rejects OAuth scopes as config-managed human identity mappings', () => {
    const result = configBundlePreviewService.preview({
      bundle: { ...bundle, imports: ['./identity-mappings.json'] },
      files: {
        './identity-mappings.json': {
          identityMappings: [{
            key: 'mapping.delegated-scope', providerKey: 'identity.oidc.main',
            source: { type: 'scope', externalId: 'engines.read', operator: 'exact' }, targetGroupKey: 'group.operators',
          }],
        },
      },
    });

    expect(result).toMatchObject({ valid: false });
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: './identity-mappings.json.identityMappings.0.source.type' }),
    ]));
  });

  it('rejects credentialless sidecars unless platform policy explicitly permits them', () => {
    const input = {
      bundle: { ...bundle, imports: ['./engines.json'] },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.private-sidecar',
            name: 'Private sidecar',
            type: 'ion',
            baseUrl: 'https://sidecar.example.com/engine-rest',
            connectionMode: 'customer_sidecar',
            auth: { type: 'none' },
          }],
        },
      },
    };

    const blocked = configBundlePreviewService.preview(input);
    expect(blocked).toMatchObject({ valid: false });
    expect(blocked.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: './engines.json.engines.0.auth.type',
        message: 'Credentialless customer-sidecar endpoints are disabled by platform policy',
        objectKey: 'engine.private-sidecar',
      }),
    ]));

    const permitted = configBundlePreviewService.preview(input, {
      credentiallessCustomerSidecarsEnabled: true,
    });
    expect(permitted).toMatchObject({ valid: true, canonicalHash: expect.any(String) });
  });

  it('accepts portable config-owned mappings for a shared engine', () => {
    const result = configBundlePreviewService.preview({
      bundle: {
        ...bundle,
        imports: ['./engines.json', './engine-tenant-mappings.json'],
      },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.central',
            name: 'Central',
            type: 'operaton',
            baseUrl: 'https://central.example.test/engine-rest',
            auth: { type: 'basic', username: 'engine-user', passwordRef: 'CENTRAL_PASSWORD' },
            runtimeAccessScope: 'resource_aware',
            tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
          }],
        },
        './engine-tenant-mappings.json': {
          engineTenantMappings: [{
            key: 'engine-tenant-mapping.central-acme',
            engineRef: { engineKey: 'engine.central' },
            externalTenantId: 'acme',
            tenantRef: { type: 'key', key: 'tenant.acme' },
            strategy: 'engine_tenant_id',
          }],
        },
      },
    });

    expect(result).toMatchObject({
      valid: true,
      counts: {
        './engines.json': 1,
        './engine-tenant-mappings.json': 1,
      },
      canonicalHash: expect.any(String),
    });
  });

  it('accepts only configured Camunda 7 engines and configured groups for secret-backed backstop mappings', () => {
    const input = {
      bundle: { ...bundle, imports: ['./engines.json', './groups.json', './engine-backstop-mappings.json'] },
      files: {
        './engines.json': { engines: [{
          key: 'engine.camunda', name: 'Camunda', type: 'camunda7', baseUrl: 'https://camunda.example.test/engine-rest',
          auth: { type: 'basic', username: 'engine-user', passwordRef: 'CAMUNDA_PASSWORD' },
        }] },
        './groups.json': { groups: [{ key: 'group.operators', name: 'Operators' }] },
        './engine-backstop-mappings.json': { engineBackstopMappings: [{
          key: 'engine-backstop-mapping.camunda-operators',
          engineRef: { engineKey: 'engine.camunda' },
          groupRef: { groupKey: 'group.operators' },
          nativeGroupIdRef: 'CAMUNDA_OPERATORS_GROUP',
        }] },
      },
    };

    expect(configBundlePreviewService.preview(input)).toMatchObject({ valid: true, canonicalHash: expect.any(String) });
    const invalid = configBundlePreviewService.preview({
      ...input,
      files: {
        ...input.files,
        './engines.json': { engines: [{ ...input.files['./engines.json'].engines[0], type: 'operaton' }] },
        './engine-backstop-mappings.json': { engineBackstopMappings: [{
          ...input.files['./engine-backstop-mappings.json'].engineBackstopMappings[0],
          groupRef: { groupKey: 'group.missing' },
        }] },
      },
    });
    expect(invalid).toMatchObject({ valid: false });
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Mirrored backstop mappings require a Camunda 7 engine' }),
      expect.objectContaining({ message: 'Unknown group key: group.missing' }),
    ]));
  });

  it('rejects dedicated-engine and strategy-mismatched tenant mappings', () => {
    const result = configBundlePreviewService.preview({
      bundle: {
        ...bundle,
        imports: ['./engines.json', './engine-tenant-mappings.json'],
      },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.dedicated',
            name: 'Dedicated',
            type: 'operaton',
            baseUrl: 'https://dedicated.example.test/engine-rest',
            auth: { type: 'basic', username: 'engine-user', passwordRef: 'ENGINE_PASSWORD' },
          }, {
            key: 'engine.shared',
            name: 'Shared',
            type: 'operaton',
            baseUrl: 'https://shared.example.test/engine-rest',
            auth: { type: 'basic', username: 'engine-user', passwordRef: 'ENGINE_PASSWORD' },
            runtimeAccessScope: 'resource_aware',
            tenancy: { mode: 'shared', mappingStrategy: 'deployment_target' },
          }],
        },
        './engine-tenant-mappings.json': {
          engineTenantMappings: [{
            key: 'engine-tenant-mapping.dedicated',
            engineRef: { engineKey: 'engine.dedicated' },
            externalTenantId: 'acme',
            tenantRef: { type: 'request_context' },
            strategy: 'engine_tenant_id',
          }, {
            key: 'engine-tenant-mapping.shared',
            engineRef: { engineKey: 'engine.shared' },
            externalTenantId: 'project-a',
            tenantRef: { type: 'request_context' },
            strategy: 'engine_tenant_id',
          }],
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('requires a shared engine') }),
      expect.objectContaining({ message: expect.stringContaining('does not match engine strategy') }),
    ]));
  });

  it.each([
    { name: 'basic password', auth: { type: 'basic', username: 'engine-user', password: 'literal-basic-password' } },
    { name: 'bearer token', auth: { type: 'bearer', token: 'literal-bearer-token' } },
  ])('rejects plaintext $name without exposing its value in preview diagnostics', ({ auth }) => {
    const result = configBundlePreviewService.preview({
      bundle: { ...bundle, imports: ['./engines.json'] },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.private', name: 'Private engine', type: 'operaton', baseUrl: 'https://engine.example.test/engine-rest', auth,
          }],
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('literal-');
  });

  it('rejects cross-file references that a future apply could not resolve', () => {
    const result = configBundlePreviewService.preview({
      bundle: {
        ...bundle,
        imports: ['./roles.json', './assignments.json'],
      },
      files: {
        './roles.json': {
          roles: [{
            key: 'custom.engine.operator',
            name: 'Operator',
            scope: 'engine',
            permissions: ['engine:deploy'],
          }],
        },
        './assignments.json': {
          assignments: [{
            key: 'assignment.missing',
            principal: { type: 'group', key: 'group.missing' },
            roleKey: 'custom.engine.missing',
            scope: { type: 'engine', engineKey: 'engine.missing' },
          }],
        },
      },
    });

    expect(result).toMatchObject({ valid: false });
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: './assignments.json.assignments.0.principal.key',
        message: 'Unknown group key: group.missing',
        severity: 'error',
        objectKey: 'assignment.missing',
        remediation: expect.stringContaining('Define the referenced object'),
      }),
      expect.objectContaining({ path: './assignments.json.assignments.0.scope.engineKey', message: 'Unknown engine key: engine.missing' }),
      expect.objectContaining({ path: './assignments.json.assignments.0.roleKey', message: 'Unknown role key: custom.engine.missing' }),
    ]));
  });

  it('permits an internal existing-engine reference only for a Runtime Resource Set', () => {
    const input = {
      bundle: {
        ...bundle,
        imports: ['./runtime-resource-sets.json'],
      },
      files: {
        './runtime-resource-sets.json': {
          runtimeResourceSets: [{
            key: 'runtime.imported-orders',
            name: 'Imported orders',
            engineRef: { engineKey: 'external.camunda-native-1234' },
            resourceKind: 'process_definition',
            selector: { mode: 'keys', keys: ['orders'] },
          }],
        },
      },
    };

    expect(configBundlePreviewService.preview(input)).toMatchObject({ valid: false });
    expect(configBundlePreviewService.preview(input, {
      credentiallessCustomerSidecarsEnabled: false,
      externalEngineReferences: [{ key: 'external.camunda-native-1234' }],
    })).toMatchObject({ valid: true });

    const directAssignment = configBundlePreviewService.preview({
      bundle: { ...bundle, imports: ['./roles.json', './groups.json', './assignments.json'] },
      files: {
        './roles.json': { roles: [{ key: 'custom.engine.reader', name: 'Reader', scope: 'engine', permissions: ['engine:instance:view'] }] },
        './groups.json': { groups: [{ key: 'group.reader', name: 'Reader' }] },
        './assignments.json': { assignments: [{ key: 'assignment.reader', principal: { type: 'group', key: 'group.reader' }, roleKey: 'custom.engine.reader', scope: { type: 'engine', engineKey: 'external.camunda-native-1234' } }] },
      },
    }, {
      credentiallessCustomerSidecarsEnabled: false,
      externalEngineReferences: [{ key: 'external.camunda-native-1234' }],
    });
    expect(directAssignment).toMatchObject({ valid: false });
  });

  it('rejects a permission whose scope does not match its custom role', () => {
    const result = configBundlePreviewService.preview({
      bundle: { ...bundle, imports: ['./roles.json'] },
      files: {
        './roles.json': {
          roles: [{
            key: 'custom.platform.deployer',
            name: 'Platform deployer',
            scope: 'platform',
            permissions: ['engine:deploy'],
          }],
        },
      },
    });

    expect(result).toMatchObject({ valid: false });
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: './roles.json.roles.0.permissions',
        message: 'Permission engine:deploy has engine scope and cannot be used by a platform role',
      }),
    ]));
  });

  it('expands same-scope copied custom roles and rejects template cycles', () => {
    const templateBundle = {
      ...bundle,
      imports: ['./roles.json'],
    };
    const expanded = configBundlePreviewService.preview({
      bundle: templateBundle,
      files: {
        './roles.json': {
          roles: [{
            key: 'custom.engine.deployer-plus',
            name: 'Deployer Plus',
            scope: 'engine',
            copyFromRoleKey: 'system.engine.deployer',
            addPermissions: ['engine:process:start'],
            removePermissions: [],
          }],
        },
      },
    });

    expect(expanded).toMatchObject({
      valid: true,
      expandedRolePermissions: {
        'custom.engine.deployer-plus': expect.arrayContaining(['engine:deploy', 'engine:process:start']),
      },
      roleTemplateBaselines: {
        'custom.engine.deployer-plus': {
          copyFromRoleKey: 'system.engine.deployer',
          fingerprint: expect.any(String),
          permissions: expect.arrayContaining(['engine:deploy']),
        },
      },
    });

    const cycle = configBundlePreviewService.preview({
      bundle: templateBundle,
      files: {
        './roles.json': {
          roles: [
            { key: 'custom.engine.alpha', name: 'Alpha', scope: 'engine', copyFromRoleKey: 'custom.engine.beta', addPermissions: ['engine:deploy'], removePermissions: [] },
            { key: 'custom.engine.beta', name: 'Beta', scope: 'engine', copyFromRoleKey: 'custom.engine.alpha', addPermissions: ['engine:deploy'], removePermissions: [] },
          ],
        },
      },
    });

    expect(cycle).toMatchObject({ valid: false });
    expect(cycle.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('Role template cycle detected') }),
    ]));
  });

  it('binds copied-role preview hashes to the current system-role baseline', () => {
    const input = {
      bundle: { ...bundle, imports: ['./roles.json'] },
      files: { './roles.json': { roles: [{
        key: 'custom.engine.deployer-plus', name: 'Deployer Plus', scope: 'engine',
        copyFromRoleKey: 'system.engine.deployer', addPermissions: ['engine:process:start'], removePermissions: [],
      }] } },
    };
    const systemRole = SystemRoleDefinitions.find((role) => role.key === 'system.engine.deployer')!;
    const originalPermissions = [...systemRole.permissions];
    const first = configBundlePreviewService.preview(input);
    try {
      systemRole.permissions = [...originalPermissions, 'engine:variables:edit'];
      const changed = configBundlePreviewService.preview(input);
      expect(changed.canonicalHash).not.toBe(first.canonicalHash);
      expect(changed.roleTemplateBaselines?.['custom.engine.deployer-plus'].fingerprint)
        .not.toBe(first.roleTemplateBaselines?.['custom.engine.deployer-plus'].fingerprint);
    } finally {
      systemRole.permissions = originalPermissions;
    }
  });
});
