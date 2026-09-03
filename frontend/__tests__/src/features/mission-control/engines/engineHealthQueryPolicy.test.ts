import { describe, expect, it } from 'vitest';
import {
  getEngineHealthRefetchInterval,
  shouldRetryEngineHealthRequest,
} from '@src/features/mission-control/engines/engineHealthQueryPolicy';

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

  it('stops automatic polling after deterministic client errors', () => {
    expect(getEngineHealthRefetchInterval({
      state: { status: 'error', error: { status: 400 }, fetchFailureCount: 1 },
    })).toBe(false);
  });

  it('polls healthy engines and backs off transient failures', () => {
    expect(getEngineHealthRefetchInterval({ state: { status: 'success' } })).toBe(30_000);
    expect(getEngineHealthRefetchInterval({
      state: { status: 'error', error: { status: 503 }, fetchFailureCount: 1 },
    })).toBe(30_000);
    expect(getEngineHealthRefetchInterval({
      state: { status: 'error', error: new Error('network unavailable'), fetchFailureCount: 4 },
    })).toBe(240_000);
    expect(getEngineHealthRefetchInterval({
      state: { status: 'error', error: new Error('still unavailable'), fetchFailureCount: 20 },
    })).toBe(300_000);
  });
});
