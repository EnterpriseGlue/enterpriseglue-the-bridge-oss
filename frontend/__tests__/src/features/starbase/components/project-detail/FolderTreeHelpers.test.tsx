import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrentPath, FolderLoader, TreePicker } from '@src/features/starbase/components/project-detail/FolderTreeHelpers';
import { foldersApi } from '@src/api/starbase/folders';
vi.mock('@src/api/starbase/folders', () => ({ foldersApi: { listByProject: vi.fn() } }));
const folder = '11111111-1111-4111-8111-111111111111';
describe('validated folder picker input', () => {
 beforeEach(() => vi.clearAllMocks());
 it('accepts an empty complete list without crawling other endpoints', async () => { vi.mocked(foldersApi.listByProject).mockResolvedValue([]); const onLoaded = vi.fn(); render(<FolderLoader projectId="project" onLoaded={onLoaded}/>); await waitFor(() => expect(onLoaded).toHaveBeenCalledExactlyOnceWith([])); expect(foldersApi.listByProject).toHaveBeenCalledTimes(1); });
 it('leaves mutations unavailable when the authoritative list fails', async () => { vi.mocked(foldersApi.listByProject).mockRejectedValue(new Error('unverified')); const onLoaded = vi.fn(); render(<FolderLoader projectId="project" onLoaded={onLoaded}/>); expect(await screen.findByRole('alert')).toHaveTextContent('Folder tree unavailable'); expect(onLoaded).not.toHaveBeenCalled(); expect(foldersApi.listByProject).toHaveBeenCalledTimes(1); });
 it('discards a delayed list after replacing the project', async () => { let finish!: (rows: any) => void; vi.mocked(foldersApi.listByProject).mockImplementation(id => id === 'old' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([])); const onLoaded = vi.fn(); const f = render(<FolderLoader projectId="old" onLoaded={onLoaded}/>); f.rerender(<FolderLoader projectId="new" onLoaded={onLoaded}/>); await waitFor(() => expect(onLoaded).toHaveBeenCalledOnce()); await act(async () => finish([{ id: folder, name: 'Old', parentFolderId: null }])); expect(onLoaded).toHaveBeenCalledExactlyOnceWith([]); });
 it('rejects corrupt ancestry before recursive path or tree rendering', () => { const rows = [{ id: folder, name: 'Cycle', parentFolderId: folder }]; const f = render(<CurrentPath allFolders={rows} folderId={folder} projectName="Owned"/>); expect(screen.getByRole('alert')).toHaveTextContent('Folder path unavailable'); f.unmount(); render(<TreePicker allFolders={rows} value="ROOT" onChange={vi.fn()} disabledSet={new Set()} projectName="Owned"/>); expect(screen.getByRole('alert')).toHaveTextContent('Folder tree unavailable'); });
});
