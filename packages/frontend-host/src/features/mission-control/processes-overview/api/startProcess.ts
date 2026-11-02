import { ProcessInstanceStartRequestSchema, ProcessInstanceStartByDefinitionResponseSchema, type ProcessInstanceStartRequest } from '@enterpriseglue/shared/schemas/mission-control/process.js';
import { apiClient } from '../../../../shared/api/client.js';

export async function startProcessDefinition(definitionId: string, input: ProcessInstanceStartRequest) {
  if (!definitionId || definitionId !== definitionId.trim()) throw new Error('Invalid process definition');
  const request = ProcessInstanceStartRequestSchema.safeParse(input);
  if (!request.success) throw new Error('Invalid process start input');
  const body = structuredClone(request.data);
  const raw = await apiClient.post<unknown>(`/mission-control-api/process-definitions/${encodeURIComponent(definitionId)}/start`, body, { credentials: 'include' });
  const receipt = ProcessInstanceStartByDefinitionResponseSchema.safeParse(raw);
  if (!receipt.success || receipt.data.definitionId !== definitionId) throw new Error('Process start receipt could not be verified');
  return receipt.data;
}
