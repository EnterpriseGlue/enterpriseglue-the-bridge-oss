import { AsyncLocalStorage } from 'node:async_hooks';
import { getLoggingConfig, type LogLevel } from '../config/logging.js';

export type LogContext = { requestId?: string; traceId?: string };

const logContext = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  return logContext.run(context, callback);
}

type EventFields = {
  event: {
    action: string;
    outcome?: 'success' | 'failure' | 'unknown';
    code?: string;
    duration?: number;
  };
  [field: string]: unknown;
};

const PRIORITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const CONSOLE_METHOD = { error: 'error', warn: 'warn', info: 'log', debug: 'debug', trace: 'debug' } as const;

function sanitizeLogArg(value: unknown): string {
  let arg: string;
  try {
    arg = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  } catch {
    arg = '[unserializable]';
  }
  // Keep each record on one physical line in both formats.
  return arg.replace(/[\r\n\u0085\u2028\u2029]/gu, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
}

export function createLogger(category: string) {
  function write(level: LogLevel, args: unknown[], fields?: EventFields): void {
    const config = getLoggingConfig();
    const threshold = config.categoryLevels.get(category) ?? config.level;
    if (PRIORITY[level] > PRIORITY[threshold]) return;
    const timestamp = new Date().toISOString();
    const parts = args.map(sanitizeLogArg);
    const method = CONSOLE_METHOD[level];
    if (config.format === 'pretty') {
      if (fields) console[method](`[${timestamp}]`, `[${category}]`, ...parts, sanitizeLogArg(fields));
      else console[method](`[${timestamp}]`, ...parts);
      return;
    }

    const context = logContext.getStore();
    const line = JSON.stringify({
      ...fields,
      '@timestamp': timestamp,
      log: { level, logger: category },
      service: { name: 'enterpriseglue-backend' },
      message: parts.join(' '),
      request: context?.requestId ? { id: context.requestId } : undefined,
      trace: context?.traceId ? { id: context.traceId } : undefined,
    });
    console[method](line.replace(/[\u0085\u2028\u2029]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`));
  }

  return {
    error: (...args: unknown[]) => write('error', args),
    warn: (...args: unknown[]) => write('warn', args),
    info: (...args: unknown[]) => write('info', args),
    debug: (...args: unknown[]) => write('debug', args),
    trace: (...args: unknown[]) => write('trace', args),
    event: (level: LogLevel, message: string, fields: EventFields) => write(level, [message], fields),
  };
}
