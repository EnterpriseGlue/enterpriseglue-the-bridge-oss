import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import CommitSnapshotViewer from '@src/features/git/components/CommitSnapshotViewer';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@src/features/shared/components/Viewer', () => ({ default: ({ xml }: { xml: string }) => <pre data-testid="bpmn-readonly">{xml}</pre> }));
vi.mock('@src/features/starbase/components/DMNDrdMini', () => ({ default: ({ xml }: { xml: string }) => <pre data-testid="dmn-readonly">{xml}</pre> }));

const file = { id: 'file-A', name: 'Current name', type: 'bpmn', folderId: null };
const snapshot = { id: 'snapshot-A', mainFileId: 'file-A', name: 'Historical name', type: 'bpmn', folderId: null, content: '<definitions>A</definitions>', changeType: 'modified' };
const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
beforeEach(() => vi.resetAllMocks());

it.each(['bpmn', 'dmn'])('renders only the selected historical %s file in a read-only viewer', async type => {
  vi.mocked(apiClient.get).mockResolvedValue({ files: [
    { ...snapshot, id: 'foreign', mainFileId: 'other-file', name: file.name, content: 'wrong diagram', type },
    { ...snapshot, type },
  ] });
  render(<CommitSnapshotViewer projectId="project-A" commitId="commit-A" file={{ ...file, type }} />, { wrapper: wrapper() });
  expect(await screen.findByTestId(`${type}-readonly`)).toHaveTextContent(snapshot.content);
  expect(screen.queryByText('wrong diagram')).not.toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/vcs-api/projects/project-A/commits/commit-A/files');
});

it.each(['missing', 'deleted'])('shows an explicit unavailable state instead of the draft or another file (%s)', async state => {
  vi.mocked(apiClient.get).mockResolvedValue({ files: [{ ...snapshot, mainFileId: state === 'missing' ? 'another-file' : file.id, changeType: state === 'deleted' ? 'deleted' : 'modified' }] });
  render(<CommitSnapshotViewer projectId="project-A" commitId="commit-A" file={file} />, { wrapper: wrapper() });
  expect(await screen.findByText('Saved diagram unavailable')).toBeVisible();
  expect(screen.queryByTestId('bpmn-readonly')).not.toBeInTheDocument();
});

it('does not request a guessed revision when the deployed link has no commit', () => {
  render(<CommitSnapshotViewer projectId="project-A" commitId={null} file={file} />, { wrapper: wrapper() });
  expect(screen.getByText('Saved diagram unavailable')).toBeVisible();
  expect(apiClient.get).not.toHaveBeenCalled();
});

it('stops on a rejected read without automatic retries', async () => {
  vi.mocked(apiClient.get).mockRejectedValue(new Error('Read denied'));
  render(<CommitSnapshotViewer projectId="project-A" commitId="commit-A" file={file} />, { wrapper: wrapper() });
  expect(await screen.findByText('Saved diagram unavailable')).toBeVisible();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

it('cannot replace a new target with a late response for the previous project/commit', async () => {
  let resolveOld!: (value: unknown) => void;
  vi.mocked(apiClient.get).mockImplementation(url => url.includes('project-A') ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ files: [{ ...snapshot, id: 'snapshot-B', mainFileId: 'file-B', content: '<definitions>B</definitions>' }] }));
  const mounted = render(<CommitSnapshotViewer projectId="project-A" commitId="commit-A" file={file} />, { wrapper: wrapper() });
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  mounted.rerender(<CommitSnapshotViewer projectId="project-B" commitId="commit-B" file={{ ...file, id: 'file-B' }} />);
  expect(await screen.findByTestId('bpmn-readonly')).toHaveTextContent('<definitions>B</definitions>');
  await act(async () => { resolveOld({ files: [snapshot] }); });
  expect(screen.getByTestId('bpmn-readonly')).toHaveTextContent('<definitions>B</definitions>');
});
