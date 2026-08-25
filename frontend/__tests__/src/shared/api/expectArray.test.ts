import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { expectArray } from '@src/shared/api/expectArray';

describe('expectArray', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('returns arrays unchanged without logging', () => {
    const input = [1, 2, 3];
    expect(expectArray<number>(input, 'GET /things')).toBe(input);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('treats an empty array as valid', () => {
    expect(expectArray([], 'GET /things')).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined]])(
    'coerces %s to an empty array silently (the ordinary "no data" case)',
    (value) => {
      expect(expectArray(value, 'GET /things')).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it('coerces a truthy non-array to an empty array and logs the context', () => {
    expect(expectArray('some string', 'GET /things')).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const message = String(consoleError.mock.calls[0][0]);
    expect(message).toContain('GET /things');
    expect(message).toContain('string');
  });

  it('surfaces an error-envelope message to hint at the cause', () => {
    expect(expectArray({ error: 'Unauthorized' }, 'GET /admin/users')).toEqual([]);
    const message = String(consoleError.mock.calls[0][0]);
    expect(message).toContain('GET /admin/users');
    expect(message).toContain('Unauthorized');
  });

  it('surfaces a nested error.message envelope', () => {
    expectArray({ error: { message: 'Token expired' } }, 'GET /admin/users');
    expect(String(consoleError.mock.calls[0][0])).toContain('Token expired');
  });

  it('describes the keys of an unexpected object payload', () => {
    expectArray({ items: [], total: 0 }, 'GET /things');
    const message = String(consoleError.mock.calls[0][0]);
    expect(message).toContain('items');
    expect(message).toContain('total');
  });

  it('logs once per bad payload without throwing', () => {
    expect(() => expectArray(42, 'GET /count')).not.toThrow();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
