import React from 'react';
import { act,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import OAuthCallback from '@src/features/git/pages/OAuthCallback';
import { apiClient } from '@src/shared/api/client';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { GIT_OAUTH_COMPLETED,GIT_OAUTH_FAILED } from '@src/features/git/api/gitOAuthPopup';
import { gitCredentialFixture,gitOAuthStateFixture as state } from '@test/fixtures/gitCredentials';
vi.mock('@src/shared/api/client',()=>({apiClient:{post:vi.fn()}}));
const credential={...gitCredentialFixture,authType:'oauth'};
let opener:{postMessage:ReturnType<typeof vi.fn>;closed:boolean};
beforeEach(()=>{vi.resetAllMocks();opener={postMessage:vi.fn(),closed:false};vi.stubGlobal('opener',opener);vi.spyOn(window,'close').mockImplementation(()=>{});window.history.replaceState(null,'',`/git/oauth/callback?code=synthetic-code&state=${state}`);vi.mocked(apiClient.post).mockResolvedValue(credential);sessionStorage.clear();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
describe('Git OAuth callback continuation',()=>{
 it('exchanges exactly once under StrictMode and sends only a verified owner receipt to its exact origin',async()=>{
  const f=render(<React.StrictMode><OAuthCallback/></React.StrictMode>);await screen.findByText('Authentication Successful!');
  expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/git-api/oauth/callback',{code:'synthetic-code',state});
  expect(opener.postMessage).toHaveBeenCalledExactlyOnceWith({type:GIT_OAUTH_COMPLETED,state,credential},window.location.origin);
  expect(window.location.search).toBe('');expect(sessionStorage.getItem('oauth_success')).toBeNull();f.unmount();
 });
 it.each([{}, {...credential,token:'synthetic-secret'},{...credential,authType:'pat'}])('rejects a malformed callback receipt without success signaling',async raw=>{
  vi.mocked(apiClient.post).mockResolvedValue(raw);render(<OAuthCallback/>);await screen.findByText('Authentication Failed');
  expect(opener.postMessage).toHaveBeenCalledExactlyOnceWith({type:GIT_OAUTH_FAILED,state},window.location.origin);expect(sessionStorage.getItem('oauth_success')).toBeNull();
 });
 it('rejects duplicate state parameters before any exchange',async()=>{
  window.history.replaceState(null,'',`/git/oauth/callback?code=synthetic-code&state=${state}&state=${state}`);render(<OAuthCallback/>);await screen.findByText('Authentication Failed');expect(apiClient.post).not.toHaveBeenCalled();
 });
 it.each(['unmount','session'])('does not signal or close a window after %s',async change=>{
  let finish!:(raw:unknown)=>void;vi.mocked(apiClient.post).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const f=render(<OAuthCallback/>);await waitFor(()=>expect(apiClient.post).toHaveBeenCalledTimes(1));if(change==='unmount')f.unmount();else advanceBrowserSessionRevision();
  await act(async()=>finish(credential));expect(opener.postMessage).not.toHaveBeenCalled();expect(window.close).not.toHaveBeenCalled();f.unmount();
 });
});
