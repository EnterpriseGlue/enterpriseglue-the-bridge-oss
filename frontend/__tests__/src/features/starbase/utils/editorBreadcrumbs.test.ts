import { describe, expect, it } from 'vitest';
import {
  buildEditorBreadcrumbBackState,
  buildEditorBreadcrumbState,
  buildEditorNavigationState,
  getEditorBreadcrumbTrail,
  normalizeEditorBreadcrumbEntry,
} from '@src/features/starbase/utils/editorBreadcrumbs';

describe('editorBreadcrumbs', () => {
  describe('normalizeEditorBreadcrumbEntry', () => {
    it('returns null when the entry has no file id', () => {
      expect(normalizeEditorBreadcrumbEntry({ fileName: 'Process A.bpmn' })).toBeNull();
    });

    it('normalizes a breadcrumb entry', () => {
      expect(normalizeEditorBreadcrumbEntry({ fileId: 'file-a', fileName: 'Process A.bpmn' })).toEqual({
        fileId: 'file-a',
        fileName: 'Process A.bpmn',
      });
    });
  });

  describe('getEditorBreadcrumbTrail', () => {
    it('supports legacy fromEditor state', () => {
      expect(getEditorBreadcrumbTrail({ fromEditor: { fileId: 'file-a', fileName: 'Process A.bpmn' } }, 'file-b')).toEqual([
        { fileId: 'file-a', fileName: 'Process A.bpmn' },
      ]);
    });

    it('keeps multi-step breadcrumb trails intact', () => {
      expect(
        getEditorBreadcrumbTrail(
          {
            breadcrumbTrail: [
              { fileId: 'file-a', fileName: 'Process A.bpmn' },
              { fileId: 'file-b', fileName: 'Decision B.dmn' },
              { fileId: 'file-c', fileName: 'Process C.bpmn' },
            ],
            fromEditor: { fileId: 'file-c', fileName: 'Process C.bpmn' },
          },
          'file-d'
        )
      ).toEqual([
        { fileId: 'file-a', fileName: 'Process A.bpmn' },
        { fileId: 'file-b', fileName: 'Decision B.dmn' },
        { fileId: 'file-c', fileName: 'Process C.bpmn' },
      ]);
    });

    it('filters the current file out of the trail', () => {
      expect(
        getEditorBreadcrumbTrail(
          {
            breadcrumbTrail: [
              { fileId: 'file-a', fileName: 'Process A.bpmn' },
              { fileId: 'file-b', fileName: 'Decision B.dmn' },
            ],
            fromEditor: { fileId: 'file-b', fileName: 'Decision B.dmn' },
          },
          'file-b'
        )
      ).toEqual([{ fileId: 'file-a', fileName: 'Process A.bpmn' }]);
    });
  });

  describe('buildEditorNavigationState', () => {
    it('appends the current file to the existing trail', () => {
      expect(
        buildEditorNavigationState({
          currentState: {
            breadcrumbTrail: [
              { fileId: 'file-a', fileName: 'Process A.bpmn' },
              { fileId: 'file-b', fileName: 'Decision B.dmn' },
            ],
            fromEditor: { fileId: 'file-b', fileName: 'Decision B.dmn' },
          },
          currentFileId: 'file-c',
          currentFileName: 'Process C.bpmn',
        })
      ).toEqual({
        breadcrumbTrail: [
          { fileId: 'file-a', fileName: 'Process A.bpmn' },
          { fileId: 'file-b', fileName: 'Decision B.dmn' },
          { fileId: 'file-c', fileName: 'Process C.bpmn' },
        ],
        fromEditor: { fileId: 'file-c', fileName: 'Process C.bpmn' },
      });
    });

    it('includes extra state while keeping the trail', () => {
      expect(
        buildEditorNavigationState({
          currentState: { fromEditor: { fileId: 'file-a', fileName: 'Process A.bpmn' } },
          currentFileId: 'file-b',
          currentFileName: 'Decision B.dmn',
          extraState: { focusElementId: 'CallActivity_1' },
        })
      ).toEqual({
        breadcrumbTrail: [
          { fileId: 'file-a', fileName: 'Process A.bpmn' },
          { fileId: 'file-b', fileName: 'Decision B.dmn' },
        ],
        fromEditor: { fileId: 'file-b', fileName: 'Decision B.dmn' },
        focusElementId: 'CallActivity_1',
      });
    });
  });

  describe('buildEditorBreadcrumbBackState', () => {
    it('truncates the trail when navigating back to an earlier breadcrumb', () => {
      expect(
        buildEditorBreadcrumbBackState(
          [
            { fileId: 'file-a', fileName: 'Process A.bpmn' },
            { fileId: 'file-b', fileName: 'Decision B.dmn' },
            { fileId: 'file-c', fileName: 'Process C.bpmn' },
          ],
          1
        )
      ).toEqual({
        breadcrumbTrail: [{ fileId: 'file-a', fileName: 'Process A.bpmn' }],
        fromEditor: { fileId: 'file-a', fileName: 'Process A.bpmn' },
      });
    });

    it('clears the trail when navigating back to the first breadcrumb', () => {
      expect(
        buildEditorBreadcrumbBackState(
          [
            { fileId: 'file-a', fileName: 'Process A.bpmn' },
            { fileId: 'file-b', fileName: 'Decision B.dmn' },
          ],
          0
        )
      ).toBeUndefined();
    });
  });

  describe('buildEditorBreadcrumbState', () => {
    it('returns only extra state when the trail is empty', () => {
      expect(buildEditorBreadcrumbState([], { focusElementId: 'Task_1' })).toEqual({ focusElementId: 'Task_1' });
    });
  });
});
