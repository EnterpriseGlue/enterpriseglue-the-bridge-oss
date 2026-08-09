import { beforeEach, describe, expect, it, vi } from 'vitest';

const dotenvConfig = vi.hoisted(() => vi.fn());

vi.mock('dotenv', () => ({
  default: { config: dotenvConfig },
  config: dotenvConfig,
}));

describe('hermetic test configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    dotenvConfig.mockClear();
    process.env.NODE_ENV = 'test';
    process.env.EG_LOAD_ENV_IN_TESTS = 'false';
  });

  it('does not read developer environment files in the unit-test lane', async () => {
    await import('@enterpriseglue/shared/config/index.js');
    expect(dotenvConfig).not.toHaveBeenCalled();
  });

  it('allows an explicit protocol-rehearsal opt-in', async () => {
    process.env.EG_LOAD_ENV_IN_TESTS = 'true';
    await import('@enterpriseglue/shared/config/index.js');
    expect(dotenvConfig).toHaveBeenCalledTimes(1);
  });
});
