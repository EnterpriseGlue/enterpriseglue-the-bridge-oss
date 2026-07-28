import type { DataSource, EntityManager } from 'typeorm';

const SPANNER_TRANSACTION_ATTEMPTS = 5;
const MYSQL_TRANSACTION_ATTEMPTS = 5;
const ORACLE_TRANSACTION_ATTEMPTS = 8;

/**
 * Spanner can abort a serializable read-write transaction under contention.
 * Its native clients normally retry a transaction callback, but TypeORM's
 * Spanner query runner exposes only a single attempt. Re-run the complete,
 * side-effect-free database callback on the explicit ABORTED status.
 *
 * MySQL and MariaDB default to REPEATABLE READ. Plugin mutations first take
 * a stable namespace/admission row lock and then count or reload dependent
 * rows. READ COMMITTED ensures a waiter observes the committed mutation that
 * preceded its lock acquisition instead of retaining a pre-lock snapshot.
 * InnoDB can also choose one transaction as a deadlock victim during valid
 * multi-replica claim/complete contention. It rolls that transaction back in
 * full, so retry only the explicit ER_LOCK_DEADLOCK/1213 signal.
 *
 * Oracle can report ORA-00060 while concurrent workers acquire the shared
 * namespace/subscription locks in different valid transactions. TypeORM rolls
 * back the failed transaction callback before this wrapper receives the
 * error. Retry only the structured ORA-00060/errorNum 60 signal.
 */
export async function runPluginTransactionV1<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const databaseType = dataSource.options.type;
  const maximumAttempts =
    databaseType === 'spanner'
      ? SPANNER_TRANSACTION_ATTEMPTS
      : databaseType === 'mysql' || databaseType === 'mariadb'
        ? MYSQL_TRANSACTION_ATTEMPTS
        : databaseType === 'oracle'
          ? ORACLE_TRANSACTION_ATTEMPTS
          : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await pluginTransactionAttempt(dataSource, work);
    } catch (error) {
      const retryable =
        (databaseType === 'spanner' && isSpannerAborted(error)) ||
        ((databaseType === 'mysql' || databaseType === 'mariadb') &&
          isMySqlDeadlock(error)) ||
        (databaseType === 'oracle' && isOracleDeadlock(error));
      if (
        !retryable ||
        attempt === maximumAttempts ||
        maximumAttempts === 1
      ) {
        throw error;
      }
      const delayMilliseconds =
        databaseType === 'oracle'
          ? Math.min(25 * 2 ** (attempt - 1), 500) +
            Math.floor(Math.random() * 25)
          : Math.min(5 * 2 ** (attempt - 1), 80);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMilliseconds);
      });
    }
  }
  throw new Error('plugin_database_transaction_retry_exhausted');
}

function pluginTransactionAttempt<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (
    dataSource.options.type === 'mysql' ||
    dataSource.options.type === 'mariadb'
  ) {
    return dataSource.transaction('READ COMMITTED', work);
  }
  return dataSource.transaction(work);
}

function isSpannerAborted(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (
      candidate === null ||
      (typeof candidate !== 'object' && typeof candidate !== 'function') ||
      seen.has(candidate)
    ) {
      continue;
    }
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    if (
      record.code === 10 ||
      record.code === '10' ||
      record.code === 'ABORTED'
    ) {
      return true;
    }
    queue.push(record.driverError, record.cause, record.originalError);
  }
  return false;
}

function isMySqlDeadlock(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (
      candidate === null ||
      (typeof candidate !== 'object' &&
        typeof candidate !== 'function') ||
      seen.has(candidate)
    ) {
      continue;
    }
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    if (
      record.code === 'ER_LOCK_DEADLOCK' ||
      record.errno === 1213 ||
      record.errno === '1213'
    ) {
      return true;
    }
    queue.push(record.driverError, record.cause, record.originalError);
  }
  return false;
}

function isOracleDeadlock(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (
      candidate === null ||
      (typeof candidate !== 'object' &&
        typeof candidate !== 'function') ||
      seen.has(candidate)
    ) {
      continue;
    }
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    if (
      record.code === 'ORA-00060' ||
      record.errorNum === 60 ||
      record.errorNum === '60'
    ) {
      return true;
    }
    queue.push(record.driverError, record.cause, record.originalError);
  }
  return false;
}
