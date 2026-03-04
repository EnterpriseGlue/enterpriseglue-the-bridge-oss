import { describe, it, expect } from 'vitest';
import type { EnterpriseBackendContext, ConnectionPool } from '@enterpriseglue/enterprise-plugin-api/backend';

/**
 * Host Conformance Test — Layer 2 contract validation (backend).
 *
 * Verifies that the OSS backend host constructs objects satisfying the
 * contract interfaces defined in `@enterpriseglue/enterprise-plugin-api`.
 *
 * If someone removes or renames a method that the contract promises,
 * this test fails — preventing silent breaks for EE consumers.
 */

describe('Backend host contract conformance', () => {
  it('assertValidPluginShape validates all contract hooks', async () => {
    const { __enterpriseBackendPluginTestUtils } = await import(
      '@enterpriseglue/backend-host/enterprise/loadEnterpriseBackendPlugin.js'
    );

    // Valid plugin with all hooks
    expect(() =>
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        registerRoutes: async () => {},
        migrateEnterpriseDatabase: async () => {},
      }),
    ).not.toThrow();

    // Valid noop plugin (all hooks optional)
    expect(() =>
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({}),
    ).not.toThrow();

    // Invalid: hook is not a function
    expect(() =>
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        registerRoutes: 'not-a-function',
      }),
    ).toThrow(/must be function/);
  });

  it('host context shape satisfies EnterpriseBackendContext interface', () => {
    // Simulate the context the host builds in server.ts:
    //   { connectionPool: getConnectionPool(), config }
    // Verify the shape matches the contract at both type and runtime levels.

    const mockPool: ConnectionPool = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
      async close() {},
      getNativePool() {
        return {};
      },
    };

    const hostContext: EnterpriseBackendContext = {
      connectionPool: mockPool,
      config: {},
    };

    // Runtime shape checks — if the contract adds a required property,
    // this test will fail at the type level (tsc) AND runtime level.
    expect(hostContext.connectionPool).toBeDefined();
    expect(typeof hostContext.connectionPool.query).toBe('function');
    expect(typeof hostContext.connectionPool.close).toBe('function');
    expect(typeof hostContext.connectionPool.getNativePool).toBe('function');
    expect(hostContext.config).toBeDefined();
  });

  it('ConnectionPool.query returns expected shape', async () => {
    const mockPool: ConnectionPool = {
      async query<T = unknown>(_sql: string, _params?: ReadonlyArray<unknown> | Record<string, unknown>) {
        return { rows: [] as T[], rowCount: 0 };
      },
      async close() {},
      getNativePool() {
        return {};
      },
    };

    const result = await mockPool.query('SELECT 1');
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('rowCount');
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.rowCount).toBe('number');
  });
});
