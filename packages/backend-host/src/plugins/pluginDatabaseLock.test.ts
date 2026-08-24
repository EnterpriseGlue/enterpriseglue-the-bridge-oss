import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import {
  findPluginRowForUpdateV1,
  lockOraclePluginClaimCandidatesV1,
  oraclePluginClaimCandidateWindowV1,
} from './pluginDatabaseLock.js';

interface Candidate {
  id: string;
  status: 'pending' | 'delivering';
}

describe('Oracle plugin claim locking', () => {
  it('locks bounded chunks, skips contention, and rechecks eligibility', async () => {
    const getMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'candidate-a', status: 'pending' },
        { id: 'candidate-b', status: 'delivering' },
      ])
      .mockResolvedValueOnce([
        { id: 'candidate-c', status: 'pending' },
      ]);
    const chunks: string[][] = [];
    const builder = {
      where: vi.fn(
        (
          _predicate: string,
          parameters: { plugin_claim_ids: string[] },
        ) => {
          chunks.push(parameters.plugin_claim_ids);
          return builder;
        },
      ),
      setLock: vi.fn(() => builder),
      setOnLocked: vi.fn(() => builder),
      getMany,
    };
    const repository = {
      createQueryBuilder: vi.fn(() => builder),
    } as unknown as Repository<Candidate>;
    const candidates: Candidate[] = [
      { id: 'candidate-a', status: 'pending' },
      { id: 'candidate-b', status: 'pending' },
      { id: 'candidate-c', status: 'pending' },
      { id: 'candidate-d', status: 'pending' },
    ];

    const claimed = await lockOraclePluginClaimCandidatesV1(
      repository,
      candidates,
      2,
      (record) => record.status === 'pending',
    );

    expect(claimed.map((record) => record.id)).toEqual([
      'candidate-a',
      'candidate-c',
    ]);
    expect(chunks).toEqual([
      ['candidate-a', 'candidate-b'],
      ['candidate-c'],
    ]);
    expect(builder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(builder.setOnLocked).toHaveBeenCalledWith('skip_locked');
  });

  it('bounds the unlocked candidate window', () => {
    expect(oraclePluginClaimCandidateWindowV1(1)).toBe(4);
    expect(oraclePluginClaimCandidateWindowV1(100)).toBe(400);
    expect(() => oraclePluginClaimCandidateWindowV1(0)).toThrow(
      'plugin_oracle_claim_limit_invalid',
    );
  });
});

describe('Spanner plugin row locking', () => {
  it('uses the enclosing serializable transaction without a TypeORM lock clause', async () => {
    const builder = {
      setFindOptions: vi.fn(() => builder),
      setLock: vi.fn(() => builder),
      getMany: vi.fn(async () => [
        { id: 'state-1', status: 'pending' as const },
      ]),
    };
    const repository = {
      manager: {
        connection: {
          options: { type: 'spanner' },
        },
      },
      createQueryBuilder: vi.fn(() => builder),
    } as unknown as Repository<Candidate>;

    const record = await findPluginRowForUpdateV1(repository, {
      id: 'state-1',
    });

    expect(record?.id).toBe('state-1');
    expect(builder.setLock).not.toHaveBeenCalled();
  });
});

describe('SQLite plugin row locking', () => {
  it.each(['sqlite', 'better-sqlite3', 'sqljs'] as const)(
    'uses transaction serialization for %s without an unsupported lock clause',
    async (type) => {
      const builder = {
        setFindOptions: vi.fn(() => builder),
        setLock: vi.fn(() => builder),
        getMany: vi.fn(async () => [
          { id: 'state-1', status: 'pending' as const },
        ]),
      };
      const repository = {
        manager: { connection: { options: { type } } },
        createQueryBuilder: vi.fn(() => builder),
      } as unknown as Repository<Candidate>;

      const record = await findPluginRowForUpdateV1(repository, {
        id: 'state-1',
      });

      expect(record?.id).toBe('state-1');
      expect(builder.setLock).not.toHaveBeenCalled();
    },
  );
});
