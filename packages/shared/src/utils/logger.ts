/**
 * Simple logger utility
 * Wraps console methods for future extensibility (e.g., Winston, Pino)
 */
function sanitizeLogArg(val: unknown): string {
  let str: string;

  if (typeof val === 'string') {
    str = val;
  } else {
    try {
      str = JSON.stringify(val);
    } catch {
      str = String(val);
    }
  }

  return str
    .replace(/[\r\n]/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function getTimestamp(): string {
  return new Date().toISOString()
}

function writeToConsole(method: 'log' | 'warn' | 'error' | 'debug', args: unknown[]): void {
  console[method](`[${getTimestamp()}]`, ...args.map(sanitizeLogArg))
}

export const logger = {
  info: (...args: any[]) => writeToConsole('log', args), // lgtm[js/log-injection]
  warn: (...args: any[]) => writeToConsole('warn', args), // lgtm[js/log-injection]
  error: (...args: any[]) => writeToConsole('error', args), // lgtm[js/log-injection]
  debug: (...args: any[]) => writeToConsole('debug', args),
};
