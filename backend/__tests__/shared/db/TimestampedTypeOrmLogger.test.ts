import { afterEach, describe, expect, it, vi } from 'vitest';

describe('TypeORM logging policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    { mode: undefined, actions: ['db_query_error'] },
    { mode: 'off', actions: [] },
    { mode: 'error', actions: ['db_query_error'] },
    { mode: 'slow', actions: ['db_query_error', 'db_query_slow'] },
    { mode: 'all', actions: ['db_query', 'db_query_error'] },
  ])('applies $mode to callbacks independently of the application logger', async ({ mode, actions }) => {
    const output: string[] = [];
    for (const method of ['log', 'error', 'warn'] as const) {
      vi.spyOn(console, method).mockImplementation((line) => { output.push(line); });
    }
    vi.stubEnv('EG_DB_LOGGING', mode);
    vi.stubEnv('EG_DB_SLOW_QUERY_MS', '20');
    vi.stubEnv('EG_LOG_FORMAT', 'json');
    vi.stubEnv('EG_LOG_LEVEL', 'info');
    vi.stubEnv('EG_LOGGER_LEVELS', '');
    const { logger } = await import('@enterpriseglue/shared/utils/logger.js');
    const { TimestampedTypeOrmLogger, getTypeOrmLoggingOptions } = await import('@enterpriseglue/shared/db/TimestampedTypeOrmLogger.js');
    const db = new TimestampedTypeOrmLogger();
    const query = "SELECT 'embedded-value', $1";
    db.logQuery(query, ['bound-value']);
    db.logQueryError(new Error('driver-private-message'), query, ['bound-value']);
    db.logQuerySlow(20, query, ['bound-value']);
    db.logQuerySlow(21, query, ['bound-value']);
    logger.info('Unrelated application event');

    const lines = output.map((line) => JSON.parse(line));
    expect(lines.filter((line) => line.log.logger === 'db').map((line) => line.event.action)).toEqual(actions);
    expect(lines[lines.length - 1]).toMatchObject({ log: { logger: 'app' }, message: 'Unrelated application event' });
    expect(getTypeOrmLoggingOptions().maxQueryExecutionTime).toBe(mode === 'slow' ? 20 : undefined);
    expect(output.join('\n')).not.toMatch(/embedded-value|bound-value|driver-private-message/);
    if (mode === 'slow') {
      expect(lines[1]).toMatchObject({ event: { duration: 21_000_000 }, db: { operation: 'SELECT', parameter_count: 1 } });
    }
  });
});
