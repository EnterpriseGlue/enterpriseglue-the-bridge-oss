import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

describe('logger', () => {
  let infoSpy: any;
  let warnSpy: any;
  let errorSpy: any;
  let debugSpy: any;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });

  function expectTimestampPrefix(value: unknown) {
    expect(value).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]$/);
  }

  it('calls console.log for info', () => {
    logger.info('test info');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [timestamp, message] = infoSpy.mock.calls[0];
    expectTimestampPrefix(timestamp);
    expect(message).toBe('test info');
  });

  it('calls console.warn for warn', () => {
    logger.warn('test warn');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [timestamp, message] = warnSpy.mock.calls[0];
    expectTimestampPrefix(timestamp);
    expect(message).toBe('test warn');
  });

  it('calls console.error for error', () => {
    logger.error('test error');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [timestamp, message] = errorSpy.mock.calls[0];
    expectTimestampPrefix(timestamp);
    expect(message).toBe('test error');
  });

  it('calls console.debug for debug', () => {
    logger.debug('test debug');
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const [timestamp, message] = debugSpy.mock.calls[0];
    expectTimestampPrefix(timestamp);
    expect(message).toBe('test debug');
  });
});

describe('logging configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('uses the global level unless a category overrides it', async () => {
    vi.resetModules();
    vi.stubEnv('EG_LOG_LEVEL', 'warn');
    vi.stubEnv('EG_LOGGER_LEVELS', 'db:error, config-bundle:trace');
    vi.stubEnv('EG_LOG_FORMAT', 'json');

    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { logger } = await import('@enterpriseglue/shared/utils/logger.js');
    const { createLogger } = await import('@enterpriseglue/shared/utils/structuredLogger.js');
    const db = createLogger('db');
    const bundle = createLogger('config-bundle');

    logger.info('suppressed global info');
    logger.warn('global warning');
    db.warn('suppressed database warning');
    db.error('database error');
    bundle.trace('bundle trace');
    bundle.info('control\ncharacter\u2028handling', undefined, 1n);

    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.parse(String(warning.mock.calls[0][0]))).toMatchObject({ log: { level: 'warn', logger: 'app' } });
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ log: { level: 'error', logger: 'db' } });
    expect(JSON.parse(String(debug.mock.calls[0][0]))).toMatchObject({ log: { level: 'trace', logger: 'config-bundle' } });
    expect(info).toHaveBeenCalledOnce();
    const line = String(info.mock.calls[0][0]);
    expect(line).not.toMatch(/[\n\u2028]/u);
    expect(JSON.parse(line)).toMatchObject({
      '@timestamp': expect.any(String),
      message: 'control character handling undefined [unserializable]',
      service: { name: 'enterpriseglue-backend' },
    });
  });

  it('validates consumed settings without echoing raw values', async () => {
    const { readLoggingConfig } = await import('@enterpriseglue/shared/config/logging.js');
    expect(readLoggingConfig({ NODE_ENV: 'production' })).toMatchObject({ level: 'debug', format: 'pretty', dbMode: 'error' });
    expect(readLoggingConfig({ EG_DB_LOGGING: 'slow' }).slowQueryMs).toBe(1000);
    expect(() => readLoggingConfig({ EG_LOG_FORMAT: 'unsafe-value' })).toThrow('Invalid EG_LOG_FORMAT: expected json, pretty');
    expect(() => readLoggingConfig({ EG_LOGGER_LEVELS: 'db:warn,DB:error' })).toThrow('Invalid EG_LOGGER_LEVELS');
    expect(() => readLoggingConfig({ EG_DB_LOGGING: 'slow', EG_DB_SLOW_QUERY_MS: '0' })).toThrow('Invalid EG_DB_SLOW_QUERY_MS');
  });
});
