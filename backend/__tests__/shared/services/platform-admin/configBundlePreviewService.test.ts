import { describe, expect, it } from 'vitest';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';

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
            principal: { type: 'group', key: 'group.missing' },
            roleKey: 'custom.engine.operator',
            scope: { type: 'engine', engineKey: 'engine.missing' },
          }],
        },
      },
    });

    expect(result).toMatchObject({ valid: false });
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: './assignments.json.assignments.0.principal.key', message: 'Unknown group key: group.missing' }),
      expect.objectContaining({ path: './assignments.json.assignments.0.scope.engineKey', message: 'Unknown engine key: engine.missing' }),
    ]));
  });
});
