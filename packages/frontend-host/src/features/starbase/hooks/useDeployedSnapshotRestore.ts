import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { RestoreFileFromCommitRequestSchema, RestoreFileFromCommitResponseSchema, type RestoreFileFromCommitRequest } from '@enterpriseglue/shared/schemas/starbase/file.js';
import { useProjectActionFence } from './useProjectActionFence';

type Options = {
  fileId?: string;
  request: RestoreFileFromCommitRequest;
  authority: string;
  allowed: boolean;
  assertWritable: () => void;
  onVerified: () => void;
  onError: (error: unknown) => void;
};

// A draft copy only. The server authorizes and verifies the retained source.
export function useDeployedSnapshotRestore(options: Options) {
  const request = { ...options.request };
  const fence = useProjectActionFence(JSON.stringify([options.fileId, request, options.authority, options.allowed]));
  const mutation = useMutation({ mutationFn: async (intent: {
    fileId: string; request: RestoreFileFromCommitRequest;
    operation: NonNullable<ReturnType<typeof fence.begin>>;
    assertWritable: Options['assertWritable']; onVerified: Options['onVerified']; onError: Options['onError'];
  }) => {
    const { operation } = intent;
    try {
      operation.check(); intent.assertWritable(); operation.check();
      const raw = await apiClient.post(`/starbase-api/files/${encodeURIComponent(intent.fileId)}/restore-from-commit`, intent.request);
      operation.check();
      const receipt = RestoreFileFromCommitResponseSchema.safeParse(raw);
      if (!receipt.success || receipt.data.fileId !== intent.fileId
        || (intent.request.commitId !== undefined && receipt.data.commitId !== intent.request.commitId)
        || (intent.request.fileVersionNumber !== undefined && receipt.data.fileVersionNumber !== intent.request.fileVersionNumber)) {
        throw new Error('Restore response was not verified; refresh before retrying.');
      }
      operation.check(); intent.onVerified();
    } catch (error) {
      try { operation.check(); operation.markUncertain(); intent.onError(error); } catch {}
      throw error;
    } finally { operation.finish(); }
  } });
  const mutate = () => {
    const operation = fence.begin(options.allowed);
    if (!operation) return;
    const body = RestoreFileFromCommitRequestSchema.safeParse(request);
    if (!options.fileId || !RestoreFileFromCommitResponseSchema.shape.fileId.safeParse(options.fileId).success || !body.success) {
      operation.markUncertain(); options.onError(new Error('Saved deployment selection was not verified; refresh before retrying.'));
      operation.finish(); return;
    }
    mutation.mutate({ fileId: options.fileId, request: body.data, operation,
      assertWritable: options.assertWritable, onVerified: options.onVerified, onError: options.onError });
  };

  return { mutate, isPending: fence.pending, isBlocked: fence.blocked };
}
