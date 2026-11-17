import type { DataSourceOptions, Logger as TypeOrmLogger, QueryRunner } from 'typeorm';
import { getLoggingConfig } from '../config/logging.js';
import { createLogger } from '../utils/structuredLogger.js';

const logger = createLogger('db');
const SQL_OPERATIONS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH', 'CREATE', 'ALTER',
  'DROP', 'TRUNCATE', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'SET',
]);

function dbFields(query: string, parameters?: unknown[]) {
  // Only emit a fixed verb. SQL and driver errors can contain literal values.
  const verb = /^\s*([a-z]+)\b/i.exec(query)?.[1].toUpperCase() ?? '';
  return {
    operation: SQL_OPERATIONS.has(verb) ? verb : 'OTHER',
    parameter_count: parameters?.length ?? 0,
  };
}

export class TimestampedTypeOrmLogger implements TypeOrmLogger {
  logQuery(query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (getLoggingConfig().dbMode !== 'all') return;
    logger.event('info', 'Executing database query', {
      event: { action: 'db_query' },
      db: dbFields(query, parameters),
    });
  }

  logQueryError(_error: string | Error, query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (getLoggingConfig().dbMode === 'off') return;
    logger.event('error', 'Database query failed', {
      event: { action: 'db_query_error', outcome: 'failure' },
      db: dbFields(query, parameters),
    });
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    const { slowQueryMs } = getLoggingConfig();
    if (slowQueryMs === undefined || time <= slowQueryMs) return;
    logger.event('warn', 'Slow database query', {
      event: { action: 'db_query_slow', duration: time * 1_000_000 },
      db: dbFields(query, parameters),
    });
  }

  logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    logger.info(`schema build: ${message}`);
  }

  logMigration(message: string, _queryRunner?: QueryRunner): void {
    logger.info(`migration: ${message}`);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown, _queryRunner?: QueryRunner): void {
    logger[level === 'warn' ? 'warn' : 'info'](message);
  }
}

export function getTypeOrmLoggingOptions(): Pick<DataSourceOptions, 'logger' | 'logging' | 'maxQueryExecutionTime'> {
  return {
    logger: new TimestampedTypeOrmLogger(),
    logging: false, // TypeORM delegates to the custom logger, which enforces policy itself.
    maxQueryExecutionTime: getLoggingConfig().slowQueryMs,
  };
}
