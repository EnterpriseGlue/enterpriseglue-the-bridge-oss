import { describe, expect, it } from 'vitest';
import {
  __enterpriseBackendPluginTestUtils,
  loadEnterpriseBackendPlugin,
} from '../../../packages/backend-host/src/enterprise/loadEnterpriseBackendPlugin.js';

describe('loadEnterpriseBackendPlugin validation helpers', () => {
  it('detects missing module errors by code', () => {
    expect(
      __enterpriseBackendPluginTestUtils.isMissingEnterprisePlugin({
        code: 'ERR_MODULE_NOT_FOUND',
      })
    ).toBe(true);
  });

  it('detects missing module errors by message', () => {
    expect(
      __enterpriseBackendPluginTestUtils.isMissingEnterprisePlugin({
        message: 'Cannot find module @enterpriseglue/enterprise-backend',
      })
    ).toBe(true);
  });

  it('rejects invalid plugin hook shapes', () => {
    expect(() => {
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        registerRoutes: 'not-a-function',
      });
    }).toThrow('registerRoutes');
  });

  it('accepts valid optional hooks', () => {
    expect(() => {
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        registerRoutes: async () => undefined,
        migrateEnterpriseDatabase: async () => undefined,
      });
    }).not.toThrow();
  });

  it('returns noop plugin when enterprise package is unavailable (OSS mode)', async () => {
    const plugin = await loadEnterpriseBackendPlugin();

    expect(plugin.registerRoutes).toBeUndefined();
    expect(plugin.migrateEnterpriseDatabase).toBeUndefined();
  });
});
