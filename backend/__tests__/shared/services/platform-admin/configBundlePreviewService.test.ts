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
});
