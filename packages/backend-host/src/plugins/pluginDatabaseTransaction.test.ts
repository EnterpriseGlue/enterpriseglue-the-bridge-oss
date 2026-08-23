import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { runPluginTransactionV1 } from './pluginDatabaseTransaction.js';

describe('plugin database transactions', () => {
  it('retries explicit Spanner ABORTED failures', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ driverError: { code: 10 } })
      .mockRejectedValueOnce({ cause: { code: 'ABORTED' } })
      .mockResolvedValueOnce('committed');
    const source = {
      options: { type: 'spanner' },
      transaction,
    } as unknown as DataSource;

    await expect(
      runPluginTransactionV1(
        source,
        vi.fn() as unknown as (manager: EntityManager) => Promise<string>,
      ),
    ).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-abort Spanner failure', async () => {
    const failure = { driverError: { code: 6 } };
    const transaction = vi.fn().mockRejectedValue(failure);
    const source = {
      options: { type: 'spanner' },
      transaction,
    } as unknown as DataSource;

    await expect(
      runPluginTransactionV1(
        source,
        vi.fn() as unknown as (manager: EntityManager) => Promise<string>,
      ),
    ).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it.each(['mysql', 'mariadb'] as const)(
    'uses READ COMMITTED for %s lock-then-read transactions',
    async (type) => {
      const transaction = vi.fn().mockResolvedValue('committed');
      const work = vi.fn() as unknown as (
        manager: EntityManager,
      ) => Promise<string>;
      const source = {
        options: { type },
        transaction,
      } as unknown as DataSource;

      await expect(runPluginTransactionV1(source, work)).resolves.toBe(
        'committed',
      );
      expect(transaction).toHaveBeenCalledWith(
        'READ COMMITTED',
        work,
      );
    },
  );

  it.each(['mysql', 'mariadb'] as const)(
    'retries explicit %s InnoDB deadlock victims',
    async (type) => {
      const transaction = vi
        .fn()
        .mockRejectedValueOnce({
          driverError: {
            code: 'ER_LOCK_DEADLOCK',
            errno: 1213,
            sqlState: '40001',
          },
        })
        .mockRejectedValueOnce({
          cause: { errno: '1213' },
        })
        .mockResolvedValueOnce('committed');
      const work = vi.fn() as unknown as (
        manager: EntityManager,
      ) => Promise<string>;
      const source = {
        options: { type },
        transaction,
      } as unknown as DataSource;

      await expect(runPluginTransactionV1(source, work)).resolves.toBe(
        'committed',
      );
      expect(transaction).toHaveBeenCalledTimes(3);
      expect(transaction).toHaveBeenNthCalledWith(
        1,
        'READ COMMITTED',
        work,
      );
      expect(transaction).toHaveBeenNthCalledWith(
        3,
        'READ COMMITTED',
        work,
      );
    },
  );

  it('does not retry a non-deadlock MySQL failure', async () => {
    const failure = {
      driverError: {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
        sqlState: '23000',
      },
    };
    const transaction = vi.fn().mockRejectedValue(failure);
    const source = {
      options: { type: 'mysql' },
      transaction,
    } as unknown as DataSource;

    await expect(
      runPluginTransactionV1(
        source,
        vi.fn() as unknown as (
          manager: EntityManager,
        ) => Promise<string>,
      ),
    ).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('retries only explicit Oracle deadlock victims', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({
        driverError: {
          code: 'ORA-00060',
          errorNum: 60,
        },
      })
      .mockRejectedValueOnce({
        cause: { errorNum: '60' },
      })
      .mockResolvedValueOnce('committed');
    const work = vi.fn() as unknown as (
      manager: EntityManager,
    ) => Promise<string>;
    const source = {
      options: { type: 'oracle' },
      transaction,
    } as unknown as DataSource;

    await expect(runPluginTransactionV1(source, work)).resolves.toBe(
      'committed',
    );
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(transaction).toHaveBeenNthCalledWith(1, work);
    expect(transaction).toHaveBeenNthCalledWith(3, work);
  });

  it('does not retry a non-deadlock Oracle failure', async () => {
    const failure = {
      driverError: {
        code: 'ORA-00001',
        errorNum: 1,
      },
    };
    const transaction = vi.fn().mockRejectedValue(failure);
    const source = {
      options: { type: 'oracle' },
      transaction,
    } as unknown as DataSource;

    await expect(
      runPluginTransactionV1(
        source,
        vi.fn() as unknown as (
          manager: EntityManager,
        ) => Promise<string>,
      ),
    ).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('keeps the driver default isolation for PostgreSQL', async () => {
    const transaction = vi.fn().mockResolvedValue('committed');
    const work = vi.fn() as unknown as (
      manager: EntityManager,
    ) => Promise<string>;
    const source = {
      options: { type: 'postgres' },
      transaction,
    } as unknown as DataSource;

    await expect(runPluginTransactionV1(source, work)).resolves.toBe(
      'committed',
    );
    expect(transaction).toHaveBeenCalledWith(work);
  });
});
