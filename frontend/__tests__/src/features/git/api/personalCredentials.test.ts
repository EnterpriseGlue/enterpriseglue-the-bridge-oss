import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@src/shared/api/client';
import { listPersonalGitCredentials, listGitCredentialProviders, savePersonalGitCredential, renamePersonalGitCredential, disconnectPersonalGitCredential } from '@src/features/git/api/personalCredentials';
import { gitCredentialFixture as credential, gitProviderFixture as provider } from '@test/fixtures/gitCredentials';
vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
beforeEach(() => { vi.resetAllMocks(); });
describe('personal Git credential boundary', () => {
  it.each([{}, [{...credential, accessToken:'synthetic-secret'}], [{...credential,userId:'foreign'}], [credential,credential]])('rejects malformed, unredacted, foreign or duplicate lists', async raw => {
    vi.mocked(apiClient.get).mockResolvedValue(raw); await expect(listPersonalGitCredentials('user-1')).rejects.toThrow(/not verified/);
  });
  it('accepts canonical owner rows and provider capabilities', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce([credential]).mockResolvedValueOnce([provider]);
    expect(await listPersonalGitCredentials('user-1')).toEqual([credential]); expect(await listGitCredentialProviders()).toEqual([provider]);
  });
  it.each([{}, {...credential,userId:'foreign'}, {...credential,providerId:'gitlab'}, {...credential,authType:'oauth'}, {...credential,name:'Wrong'}, {...credential,token:'synthetic-secret'}])('does not accept a wrong save receipt', async raw => {
    vi.mocked(apiClient.post).mockResolvedValue(raw);
    await expect(savePersonalGitCredential('user-1',{providerId:'github',token:'synthetic-token',name:'Work'},()=>{})).rejects.toThrow(/not verified/);
  });
  it('owns request bytes and rechecks the continuation after transport', async () => {
    let finish!: (raw:unknown)=>void;vi.mocked(apiClient.post).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const request={providerId:'github',token:'synthetic-token',name:'Work'};let current=true;
    const operation=savePersonalGitCredential('user-1',request,()=>{if(!current)throw new Error('Closed view');});
    request.providerId='foreign';request.token='replacement';current=false;
    const rejection=expect(operation).rejects.toThrow('Closed view');finish(credential);await rejection;
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/git-api/credentials',{providerId:'github',token:'synthetic-token',name:'Work'});
  });
  it('uses credential id for rename and provider id for canonical HTTP 204 disconnect', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({success:true});vi.mocked(apiClient.delete).mockResolvedValue(undefined);
    await renamePersonalGitCredential('user-1',credential,'Renamed',()=>{});await disconnectPersonalGitCredential('user-1',credential,()=>{});
    expect(apiClient.patch).toHaveBeenCalledExactlyOnceWith('/git-api/credentials/credential-1',{name:'Renamed'});
    expect(apiClient.delete).toHaveBeenCalledExactlyOnceWith('/git-api/credentials/github');
  });
  it.each([{},null,'',{success:true}])('does not treat a non-204 disconnect body as verified',async raw=>{
    vi.mocked(apiClient.delete).mockResolvedValue(raw as any);await expect(disconnectPersonalGitCredential('user-1',credential,()=>{})).rejects.toThrow(/not verified/);
  });
  it('refuses foreign owner and path injection before writes',async()=>{
    for(const row of [{...credential,userId:'foreign'},{...credential,id:'../foreign'},{...credential,providerId:'github?foreign'}])await expect(renamePersonalGitCredential('user-1',row,'Renamed',()=>{})).rejects.toThrow(/not verified/);
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
  it('does not impose provider uniqueness on canonical rows, but binds token replacement to the reviewed credential id',async()=>{
    vi.mocked(apiClient.get).mockResolvedValue([credential,{...credential,id:'credential-2'}]);
    expect(await listPersonalGitCredentials('user-1')).toHaveLength(2);
    vi.mocked(apiClient.post).mockResolvedValue({...credential,id:'credential-2'});
    await expect(savePersonalGitCredential('user-1',{providerId:'github',token:'synthetic-token'},()=>{},'credential-1')).rejects.toThrow(/not verified/);
  });
});
