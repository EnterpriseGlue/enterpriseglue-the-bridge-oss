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
