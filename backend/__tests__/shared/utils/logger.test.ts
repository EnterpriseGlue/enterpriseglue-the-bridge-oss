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

  it('calls console.log for info', () => {
    logger.info('test info');
    expect(infoSpy).toHaveBeenCalledWith('test info');
  });

  it('calls console.warn for warn', () => {
    logger.warn('test warn');
    expect(warnSpy).toHaveBeenCalledWith('test warn');
  });

  it('calls console.error for error', () => {
    logger.error('test error');
    expect(errorSpy).toHaveBeenCalledWith('test error');
  });

  it('calls console.debug for debug', () => {
    logger.debug('test debug');
    expect(debugSpy).toHaveBeenCalledWith('test debug');
  });
});
