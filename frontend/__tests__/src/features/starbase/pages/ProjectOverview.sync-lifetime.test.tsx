import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectOverview from '@src/features/starbase/pages/ProjectOverview';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { projectsApi } from '@src/api/starbase/projects';
import { apiClient } from '@src/shared/api/client';

const state=vi.hoisted(()=>({userId:'user-1',snapshot:undefined as any,cancelSelection:vi.fn()}));
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
vi.mock('@src/shared/hooks/useAuth',()=>({useAuth:()=>({user:{id:state.userId},permissions:state.snapshot,hasProjectPermission:()=>true,hasPlatformPermission:()=>true})}));
vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings',()=>({usePlatformSyncSettings:()=>({data:{syncPushEnabled:true,syncPullEnabled:true,gitProjectTokenSharingEnabled:true}})}));
vi.mock('@src/shared/api/client',async original=>({...await original<typeof import('@src/shared/api/client')>(),apiClient:{get:vi.fn().mockResolvedValue({statuses:{}}),post:vi.fn()}}));
vi.mock('@src/shared/api/fetchList',()=>({fetchList:vi.fn(async(url:string)=>url==='/starbase-api/projects'?[{id:ids[0],name:'A',gitUrl:'https://example.invalid/a',createdAt:1,updatedAt:1},{id:ids[1],name:'B',gitUrl:'https://example.invalid/b',createdAt:1,updatedAt:1}]:[])}));
vi.mock('@src/api/starbase/projects',()=>({projectsApi:{getMyMembership:vi.fn().mockResolvedValue({userId:'user-1',roles:['owner'],role:'owner',deployAllowed:true})}}));
vi.mock('@src/features/starbase/pages/components/ProjectOverviewTable',()=>({ProjectOverviewTable:({onBulkSync}:any)=><button onClick={()=>onBulkSync(ids,state.cancelSelection)}>Select projects</button>}));
vi.mock('@src/features/starbase/pages/components/ProjectOverviewBulkSyncModal',()=>({ProjectOverviewBulkSyncModal:(p:any)=>p.open?<div role="dialog"><label>Batch message<input value={p.bulkMessage} onChange={e=>p.setBulkMessage(e.target.value)}/></label><button disabled={p.bulkBusy||!p.bulkMessage} onClick={p.onSubmit}>Run batch</button><button onClick={p.onClose}>Cancel batch</button>{p.bulkError&&<p>{p.bulkError}</p>}{p.bulkResult&&<p>Result: {p.bulkResult.succeeded.length} succeeded, {p.bulkResult.failed.length} failed</p>}</div>:null}));
vi.mock('@src/features/starbase/pages/components/ProjectOverviewModals',()=>({ProjectOverviewModals:()=>null}));
vi.mock('@src/features/git/components',()=>({CreateOnlineProjectModal:()=>null}));
vi.mock('@src/features/git/components/DeployDialog',()=>({default:()=>null}));
vi.mock('@src/features/git/components/ProjectGitSettings',()=>({ProjectGitSettings:()=>null}));
const receipt={success:true,pushed:true,pulled:false,filesChanged:1,commitSha:'abcdef1'};
function fixture(){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const tree=()=> <MemoryRouter><QueryClientProvider client={client}><ProjectOverview/></QueryClientProvider></MemoryRouter>;return {...render(tree()),tree,client};}
beforeEach(()=>{vi.clearAllMocks();state.userId='user-1';state.snapshot=undefined;vi.mocked(projectsApi.getMyMembership).mockResolvedValue({userId:'user-1',roles:['owner'],role:'owner',deployAllowed:true} as any);vi.mocked(apiClient.post).mockResolvedValue(receipt);});
async function begin(){await userEvent.click(await screen.findByRole('button',{name:'Select projects'}));await userEvent.type(screen.getByLabelText('Batch message'),'Reviewed batch');await userEvent.click(screen.getByRole('button',{name:'Run batch'}));await waitFor(()=>expect(apiClient.post).toHaveBeenCalled());}

describe('bulk sync controller ownership',()=>{
 it.each(['cancel','reopen','user'])('stops the queue after %s without changing a replacement view',async change=>{
  let finish!:(value:unknown)=>void;vi.mocked(apiClient.post).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const f=fixture();await begin();
  if(change==='user'){state.userId='user-2';f.rerender(f.tree());}
  else {await userEvent.click(screen.getByRole('button',{name:'Cancel batch'}));if(change==='reopen'){await userEvent.click(screen.getByRole('button',{name:'Select projects'}));await userEvent.type(screen.getByLabelText('Batch message'),'Replacement');}}
  await act(async()=>finish(receipt));expect(apiClient.post).toHaveBeenCalledTimes(1);expect(state.cancelSelection).not.toHaveBeenCalled();
  if(change==='reopen'){expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByRole('button',{name:'Run batch'})).toBeEnabled();expect(screen.queryByText(/Result:/)).not.toBeInTheDocument();}
  else expect(screen.queryByRole('dialog')).not.toBeInTheDocument();f.unmount();f.client.clear();
 });
 it('reports an invalid acknowledgement as failed rather than marking both projects successful',async()=>{
  vi.mocked(apiClient.post).mockResolvedValueOnce({});const f=fixture();await begin();
  expect(await screen.findByText('Result: 1 succeeded, 1 failed')).toBeVisible();expect(apiClient.post).toHaveBeenCalledTimes(2);expect(state.cancelSelection).not.toHaveBeenCalled();f.unmount();f.client.clear();
 });
 it('clears the confirmed selection only after both valid receipts',async()=>{
  const f=fixture();await begin();await waitFor(()=>expect(state.cancelSelection).toHaveBeenCalledTimes(1));expect(apiClient.post).toHaveBeenCalledTimes(2);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();f.unmount();f.client.clear();
 }); it('refuses batch confirmation from an authority rendered before the browser session changed',async()=>{
  const f=fixture();await userEvent.click(await screen.findByRole('button',{name:'Select projects'}));await userEvent.type(screen.getByLabelText('Batch message'),'Reviewed batch');
  advanceBrowserSessionRevision();await userEvent.click(screen.getByRole('button',{name:'Run batch'}));expect(apiClient.post).not.toHaveBeenCalled();f.unmount();f.client.clear();
 });
 it('does not bypass an explicit sync restriction while membership presentation is still loading',async()=>{
  vi.mocked(projectsApi.getMyMembership).mockImplementation(()=>new Promise(()=>{}));
  state.snapshot={userId:'user-1',platform:[],engines:[],projects:[{resourceId:ids[0],permissions:['project:git:push'],actionAvailability:{allowedActions:[],restrictions:{'project.git.sync.run':{reason:'Managed sync restriction',reasonCode:'policy_denied'}}}}]};
  const f=fixture();await userEvent.click(await screen.findByRole('button',{name:'Select projects'}));await userEvent.type(screen.getByLabelText('Batch message'),'Restricted batch');await userEvent.click(screen.getByRole('button',{name:'Run batch'}));expect(apiClient.post).not.toHaveBeenCalled();f.unmount();f.client.clear();
 });

});
