import { describe, expect, it } from 'vitest';

import { rawQueryPatternLabels } from '../scripts/raw-sql-guard-policy.js';

describe('raw SQL guard receiver aliases', () => {
  it.each(['runner', 'transport', 'renamedReceiver', 'getConnectionPool()'])(
    'rejects raw query calls through %s outside governed infrastructure',
    (receiver) => {
      expect(rawQueryPatternLabels(`${receiver}.query('SELECT 1')`)).toEqual(['*.query(']);
    },
  );

  it('does not flag repository query-builder APIs', () => {
    expect(rawQueryPatternLabels('repository.createQueryBuilder()')).toEqual([]);
  });
});
