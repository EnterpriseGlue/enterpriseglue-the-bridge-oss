import { describe, expect, it } from 'vitest';
import { resolveConfigEngineSetSelector } from '@enterpriseglue/shared/services/platform-admin/config-engine-set-selector.js';

describe('resolveConfigEngineSetSelector', () => {
  it('resolves staged config engine keys and fails closed for missing keys', () => {
    const engines = new Map([['engine.prod.payments', 'engine-1']]);
    expect(resolveConfigEngineSetSelector({ mode: 'engine_ids', engineKeys: ['engine.prod.payments'] }, engines))
      .toEqual({ mode: 'engine_ids', engineIds: ['engine-1'] });
    expect(() => resolveConfigEngineSetSelector({ mode: 'engine_ids', engineKeys: ['engine.missing'] }, engines))
      .toThrow('unresolved engine key');
  });
});
