import { describe, expect, it } from 'vitest';
import {
  buildStarbaseFileName,
  sanitizeFileNameSegment,
} from '@enterpriseglue/shared/utils/starbase-filenames.js';

describe('sanitizeFileNameSegment', () => {
  it('returns the fallback for empty or whitespace-only input', () => {
    expect(sanitizeFileNameSegment('', 'file')).toBe('file');
    expect(sanitizeFileNameSegment('   ', 'file')).toBe('file');
    expect(sanitizeFileNameSegment(undefined, 'file')).toBe('file');
  });

  it('returns "download" when both input and fallback are empty', () => {
    expect(sanitizeFileNameSegment('', '')).toBe('download');
  });

  it('rejects path traversal atoms', () => {
    expect(sanitizeFileNameSegment('.', 'x')).toBe('x');
    expect(sanitizeFileNameSegment('..', 'x')).toBe('x');
  });

  it('strips control chars, path separators and windows-reserved chars', () => {
    const raw = 'a\u0000b/c\\d:e*f?g"h<i>j|k';
    expect(sanitizeFileNameSegment(raw, 'fallback')).toBe('a_b_c_d_e_f_g_h_i_j_k');
  });

  it('collapses internal whitespace to underscores and trims', () => {
    expect(sanitizeFileNameSegment('  my  process name  ', 'x')).toBe('my_process_name');
  });

  it('caps length at 200 characters', () => {
    const long = 'a'.repeat(500);
    const cleaned = sanitizeFileNameSegment(long, 'x');
    expect(cleaned.length).toBe(200);
  });
});

describe('buildStarbaseFileName', () => {
  it('appends the type extension when missing', () => {
    expect(buildStarbaseFileName('My Process', 'bpmn')).toBe('My_Process.bpmn');
  });

  it('does not double-append when the name already ends with the correct extension', () => {
    expect(buildStarbaseFileName('My_Process.bpmn', 'bpmn')).toBe('My_Process.bpmn');
  });

  it('appends the type extension even when the name contains an interior dot (regression)', () => {
    // Prior inline rule in files.ts skipped extension when name contained any
    // dot. buildStarbaseFileName must treat "My.Process" as a normal base and
    // append .bpmn.
    expect(buildStarbaseFileName('My.Process', 'bpmn')).toBe('My.Process.bpmn');
  });

  it('matches the type extension case-insensitively', () => {
    expect(buildStarbaseFileName('MyProcess.BPMN', 'bpmn')).toBe('MyProcess.BPMN');
  });

  it('does not rewrite one diagram extension to another when only type is given', () => {
    // With only `type` (no forceExtension) the helper must not munge
    // intentional extensions.
    expect(buildStarbaseFileName('foo.dmn', 'bpmn')).toBe('foo.dmn.bpmn');
  });

  it('forceExtension replaces a trailing diagram extension', () => {
    expect(
      buildStarbaseFileName('My Process.bpmn', 'bpmn', { forceExtension: 'pdf' }),
    ).toBe('My_Process.pdf');
    expect(
      buildStarbaseFileName('table.dmn', 'dmn', { forceExtension: 'pdf' }),
    ).toBe('table.pdf');
  });

  it('forceExtension appends when no diagram extension is present', () => {
    expect(
      buildStarbaseFileName('Receipt Report', 'bpmn', { forceExtension: 'pdf' }),
    ).toBe('Receipt_Report.pdf');
  });

  it('forceExtension is idempotent', () => {
    expect(
      buildStarbaseFileName('Receipt Report.pdf', 'bpmn', { forceExtension: 'pdf' }),
    ).toBe('Receipt_Report.pdf');
  });

  it('strips leading dots from forceExtension', () => {
    expect(
      buildStarbaseFileName('Diagram', 'bpmn', { forceExtension: '.pdf' }),
    ).toBe('Diagram.pdf');
  });

  it('falls back to fallbackBase.extension when name is empty', () => {
    expect(buildStarbaseFileName('', 'bpmn')).toBe('diagram.bpmn');
    expect(
      buildStarbaseFileName('', 'bpmn', { fallbackBase: 'model' }),
    ).toBe('model.bpmn');
    expect(
      buildStarbaseFileName('', 'bpmn', { forceExtension: 'pdf' }),
    ).toBe('diagram.pdf');
  });

  it('sanitises path separators and windows-reserved characters', () => {
    expect(buildStarbaseFileName('a/b\\c:d*e?f"g<h>i|j', 'bpmn')).toBe(
      'a_b_c_d_e_f_g_h_i_j.bpmn',
    );
  });

  it('returns a sanitised single-segment value even with no type and no force', () => {
    // Used for ZIP archive outer download name.
    expect(buildStarbaseFileName('My Project Name', null)).toBe('My_Project_Name');
    expect(buildStarbaseFileName('My Project Name', undefined)).toBe('My_Project_Name');
  });
});
