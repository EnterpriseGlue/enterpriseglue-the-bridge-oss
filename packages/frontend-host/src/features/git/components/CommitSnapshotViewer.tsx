import React, { Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { InlineNotification } from '@carbon/react';
import { LoadingState } from '../../shared/components/LoadingState';
import { getProjectCommitSnapshots, selectCommitFileSnapshot } from '../api/commitSnapshots';

const BpmnViewer = lazy(() => import('../../shared/components/Viewer'));
const DmnViewer = lazy(() => import('../../starbase/components/DMNDrdMini'));

export default function CommitSnapshotViewer({ projectId, commitId, file }: {
  projectId: string;
  commitId: string | null;
  file: { id: string; name: string; type: string; folderId?: string | null };
}) {
  const query = useQuery({
    queryKey: ['vcs', 'commit-files', projectId, commitId],
    queryFn: () => getProjectCommitSnapshots(projectId, commitId!),
    enabled: Boolean(projectId && commitId),
    staleTime: Infinity,
    retry: false,
  });
  if (commitId && query.isPending) return <LoadingState message="Loading saved diagram..." />;
  const snapshot = selectCommitFileSnapshot(query.data?.files || [], file);
  if (!commitId || query.isError || !snapshot || !['bpmn', 'dmn'].includes(snapshot.type)) {
    return <InlineNotification kind="error" title="Saved diagram unavailable" subtitle="This version does not contain an unambiguous saved snapshot of this file." hideCloseButton />;
  }
  const key = JSON.stringify([projectId, commitId, file.id]);
  // Historical content never enters the editor's modeler or autosave path.
  return <Suspense fallback={<LoadingState message="Loading saved diagram..." />}>
    {snapshot.type === 'bpmn'
      ? <BpmnViewer key={key} xml={snapshot.content!} />
      : <DmnViewer key={key} xml={snapshot.content!} preferDecisionTable />}
  </Suspense>;
}
