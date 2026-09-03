import { describe, expect, it } from 'vitest';
import { shouldRetryEngineHealthRequest } from '@src/features/mission-control/engines/engineHealthQueryPolicy';

describe('engine health query retry policy', () => {
  it('does not amplify deterministic API validation failures', () => {
    expect(shouldRetryEngineHealthRequest(0, { response: { status: 400 } })).toBe(false);
    expect(shouldRetryEngineHealthRequest(0, { response: { status: 422 } })).toBe(false);
  });

  it('allows one bounded retry for dependency or network failures', () => {
    expect(shouldRetryEngineHealthRequest(0, { response: { status: 503 } })).toBe(true);
    expect(shouldRetryEngineHealthRequest(1, { response: { status: 503 } })).toBe(false);
    expect(shouldRetryEngineHealthRequest(0, new Error('network unavailable'))).toBe(true);
  });
});
