import { describe, it, expect } from 'vitest';
import { RegexProvider } from '../../../../src/shared/services/pii/providers/regex-provider.js';
import type { PiiDetection } from '../../../../src/shared/services/pii/types.js';

describe('RegexProvider', () => {
  it('detects common PII patterns', async () => {
    const provider = new RegexProvider();
    const text = 'Contact john.doe@example.com, SSN 123-45-6789';

    const detections = await provider.analyze(text);

    expect(detections.length).toBeGreaterThan(0);
    expect(detections.some((d: PiiDetection) => d.type === 'EMAIL')).toBe(true);
    expect(detections.some((d: PiiDetection) => d.type === 'SSN')).toBe(true);
    expect(detections.every((d: PiiDetection) => d.source === 'regex')).toBe(true);
  });

  it('anonymizes text with default type placeholders', async () => {
    const provider = new RegexProvider();
    const text = 'Email me at john.doe@example.com';

    const detections = await provider.analyze(text);
    const result = await provider.anonymize(text, detections);

    expect(result.redactions.length).toBeGreaterThan(0);
    expect(result.text).toContain('EMAIL');
    expect(result.text).not.toContain('john.doe@example.com');
  });
});
