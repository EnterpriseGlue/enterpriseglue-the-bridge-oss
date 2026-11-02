import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncProject, syncProjectBatch } from '@src/features/git/api/syncProject';
import { apiClient } from '@src/shared/api/client';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { GitSyncRequestSchema } from '@enterpriseglue/shared/schemas/git/repository.js';
vi.mock('@src/shared/api/client', async original => ({ ...await original<typeof import('@src/shared/api/client')>(), apiClient: { post: vi.fn() } }));
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const receipt={success:true,pushed:true,pulled:false,filesChanged:1,commitSha:'abcdef1'};
const request={projectId:a,direction:'push' as const,message:'Reviewed sync'};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(apiClient.post).mockResolvedValue(receipt);});
function deferred(){let resolve!:(value: unknown)=>void;return {promise:new Promise(resolve_=>{resolve=resolve_;}),resolve:(value: unknown)=>resolve(value)};}

describe('sync request and receipt binding',()=>{
 it.each([{}, {success:false}, {...receipt,filesChanged:-1}, {...receipt,filesChanged:0}, {...receipt,commitSha:''}, {...receipt,commitSha:' abc'}, {...receipt,pulled:true}, {...receipt,error:'Partial failure'}, {...receipt,pushed:false}])('rejects an unverified receipt %j',async value=>{
  vi.mocked(apiClient.post).mockResolvedValue(value);
  await expect(syncProject(request,()=>{})).rejects.toThrow('Sync response was not verified');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
 });
 it.each(['push','pull','both'] as const)('accepts a valid %s acknowledgement',async direction=>{
  const result=direction==='pull'?{success:true,pushed:false,pulled:true,filesChanged:1}:receipt;
  vi.mocked(apiClient.post).mockResolvedValue(result);
  await expect(syncProject({...request,direction},()=>{})).resolves.toEqual(result);
 });
 it('accepts an unchanged acknowledgement without inventing a remote effect',async()=>{
  const value={success:true,pushed:false,pulled:false,filesChanged:0};vi.mocked(apiClient.post).mockResolvedValue(value);
  await expect(syncProject(request,()=>{})).resolves.toEqual(value);
 });
 it('owns the confirmed request and validates its canonical wire body',async()=>{
  const pending=deferred();vi.mocked(apiClient.post).mockReturnValue(pending.promise);
  const mutable={...request};const operation=syncProject(mutable,()=>{});mutable.projectId=b;mutable.message='Replacement';
  pending.resolve(receipt);await operation;
  const body=vi.mocked(apiClient.post).mock.calls[0][1];expect(body).toEqual(request);expect(GitSyncRequestSchema.parse(body)).toEqual(request);
 });
 it('stops before transport when the owner is no longer current',async()=>{
  await expect(syncProject(request,()=>{throw new Error('Closed view');})).rejects.toThrow('Closed view');expect(apiClient.post).not.toHaveBeenCalled();
 });
 it('refuses a late acknowledgement after a browser session changes',async()=>{
  const pending=deferred();vi.mocked(apiClient.post).mockReturnValue(pending.promise);const operation=syncProject(request,()=>{});
  const rejection=expect(operation).rejects.toThrow('context changed');advanceBrowserSessionRevision();pending.resolve(receipt);await rejection;
 });
 it('refuses a pulled effect for a push confirmation and a pushed effect for pull',async()=>{
  vi.mocked(apiClient.post).mockResolvedValue(receipt);await expect(syncProject({...request,direction:'pull'},()=>{})).rejects.toThrow('not verified');
 });
});

describe('owned bulk sync queue',()=>{
 const projects=()=>[{id:a,name:'A',gitUrl:'https://example.invalid/a'},{id:b,name:'B',gitUrl:'https://example.invalid/b'}];
 it('owns queue targets, direction and description across requests',async()=>{
  const pending=deferred();vi.mocked(apiClient.post).mockReturnValueOnce(pending.promise);
  const selected=projects(), options={direction:'push' as 'push'|'pull',message:'Original'};
  const operation=syncProjectBatch(selected,options,()=>{});selected[1].id='foreign';selected[1].name='Replacement';options.direction='pull';options.message='Replacement';
  pending.resolve(receipt);expect((await operation).succeeded).toEqual([{id:a,name:'A'},{id:b,name:'B'}]);
  expect(vi.mocked(apiClient.post).mock.calls.map(call=>call[1])).toEqual([{projectId:a,direction:'push',message:'Original'},{projectId:b,direction:'push',message:'Original'}]);
 });
 it.each(['view','session'])('stops the remaining queue after a %s change',async reason=>{
  const pending=deferred();vi.mocked(apiClient.post).mockReturnValueOnce(pending.promise);let current=true;
  const operation=syncProjectBatch(projects(),{direction:'push',message:'Reviewed'},()=>{if(!current)throw new Error('Closed view');});
  const rejection=expect(operation).rejects.toBeDefined();if(reason==='view')current=false;else advanceBrowserSessionRevision();pending.resolve(receipt);await rejection;
  expect(apiClient.post).toHaveBeenCalledTimes(1);
 });
 it('rejects duplicate and malformed scopes before the first request',async()=>{
  for(const selected of [[projects()[0],projects()[0]],[projects()[0],{...projects()[1],id:'invalid'}]])await expect(syncProjectBatch(selected,{direction:'push',message:'Reviewed'},()=>{})).rejects.toBeDefined();
  expect(apiClient.post).not.toHaveBeenCalled();
 });
 it('counts only verified projects, reports an owned failure once, and skips disconnected projects',async()=>{
  vi.mocked(apiClient.post).mockResolvedValueOnce({});
  const result=await syncProjectBatch([...projects(),{id:'disconnected',name:'C',gitUrl:null}],{direction:'push',message:'Reviewed'},()=>{});
  expect(result.succeeded).toEqual([{id:b,name:'B'}]);expect(result.failed).toEqual([{id:a,name:'A',error:'Sync response was not verified'}]);expect(result.skipped).toHaveLength(1);expect(apiClient.post).toHaveBeenCalledTimes(2);
 });
});
