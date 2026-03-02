import { describe, expect, it } from 'vitest';
import {
  __enterpriseBackendPluginTestUtils,
  loadEnterpriseBackendPlugin,
} from '../../src/enterprise/loadEnterpriseBackendPlugin.js';

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

  it('returns a valid plugin (noop in OSS, real in EE)', async () => {
    const plugin = await loadEnterpriseBackendPlugin();

    // In OSS mode the hooks are undefined (noop); in EE mode they are functions.
    // Both shapes are valid – assert no broken exports.
    if (plugin.registerRoutes !== undefined) {
      expect(typeof plugin.registerRoutes).toBe('function');
    }
    if (plugin.migrateEnterpriseDatabase !== undefined) {
      expect(typeof plugin.migrateEnterpriseDatabase).toBe('function');
    }
  });
});
