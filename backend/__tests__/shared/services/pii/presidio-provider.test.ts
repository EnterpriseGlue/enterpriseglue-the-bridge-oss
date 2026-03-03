import { describe, it, expect, vi, type Mock } from 'vitest';
import { PresidioProvider } from '@enterpriseglue/shared/services/pii/providers/presidio-provider.js';
import { postJson } from '@enterpriseglue/shared/services/pii/http.js';

vi.mock('@enterpriseglue/shared/services/pii/http.js', () => ({
  buildAuthHeaders: vi.fn().mockReturnValue({ 'Content-Type': 'application/json' }),
  postJson: vi.fn(),
}));

describe('PresidioProvider', () => {
  it('returns empty detections when endpoint is not set', async () => {
    const provider = new PresidioProvider();

    const detections = await provider.analyze('email john@example.com', {});

    expect(detections).toEqual([]);
    expect(postJson).not.toHaveBeenCalled();
  });

  it('maps Presidio analyze response into internal detections', async () => {
    const provider = new PresidioProvider();
    (postJson as unknown as Mock).mockResolvedValue([
      { start: 6, end: 22, entity_type: 'EMAIL_ADDRESS', score: 0.91 },
      { start: 30, end: 42, type: 'PHONE_NUMBER', score: 0.88 },
    ]);

    const detections = await provider.analyze('email john@example.com phone +1-555-5555', {
      endpoint: 'https://presidio.local',
      authToken: 'secret',
    });

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(detections).toEqual([
      {
        start: 6,
        end: 22,
        type: 'EMAIL_ADDRESS',
        score: 0.91,
        source: 'external',
      },
      {
        start: 30,
        end: 42,
        type: 'PHONE_NUMBER',
        score: 0.88,
        source: 'external',
      },
    ]);
  });
});
