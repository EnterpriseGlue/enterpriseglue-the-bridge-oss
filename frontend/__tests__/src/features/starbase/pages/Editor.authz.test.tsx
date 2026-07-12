import { describe, expect, it } from 'vitest';
import { resolveEditorModeTabIndex } from '@src/features/starbase/utils/editorAuthz';

describe('Editor authorization helpers', () => {
  it('keeps the write-oriented Implement tab unavailable without edit permission', () => {
    expect(resolveEditorModeTabIndex(1, 'Missing permission project:files:edit')).toBe(0);
    expect(resolveEditorModeTabIndex(1, null)).toBe(1);
    expect(resolveEditorModeTabIndex(0, 'Missing permission project:files:edit')).toBe(0);
  });
});
