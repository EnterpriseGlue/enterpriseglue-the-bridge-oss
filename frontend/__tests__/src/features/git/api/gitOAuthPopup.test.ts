import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { apiClient } from '@src/shared/api/client';
import { beginGitOAuth,GIT_OAUTH_COMPLETED,GIT_OAUTH_FAILED } from '@src/features/git/api/gitOAuthPopup';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { gitCredentialFixture,gitOAuthStateFixture as state } from '@test/fixtures/gitCredentials';
vi.mock('@src/shared/api/client',()=>({apiClient:{get:vi.fn()}}));
const credential={...gitCredentialFixture,authType:'oauth' as const};
let popup:Window;
beforeEach(()=>{vi.useFakeTimers();vi.resetAllMocks();popup={closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window;vi.spyOn(window,'open').mockReturnValue(popup);vi.mocked(apiClient.get).mockResolvedValue({authUrl:`https://github.com/login/oauth/authorize?state=${state}`,state});});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
async function started(check=()=>{}){const flow=beginGitOAuth('github','user-1',check);await Promise.resolve();await Promise.resolve();return flow;}
function message(overrides:Partial<MessageEventInit>={},payload:unknown={type:GIT_OAUTH_COMPLETED,state,credential}){window.dispatchEvent(new MessageEvent('message',{origin:window.location.origin,source:popup,data:payload,...overrides}));}
describe('owned Git OAuth popup',()=>{
 it('accepts only its source/origin/state and independently reads the owner credential',async()=>{
  const flow=await started();vi.mocked(apiClient.get).mockResolvedValue(credential);
  message({origin:'https://foreign.invalid'});message({source:window});message({}, {type:GIT_OAUTH_COMPLETED,state:'b'.repeat(64),credential});
  expect(apiClient.get).toHaveBeenCalledTimes(1);message();expect(await flow.result).toEqual(credential);
  expect(apiClient.get).toHaveBeenLastCalledWith('/git-api/credentials/github');expect(popup.close).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it.each(['cancel','close','timeout','session','view'])('cleans all owned timers/listeners after %s',async reason=>{
  let current=true;const flow=await started(()=>{if(!current)throw new Error('Changed view');});const rejection=expect(flow.result).rejects.toThrow();
  if(reason==='cancel')flow.cancel();if(reason==='close')Object.defineProperty(popup,'closed',{value:true});if(reason==='session')advanceBrowserSessionRevision();if(reason==='view')current=false;
  await vi.advanceTimersByTimeAsync(reason==='timeout'?600000:500);await rejection;expect(vi.getTimerCount()).toBe(0);expect(popup.close).toHaveBeenCalled();message();expect(apiClient.get).toHaveBeenCalledTimes(1);
 });
 it.each([{authUrl:'javascript:alert(1)',state},{authUrl:'https://github.com/?state=wrong',state},{authUrl:`https://github.com/?state=${state}`,state:'wrong'}])('rejects invalid authorization before navigation',async response=>{
  vi.mocked(apiClient.get).mockResolvedValue(response);const flow=beginGitOAuth('github','user-1',()=>{});await expect(flow.result).rejects.toThrow(/not verified/);expect(popup.location.replace).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('does not accept a supplied valid-looking message without matching authenticated readback',async()=>{
  const flow=await started();vi.mocked(apiClient.get).mockResolvedValue({...credential,id:'another'});const rejection=expect(flow.result).rejects.toThrow(/not verified/);message();await rejection;expect(vi.getTimerCount()).toBe(0);
 });
 it('reports a matching callback failure without reading credentials',async()=>{
  const flow=await started();const rejection=expect(flow.result).rejects.toThrow('failed');message({}, {type:GIT_OAUTH_FAILED,state});await rejection;expect(apiClient.get).toHaveBeenCalledTimes(1);
 });
});
