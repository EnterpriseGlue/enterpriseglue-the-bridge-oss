import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateAndUploadFile, validateAndUploadProjectArchive, detectCamundaEngine } from '@src/features/starbase/utils/uploadValidation'
import { apiClient } from '@src/shared/api/client'
vi.mock('@src/shared/api/client', async original => ({ ...await original<typeof import('@src/shared/api/client')>(), apiClient: { post: vi.fn(), postRaw: vi.fn() } }))
const projectId = '11111111-1111-4111-8111-111111111111'
const xml = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p"/></definitions>'
const receipt = { id: '33333333-3333-4333-8333-333333333333', name: 'Order.bpmn', type: 'bpmn', bpmnProcessId: 'p', dmnDecisionId: null, createdAt: 1, updatedAt: 2 }
function setup() { return { projectId, folderId: null, file: { name: 'Order.bpmn', text: async () => xml } as File, queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } as any, showToast: vi.fn(), onUncertain: vi.fn() } }
describe('upload receipt and XML contracts', () => {
 beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiClient.post).mockResolvedValue(receipt) })
 it.each([{}, { ...receipt, name: 'Other' }, { ...receipt, type: 'dmn' }, { ...receipt, id: '../foreign' }, { ...receipt, token: 'private' }])('refuses an unverified file receipt', async raw => {
  const p = setup(); vi.mocked(apiClient.post).mockResolvedValue(raw); await validateAndUploadFile(p); expect(p.showToast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })); expect(p.onUncertain).toHaveBeenCalledOnce(); expect(p.queryClient.invalidateQueries).not.toHaveBeenCalled()
 })
 it.each(['<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process></definitions>', '<!DOCTYPE definitions [<!ENTITY x "test">]>'+xml, '<fakedefinitions xmlns="urn:other"><!--spec/BPMN--></fakedefinitions>', '<definitions xmlns="urn:other"><!--bpmn:definitions--></definitions>'])('rejects malformed or spoofed XML before transport', async text => {
  const p = setup(); p.file = { name: 'Order.bpmn', text: async () => text } as File; await validateAndUploadFile(p); expect(apiClient.post).not.toHaveBeenCalled(); expect(p.onUncertain).not.toHaveBeenCalled()
 })
 it('rejects extension/body disagreement before dispatch', async () => { const p = setup(); p.file = { name: 'Order.dmn', text: async () => xml } as File; await validateAndUploadFile(p); expect(apiClient.post).not.toHaveBeenCalled() })
 it('does not mistake a comment about Zeebe for an actual engine extension', () => { expect(detectCamundaEngine(xml.replace('<process', '<!-- <zeebe:taskDefinition/> --><process')).isCamunda8).toBe(false) })
 it('reports an acknowledged receipt but failed refresh without success or replay', async () => { const p = setup(); p.queryClient.invalidateQueries.mockRejectedValue(new Error('failed')); await validateAndUploadFile(p); expect(p.showToast).toHaveBeenCalledWith(expect.objectContaining({ subtitle: expect.stringMatching(/acknowledged.*refresh failed/) })); expect(p.onUncertain).toHaveBeenCalledOnce(); expect(apiClient.post).toHaveBeenCalledTimes(1) })
 it('observes an actual React Query refetch failure after ACK instead of swallowing it', async () => {
  const p = setup(), client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryFn = vi.fn().mockResolvedValue({ files: [] });
  const observer = new QueryObserver(client, { queryKey: ['contents', projectId], queryFn });
  const unsubscribe = observer.subscribe(() => {});
  try {
   await observer.refetch(); queryFn.mockRejectedValue(new Error('contents unavailable'));
   p.queryClient = client; await validateAndUploadFile(p);
   expect(p.showToast).toHaveBeenCalledWith(expect.objectContaining({ subtitle: expect.stringMatching(/acknowledged.*refresh failed/) }));
   expect(p.showToast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })); expect(p.onUncertain).toHaveBeenCalledOnce();
  } finally { unsubscribe(); client.clear() }
 })
 it.each([{}, { foldersCreated: -1, filesCreated: 1, linksRewritten: 0, warnings: [] }, { foldersCreated: 0, filesCreated: 1, linksRewritten: 0, warnings: [], token: 'private' }])('requires an exact archive metadata receipt', async raw => {
  const p = setup(); p.file = { name: 'Project.zip', arrayBuffer: async () => new Uint8Array([1]).buffer } as File; vi.mocked(apiClient.postRaw).mockResolvedValue(raw); await validateAndUploadProjectArchive(p); expect(p.onUncertain).toHaveBeenCalledOnce(); expect(p.queryClient.invalidateQueries).not.toHaveBeenCalled()
 })
 it.each([0, 25*1024*1024+1])('rejects archive size %i before HTTP', async size => { const p = setup(); p.file = { name: 'Project.zip', arrayBuffer: async () => new ArrayBuffer(size) } as File; await validateAndUploadProjectArchive(p); expect(apiClient.postRaw).not.toHaveBeenCalled() })
})
