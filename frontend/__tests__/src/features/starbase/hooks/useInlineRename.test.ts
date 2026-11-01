import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInlineRename } from '@src/features/starbase/hooks/useInlineRename';
import { apiClient } from '@src/shared/api/client';
import React from 'react';
import type { ReactNode } from 'react';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    patch: vi.fn(),
  },
}));

describe('useInlineRename', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  it('suppresses old rename settlement after the same mounted view changes scope', async () => {
    let finish!: (value: unknown) => void; vi.mocked(apiClient.patch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const f = renderHook(({ scopeKey }) => useInlineRename({ type: 'folder', queryKey: ['folders'], scopeKey }), { initialProps: { scopeKey: 'A' }, wrapper: createWrapper() });
    act(() => f.result.current.startEditing('folder-A', 'A'));
    let pending!: Promise<void>; act(() => { pending = f.result.current.saveRename('folder-A', 'Renamed'); });
    f.rerender({ scopeKey: 'B' }); act(() => f.result.current.startEditing('folder-B', 'B'));
    await act(async () => { finish({}); await pending; });
    expect(f.result.current.editingId).toBe('folder-B'); expect(f.result.current.draftName).toBe('B'); expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not dispatch twice for Enter followed by blur while rename is pending', async () => {
    let finish!: (value: unknown) => void; vi.mocked(apiClient.patch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const f = renderHook(() => useInlineRename({ type: 'folder', queryKey: ['folders'] }), { wrapper: createWrapper() });
    act(() => f.result.current.startEditing('folder-A', 'A'));
    let pending!: Promise<void>; act(() => { pending = f.result.current.saveRename('folder-A', 'Renamed'); f.result.current.handleBlur('folder-A'); });
    expect(apiClient.patch).toHaveBeenCalledTimes(1); await act(async () => { finish({}); await pending; });
  });

  describe('initialization', () => {
    it('initializes with default state', () => {
      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      expect(result.current.editingId).toBeNull();
      expect(result.current.draftName).toBe('');
      expect(result.current.inputRef.current).toBeNull();
    });
  });

  describe('startEditing', () => {
    it('sets editing state with id and name', () => {
      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Project Name');
      });

      expect(result.current.editingId).toBe('proj-1');
      expect(result.current.draftName).toBe('Project Name');
    });
  });

  describe('cancelEditing', () => {
    it('clears editing state', () => {
      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Project Name');
      });

      expect(result.current.editingId).toBe('proj-1');

      act(() => {
        result.current.cancelEditing();
      });

      expect(result.current.editingId).toBeNull();
      expect(result.current.draftName).toBe('');
    });
  });

  describe('setDraftName', () => {
    it('updates draft name', () => {
      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Original');
      });

      act(() => {
        result.current.setDraftName('Updated Name');
      });

      expect(result.current.draftName).toBe('Updated Name');
    });
  });

  describe('saveRename', () => {
    it('saves rename for project type', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({});

      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Old Name');
      });

      await act(async () => {
        await result.current.saveRename('proj-1', 'New Name');
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/starbase-api/projects/proj-1', {
        name: 'New Name',
      });
      expect(result.current.editingId).toBeNull();
    });

    it('saves rename for file type', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({});

      const { result } = renderHook(
        () => useInlineRename({ type: 'file', queryKey: ['files'] }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.saveRename('file-1', 'New File Name');
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/starbase-api/files/file-1', {
        name: 'New File Name',
      });
    });

    it('saves rename for folder type', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({});

      const { result } = renderHook(
        () => useInlineRename({ type: 'folder', queryKey: ['folders'] }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.saveRename('folder-1', 'New Folder Name');
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/starbase-api/folders/folder-1', {
        name: 'New Folder Name',
      });
    });

    it('uses custom endpoint when provided', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({});

      const { result } = renderHook(
        () =>
          useInlineRename({
            getEndpoint: (id) => `/custom-api/items/${id}`,
            queryKey: ['items'],
          }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.saveRename('item-1', 'Custom Name');
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/custom-api/items/item-1', {
        name: 'Custom Name',
      });
    });

    it('trims whitespace from name', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({});

      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.saveRename('proj-1', '  Trimmed Name  ');
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/starbase-api/projects/proj-1', {
        name: 'Trimmed Name',
      });
    });

    it('cancels editing if name is empty after trim', async () => {
      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Original');
      });

      await act(async () => {
        await result.current.saveRename('proj-1', '   ');
      });

      expect(apiClient.patch).not.toHaveBeenCalled();
      expect(result.current.editingId).toBeNull();
    });

    it('invalidates queries after successful save', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({});
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.saveRename('proj-1', 'New Name');
      });

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['projects'] }, { throwOnError: true });
      });
    });

    it('cancels editing on API error', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(new Error('API Error'));

      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Original');
      });

      await act(async () => {
        await result.current.saveRename('proj-1', 'New Name');
      });

      expect(result.current.editingId).toBeNull();
    });

    it('throws error when neither type nor getEndpoint provided', async () => {
      const { result } = renderHook(
        () => useInlineRename({ queryKey: ['items'] } as any),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.saveRename('item-1', 'Name');
      });

      expect(apiClient.patch).not.toHaveBeenCalled();
      expect(result.current.editingId).toBeNull();
    });
  });

  describe('handleKeyDown', () => {
    it('saves on Enter key', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({});

      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Original');
        result.current.setDraftName('Updated');
      });

      const event = { key: 'Enter' } as React.KeyboardEvent;

      await act(async () => {
        result.current.handleKeyDown(event, 'proj-1');
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/starbase-api/projects/proj-1', {
        name: 'Updated',
      });
    });

    it('cancels on Escape key', () => {
      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Original');
      });

      const event = { key: 'Escape' } as React.KeyboardEvent;

      act(() => {
        result.current.handleKeyDown(event, 'proj-1');
      });

      expect(result.current.editingId).toBeNull();
      expect(apiClient.patch).not.toHaveBeenCalled();
    });

    it('does nothing on other keys', () => {
      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Original');
      });

      const event = { key: 'a' } as React.KeyboardEvent;

      act(() => {
        result.current.handleKeyDown(event, 'proj-1');
      });

      expect(result.current.editingId).toBe('proj-1');
      expect(apiClient.patch).not.toHaveBeenCalled();
    });
  });

  describe('handleBlur', () => {
    it('saves on blur', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({});

      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.startEditing('proj-1', 'Original');
        result.current.setDraftName('Blurred');
      });

      await act(async () => {
        result.current.handleBlur('proj-1');
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/starbase-api/projects/proj-1', {
        name: 'Blurred',
      });
    });
  });

  describe('inputRef focus effect', () => {
    it('focuses and selects input when editing starts', () => {
      const mockInput = {
        focus: vi.fn(),
        select: vi.fn(),
      };

      const { result } = renderHook(
        () => useInlineRename({ type: 'project', queryKey: ['projects'] }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.inputRef.current = mockInput as any;
        result.current.startEditing('proj-1', 'Name');
      });

      expect(mockInput.focus).toHaveBeenCalled();
      expect(mockInput.select).toHaveBeenCalled();
    });
  });
});
