import { describe, expect, it } from 'vitest';

import {
  PluginFrontendFailureCircuitV1,
  __pluginFrontendFailureCircuitTestUtils,
  type PluginFrontendFailureStorageV1,
} from './frontendFailureCircuit';

class MemoryStorage implements PluginFrontendFailureStorageV1 {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const target = {
  pluginId: 'io.enterpriseglue.reference' as const,
  version: '1.0.0',
  bootstrapRevision: 7,
};

describe('PluginFrontendFailureCircuitV1', () => {
  it('quarantines only the exact failing source after a bounded threshold', () => {
    const storage = new MemoryStorage();
    let now = 1_000_000;
    const first = new PluginFrontendFailureCircuitV1({
      storage,
      now: () => now,
      threshold: 3,
      failureWindowMs: 60_000,
      quarantineMs: 120_000,
    });

    expect(first.recordFailure(target, 'module_invalid')).toEqual({
      count: 1,
      quarantined: false,
    });
    now += 1_000;
    expect(first.recordFailure(target, 'activation_failed')).toEqual({
      count: 2,
      quarantined: false,
    });
    now += 1_000;
    expect(first.recordFailure(target, 'activation_failed')).toEqual({
      count: 3,
      quarantined: true,
    });

    const afterReload = new PluginFrontendFailureCircuitV1({
      storage,
      now: () => now,
      threshold: 3,
      failureWindowMs: 60_000,
      quarantineMs: 120_000,
    });
    expect(afterReload.isQuarantined(target)).toBe(true);
    expect(
      afterReload.isQuarantined({
        ...target,
        bootstrapRevision: 8,
      }),
    ).toBe(false);
    expect(
      afterReload.isQuarantined({
        ...target,
        version: '1.0.1',
      }),
    ).toBe(false);

    now += 120_000;
    expect(afterReload.isQuarantined(target)).toBe(false);
  });

  it('resets an expired failure window and clears state after success', () => {
    const storage = new MemoryStorage();
    let now = 2_000_000;
    const circuit = new PluginFrontendFailureCircuitV1({
      storage,
      now: () => now,
      threshold: 2,
      failureWindowMs: 10_000,
      quarantineMs: 20_000,
    });

    circuit.recordFailure(target, 'activation_failed');
    now += 10_001;
    expect(circuit.recordFailure(target, 'activation_failed')).toEqual({
      count: 1,
      quarantined: false,
    });
    circuit.clear(target);
    expect(circuit.isQuarantined(target)).toBe(false);
    expect(
      storage.values.get(
        __pluginFrontendFailureCircuitTestUtils.storageKey,
      ),
    ).toBe('{"schemaVersion":1,"entries":[]}');
  });

  it('fails safely on malformed or unavailable browser storage', () => {
    const malformed = new MemoryStorage();
    malformed.values.set(
      __pluginFrontendFailureCircuitTestUtils.storageKey,
      '{"schemaVersion":1,"entries":[{"pluginId":"../../bad"}]}',
    );
    const circuit = new PluginFrontendFailureCircuitV1({
      storage: malformed,
      now: () => 3_000_000,
      threshold: 2,
    });

    expect(circuit.isQuarantined(target)).toBe(false);
    expect(circuit.recordFailure(target, 'module_invalid')).toEqual({
      count: 1,
      quarantined: false,
    });

    const unavailable: PluginFrontendFailureStorageV1 = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    const memoryFallback = new PluginFrontendFailureCircuitV1({
      storage: unavailable,
      now: () => 3_000_000,
      threshold: 2,
    });
    memoryFallback.recordFailure(target, 'activation_failed');
    expect(
      memoryFallback.recordFailure(target, 'activation_failed'),
    ).toEqual({ count: 2, quarantined: true });
    expect(memoryFallback.isQuarantined(target)).toBe(true);
  });
});
