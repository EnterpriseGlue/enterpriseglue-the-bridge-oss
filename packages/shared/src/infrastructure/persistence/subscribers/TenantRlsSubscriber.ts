import { AsyncLocalStorage } from 'node:async_hooks';
import { EventSubscriber, type DataSource, type EntitySubscriberInterface, type QueryRunner } from 'typeorm';
import type { BeforeQueryEvent } from 'typeorm/subscriber/event/QueryEvent.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { getPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';

const execution = new AsyncLocalStorage<QueryRunner>();
const installed = new WeakSet<DataSource>();
const contextSql = "SELECT set_config('enterpriseglue.tenancy_mode', $1, false), set_config('enterpriseglue.tenant_id', $2, false), set_config('enterpriseglue.platform_capability', $3, false)";
const emptyContext = ['denied', '', '{}'];
const control = /^(?:START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT typeorm_\d+|RELEASE SAVEPOINT typeorm_\d+|ROLLBACK TO SAVEPOINT typeorm_\d+)$/i;
const transactionSetup = /^(?:START TRANSACTION|BEGIN|SET TRANSACTION ISOLATION LEVEL (?:READ UNCOMMITTED|READ COMMITTED|REPEATABLE READ|SERIALIZABLE))$/i;
const rollbackRecovery = /^(?:ROLLBACK|ROLLBACK TO SAVEPOINT typeorm_\d+)$/i;

/** TypeORM 0.3.31 broadcasts BeforeQuery outside its try/finally. Cleanup must
 * surround query(), rather than depend on AfterQuery ever being dispatched. */
export function installPostgresContextBoundary(source: DataSource): void {
  if (source.options.type !== 'postgres' || installed.has(source)) return;
  if (source.isInitialized) throw new Error('PostgreSQL context boundary must precede initialization');
  installed.add(source);
  const createRunner = source.createQueryRunner.bind(source);
  source.createQueryRunner = (...args) => {
    const runner = createRunner(...args);
    const query = runner.query.bind(runner) as (sql: string, parameters?: any[], structured?: boolean) => Promise<any>;
    const release = runner.release.bind(runner);
    const stream = runner.stream.bind(runner);
    let tail: Promise<void> = Promise.resolve();
    let failedTransaction = false;
    let transactionFailure: unknown;
    let dirty = false;
    let releasing = false;
    const discard = async (cause: unknown): Promise<void> => {
      if (runner.isReleased) return;
      const postgres = runner as QueryRunner & { releasePostgresConnection(error: Error): Promise<void> };
      if (typeof postgres.releasePostgresConnection !== 'function') throw new Error('PostgreSQL connection quarantine is unavailable');
      // pg.Pool release(error) evicts the physical client; ordinary release()
      // merely recycles it. Preserve the actual driver error where available.
      await postgres.releasePostgresConnection(cause instanceof Error ? cause : new Error('Database context quarantine'));
    };
    runner.query = async (sql: string, parameters?: any[], structured?: boolean): Promise<any> => {
      if (execution.getStore() === runner) throw new Error('Reentrant PostgreSQL query cannot bypass the context boundary');
      if (releasing || runner.isReleased) throw new Error('Database connection is released');
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise<void>((resolve) => { unlock = resolve; });
      await previous;
      try {
        if (runner.isReleased) throw new Error('Database connection was quarantined');
        return await execution.run(runner, async () => {
          const isSetup = transactionSetup.test(sql.trim());
          const isControl = isSetup || control.test(sql.trim());
          if (isControl && !runner.isTransactionActive) throw new Error('Transaction control requires the TypeORM transaction API');
          if (failedTransaction && !rollbackRecovery.test(sql.trim())) {
            // PostgreSQL accepts COMMIT in an aborted transaction as ROLLBACK;
            // TypeORM does not inspect that command tag. Never report success
            // when application code caught its final SQL/audit error.
            if (isControl && transactionFailure !== undefined) throw transactionFailure;
            throw Object.assign(new Error('Failed transaction requires rollback'), {cause:transactionFailure});
          }
          try {
            if (!isControl) {
              dirty = true;
              await query(contextSql, [config.tenancyMode === 'single' ? 'single' : 'pooled',
                getTenantDatabaseContext()?.tenantId || '', JSON.stringify(getPlatformDatabaseCapability() || {})]);
            }
            const result = await query(sql, parameters, structured);
            failedTransaction = false;
            transactionFailure = undefined;
            return result;
          } catch (error) {
            if (runner.isTransactionActive) {
              if (!failedTransaction) transactionFailure = error;
              failedTransaction = true;
            }
            throw error;
          } finally {
            // An injected SELECT between BEGIN and SET TRANSACTION would make
            // PostgreSQL reject TypeORM's requested isolation level.
            if (!isSetup && !failedTransaction && !runner.isReleased) {
              try {
                await query(contextSql, emptyContext);
                dirty = false;
              } catch (error) {
                await discard(error);
                throw Object.assign(new Error('Database security context cleanup failed'), { cause: error });
              }
            }
          }
        });
      } finally {
        unlock();
      }
    };
    runner.release = async () => {
      releasing = true;
      await tail;
      if (runner.isReleased) return;
      if (dirty || failedTransaction || runner.isTransactionActive) return discard(new Error('Database connection released with an unfinished transaction'));
      await release();
    };
    runner.stream = async (...streamArgs) => {
      if (config.tenancyMode !== 'single') return Promise.reject(new Error('Pooled PostgreSQL streaming is not supported'));
      if (execution.getStore() === runner || releasing || runner.isReleased) throw new Error('Database connection is unavailable for streaming');
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise<void>((resolve) => { unlock = resolve; });
      await previous;
      let finished = false;
      const finish = async (error?: unknown) => {
        if (finished) return;
        finished = true;
        try {
          if (error) await discard(error);
          else await execution.run(runner, async () => {
            try { await query(contextSql, emptyContext); dirty = false; }
            catch (cleanupError) { await discard(cleanupError); }
          });
        } finally { unlock(); }
      };
      try {
        if (runner.isReleased || failedTransaction) throw new Error('Database connection is unavailable for streaming');
        const result = await execution.run(runner, async () => {
          dirty = true;
          await query(contextSql, ['single', '', '{}']);
          return stream(...streamArgs);
        });
        // Hold the runner gate until all rows are consumed or the cursor closes.
        // Releasing concurrently waits for cleanup, never recycles an open cursor.
        result.once('end', () => { void finish(); });
        result.once('close', () => { void finish(); });
        result.once('error', (error: Error) => { void finish(error); });
        return result;
      } catch (error) { await finish(error); throw error; }
    };
    return runner;
  };
}

export function assertPostgresContextBoundary(source: DataSource): void {
  if (source.options.type !== 'postgres') return;
  if (!installed.has(source) || source.subscribers.filter((subscriber) => subscriber instanceof TenantRlsSubscriber).length !== 1) {
    throw new Error('PostgreSQL security context subscriber is not registered');
  }
}

@EventSubscriber()
export class TenantRlsSubscriber implements EntitySubscriberInterface {
  beforeQuery(event: BeforeQueryEvent<unknown>): void {
    if (event.connection.options.type === 'postgres' && execution.getStore() !== event.queryRunner) {
      throw new Error('PostgreSQL query is outside the security context boundary');
    }
  }
}
