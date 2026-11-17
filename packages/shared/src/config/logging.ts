const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

function option<T extends string>(name: string, input: string | undefined, values: readonly T[], fallback: T): T {
  const value = input?.trim().toLowerCase();
  if (!value) return fallback;
  const match = values.find((candidate) => candidate === value);
  if (!match) throw new Error(`Invalid ${name}: expected ${values.join(', ')}`);
  return match;
}

export function readLoggingConfig(env: NodeJS.ProcessEnv) {
  const categoryLevels = new Map<string, LogLevel>();
  if (env.EG_LOGGER_LEVELS?.trim()) {
    for (const entry of env.EG_LOGGER_LEVELS.split(',')) {
      const [category, level, extra] = entry.toLowerCase().split(':').map((part) => part.trim());
      if (!/^[a-z][a-z0-9-]*$/.test(category) || !level || extra !== undefined || categoryLevels.has(category)) {
        throw new Error('Invalid EG_LOGGER_LEVELS: expected unique category:level pairs');
      }
      categoryLevels.set(category, option('EG_LOGGER_LEVELS', level, LOG_LEVELS, 'debug'));
    }
  }

  const dbMode = option('EG_DB_LOGGING', env.EG_DB_LOGGING, ['off', 'error', 'slow', 'all'], 'error');
  const threshold = env.EG_DB_SLOW_QUERY_MS?.trim() || '1000';
  const slowQueryMs = Number(threshold);
  if (dbMode === 'slow' && (!/^\d+$/.test(threshold) || !Number.isSafeInteger(slowQueryMs) || slowQueryMs < 1)) {
    throw new Error('Invalid EG_DB_SLOW_QUERY_MS: expected a positive integer');
  }

  return {
    level: option('EG_LOG_LEVEL', env.EG_LOG_LEVEL, LOG_LEVELS, 'debug'),
    format: option('EG_LOG_FORMAT', env.EG_LOG_FORMAT, ['json', 'pretty'], 'pretty'),
    categoryLevels,
    dbMode,
    slowQueryMs: dbMode === 'slow' ? slowQueryMs : undefined,
  };
}

let loggingConfig: ReturnType<typeof readLoggingConfig> | undefined;

export function getLoggingConfig() {
  // The server's environment loader runs before datasource creation or logging.
  return loggingConfig ??= readLoggingConfig(process.env);
}
