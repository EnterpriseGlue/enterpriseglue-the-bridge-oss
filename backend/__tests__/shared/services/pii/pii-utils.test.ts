import { describe, it, expect } from 'vitest';
import { buildRedactions, applyRedactions, mergeDetections } from '@enterpriseglue/shared/services/pii/utils.js';
import type { PiiDetection } from '@enterpriseglue/shared/services/pii/types.js';

describe('buildRedactions', () => {
  it('replaces <TYPE> placeholder with detection type', () => {
    const detections: PiiDetection[] = [{ start: 0, end: 5, type: 'EMAIL', source: 'regex' }];
    const redactions = buildRedactions(detections, '<TYPE>');
    expect(redactions[0].replacement).toBe('EMAIL');
  });

  it('uses literal style when no <TYPE> placeholder', () => {
    const detections: PiiDetection[] = [{ start: 0, end: 5, type: 'EMAIL', source: 'regex' }];
    const redactions = buildRedactions(detections, '[REDACTED]');
    expect(redactions[0].replacement).toBe('[REDACTED]');
  });

  it('defaults to <TYPE> style when no style provided', () => {
    const detections: PiiDetection[] = [{ start: 3, end: 8, type: 'SSN', source: 'regex' }];
    const redactions = buildRedactions(detections);
    expect(redactions[0].replacement).toBe('SSN');
  });
});

describe('applyRedactions', () => {
  it('replaces a single span', () => {
    const text = 'hello world';
    const result = applyRedactions(text, [{ start: 6, end: 11, type: 'WORD', replacement: '<WORD>' }]);
    expect(result).toBe('hello <WORD>');
  });

  it('replaces multiple non-overlapping spans in order', () => {
    const text = 'a b c';
    const result = applyRedactions(text, [
      { start: 2, end: 3, type: 'B', replacement: '<B>' },
      { start: 0, end: 1, type: 'A', replacement: '<A>' },
    ]);
    expect(result).toBe('<A> <B> c');
  });

  it('skips overlapping spans (keeps first)', () => {
    const text = 'hello world';
    const result = applyRedactions(text, [
      { start: 0, end: 5, type: 'X', replacement: '<X>' },
      { start: 3, end: 8, type: 'Y', replacement: '<Y>' },
    ]);
    expect(result).toBe('<X> world');
  });

  it('returns original text when no redactions', () => {
    expect(applyRedactions('unchanged', [])).toBe('unchanged');
  });
});

describe('mergeDetections', () => {
  it('returns empty array for empty input', () => {
    expect(mergeDetections([])).toEqual([]);
  });

  it('keeps non-overlapping detections', () => {
    const detections: PiiDetection[] = [
      { start: 0, end: 5, type: 'EMAIL', source: 'regex' },
      { start: 10, end: 15, type: 'SSN', source: 'regex' },
    ];
    expect(mergeDetections(detections)).toHaveLength(2);
  });

  it('prefers external source over regex when overlapping', () => {
    const detections: PiiDetection[] = [
      { start: 0, end: 10, type: 'EMAIL', source: 'regex' },
      { start: 0, end: 10, type: 'EMAIL_ADDRESS', source: 'external' },
    ];
    const merged = mergeDetections(detections);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('external');
  });

  it('merges adjacent same-type spans', () => {
    const detections: PiiDetection[] = [
      { start: 0, end: 5, type: 'PHONE', source: 'regex' },
      { start: 6, end: 10, type: 'PHONE', source: 'regex' },
    ];
    const merged = mergeDetections(detections);
    expect(merged).toHaveLength(1);
    expect(merged[0].end).toBe(10);
  });

  it('does not merge non-adjacent same-type spans', () => {
    const detections: PiiDetection[] = [
      { start: 0, end: 5, type: 'PHONE', source: 'regex' },
      { start: 8, end: 12, type: 'PHONE', source: 'regex' },
    ];
    const merged = mergeDetections(detections);
    expect(merged).toHaveLength(2);
  });
});
