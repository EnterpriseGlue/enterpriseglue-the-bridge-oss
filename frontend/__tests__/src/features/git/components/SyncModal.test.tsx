import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import SyncModal from '@src/features/git/components/SyncModal';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { apiClient } from '@src/shared/api/client';

const state = vi.hoisted(() => ({ allowed: true, revision: 0, userId: 'user-1', sharing: true, foreignRepo: false, snapshot: undefined as any, push: undefined as boolean | undefined, pull: undefined as boolean | undefined }));
vi.mock('@carbon/react', () => ({
  Modal: ({ open, children, modalHeading, primaryButtonText, primaryButtonDisabled, onRequestSubmit, onRequestClose }: any) => open ? <div role="dialog"><h1>{modalHeading}</h1>{children}<button disabled={primaryButtonDisabled} onClick={onRequestSubmit}>{primaryButtonText}</button><button onClick={onRequestClose}>Cancel</button></div> : null,
  TextArea: ({ id, labelText, value, onChange }: any) => <label>{labelText}<textarea id={id} value={value} onChange={onChange}/></label>,
  RadioButtonGroup: ({ children, onChange }: any) => <div>{React.Children.map(children, child => React.isValidElement(child) ? React.cloneElement(child as any, { onSelect: onChange }) : child)}</div>,
  RadioButton: ({ value, labelText, onSelect }: any) => <button onClick={() => onSelect(value)}>{labelText}</button>,
  InlineNotification: ({ title, subtitle }: any) => <div role="alert">{title}: {subtitle}</div>,
  InlineLoading: ({ description }: any) => <div>{description}</div>, Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>, Tag: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('@src/shared/api/client', async original => ({ ...await original<typeof import('@src/shared/api/client')>(), apiClient: { get: vi.fn().mockResolvedValue({ valid: true }), post: vi.fn() } }));
vi.mock('@src/shared/api/fetchList', () => ({ fetchList: vi.fn(async (_url: string, params: any) => [{ id: 'repo-1', projectId: state.foreignRepo ? 'foreign' : params.projectId, providerId: 'provider-1', remoteUrl: 'https://example.invalid/repo', repositoryName: 'repo', defaultBranch: 'main', lastSyncAt: 1, lastCommitSha: 'abc1234' }]) }));
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.userId }, permissions: state.snapshot, sessionRevision: state.revision, hasProjectPermission: (_id: string, permission: string) => permission === 'project:git:pull' ? state.pull ?? state.allowed : state.push ?? state.allowed }) }));
vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({ usePlatformSyncSettings: () => ({ data: { syncPushEnabled: true, syncPullEnabled: true, gitProjectTokenSharingEnabled: state.sharing } }) }));
const projectId = '11111111-1111-4111-8111-111111111111';
function fixture(strict = false) {
 const onClose = vi.fn(), onSuccess = vi.fn(), client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 const tree=(props: any={})=><MemoryRouter><QueryClientProvider client={client}><SyncModal open projectId={projectId} projectName="Fixture" onClose={onClose} onSuccess={onSuccess} {...props}/></QueryClientProvider></MemoryRouter>;
 return { ...render(strict ? <React.StrictMode>{tree()}</React.StrictMode> : tree()),tree,onClose,onSuccess,client };
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(apiClient.get).mockResolvedValue({valid:true});Object.assign(state,{allowed:true,revision:0,userId:'user-1',sharing:true,foreignRepo:false,snapshot:undefined,push:undefined,pull:undefined});vi.mocked(apiClient.post).mockResolvedValue({success:true,pushed:true,pulled:false,filesChanged:1,commitSha:'abcdef1'});});

describe('manual Git sync acknowledgement',()=>{
 it('does not report success for an unverified sync response',async()=>{
  vi.mocked(apiClient.post).mockResolvedValue({}); const f=fixture();
  await userEvent.type(screen.getByLabelText('Version message'),'Reviewed sync');
  await userEvent.click(await screen.findByRole('button',{name:'Sync Now'}));
  expect(await screen.findByText(/Sync response was not verified/)).toBeVisible();
  expect(f.onClose).not.toHaveBeenCalled();expect(f.onSuccess).not.toHaveBeenCalled();f.unmount();f.client.clear();
 }); it('submits the confirmed project and verified response once',async()=>{
  const f=fixture();await userEvent.type(screen.getByLabelText('Version message'),'Reviewed sync');
  await userEvent.click(await screen.findByRole('button',{name:'Sync Now'}));
  await waitFor(()=>expect(f.onSuccess).toHaveBeenCalledTimes(1));expect(f.onClose).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/git-api/sync',{projectId,direction:'push',message:'Reviewed sync'});f.unmount();f.client.clear();
 });
 it.each(['project-return','closed','cancel','unmount','session','permission','user'])('does not apply a late response after %s',async change=>{
  let finish!:(value: unknown)=>void;vi.mocked(apiClient.post).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const f=fixture();await userEvent.type(screen.getByLabelText('Version message'),'Reviewed sync');await userEvent.click(await screen.findByRole('button',{name:'Sync Now'}));
  await waitFor(()=>expect(apiClient.post).toHaveBeenCalledTimes(1));
  if(change==='project-return'){f.rerender(f.tree({projectId:'22222222-2222-4222-8222-222222222222'}));f.rerender(f.tree());}
  if(change==='closed')f.rerender(f.tree({open:false}));
  if(change==='cancel')await userEvent.click(screen.getByRole('button',{name:'Cancel'}));
  if(change==='unmount')f.unmount();
  if(change==='session')advanceBrowserSessionRevision();
  if(change==='permission'){state.allowed=false;state.revision++;f.rerender(f.tree());}
  if(change==='user'){state.userId='user-2';state.revision++;f.rerender(f.tree());}
  await act(async()=>finish({success:true,pushed:true,pulled:false,filesChanged:1,commitSha:'abcdef1'}));
  expect(f.onSuccess).not.toHaveBeenCalled();expect(f.onClose).toHaveBeenCalledTimes(change==='cancel'?1:0);f.unmount();f.client.clear();
 });
 it('refuses a foreign repository returned by a list adapter',async()=>{
  state.foreignRepo=true;const f=fixture();expect(await screen.findByText(/No Remote Repository/)).toBeVisible();
  expect(screen.getByRole('button',{name:'Sync Now'})).toBeDisabled();expect(apiClient.post).not.toHaveBeenCalled();f.unmount();f.client.clear();
 });
 it('requires fresh personal credential validation when the user changes',async()=>{
  state.sharing=false;let finish!:(value:unknown)=>void;let validations=0;
  vi.mocked(apiClient.get).mockImplementation(async(url:string)=>{
    if(url.includes('/validate')){validations++;if(validations===2)return new Promise(resolve=>{finish=resolve;});return {valid:true};}
    return {hasLocalChanges:false,hasRemoteChanges:false,lastSyncAt:1,localCommitCount:0,remoteCommitCount:0};
  });
  const f=fixture();await userEvent.type(screen.getByLabelText('Version message'),'User one');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Sync Now'})).toBeEnabled());
  state.userId='user-2';state.revision++;f.rerender(f.tree());await userEvent.type(screen.getByLabelText('Version message'),'User two');
  await waitFor(()=>expect(validations).toBe(2));expect(screen.getByRole('button',{name:'Sync Now'})).toBeDisabled();
  await act(async()=>finish({valid:false}));expect(screen.getByRole('button',{name:'Sync Now'})).toBeDisabled();expect(apiClient.post).not.toHaveBeenCalled();f.unmount();f.client.clear();
 });
 it('refuses confirmation from a rendered authority after the browser session changed',async()=>{
  const f=fixture();await userEvent.type(screen.getByLabelText('Version message'),'Reviewed sync');await waitFor(()=>expect(screen.getByRole('button',{name:'Sync Now'})).toBeEnabled());
  advanceBrowserSessionRevision();await userEvent.click(screen.getByRole('button',{name:'Sync Now'}));expect(apiClient.post).not.toHaveBeenCalled();f.unmount();f.client.clear();
 });
 it('keeps a fresh confirmation usable after StrictMode effect remounting',async()=>{
  const f=fixture(true);await userEvent.type(screen.getByLabelText('Version message'),'Reviewed strict sync');await waitFor(()=>expect(screen.getByRole('button',{name:'Sync Now'})).toBeEnabled());await userEvent.click(screen.getByRole('button',{name:'Sync Now'}));await waitFor(()=>expect(f.onSuccess).toHaveBeenCalledTimes(1));expect(apiClient.post).toHaveBeenCalledTimes(1);f.unmount();f.client.clear();
 });
 it('does not infer pull permission from an allowed push sync action',async()=>{
  state.pull=false;state.snapshot={userId:'user-1',platform:[],engines:[],projects:[{resourceId:projectId,permissions:['project:git:push'],actionAvailability:{allowedActions:['project.git.sync.run'],restrictions:{}}}]};
  const f=fixture();await userEvent.type(screen.getByLabelText('Version message'),'Reviewed pull');await userEvent.click(screen.getByRole('button',{name:/Pull from Remote/}));
  expect(screen.getByRole('button',{name:'Sync Now'})).toBeDisabled();expect(apiClient.post).not.toHaveBeenCalled();f.unmount();f.client.clear();
 });
 it('preserves explicit action restrictions even when the legacy permission fallback is true',async()=>{
  state.snapshot={userId:'user-1',platform:[],engines:[],projects:[{resourceId:projectId,permissions:['project:git:push'],actionAvailability:{allowedActions:[],restrictions:{'project.git.sync.run':{reason:'Managed sync restriction',reasonCode:'policy_denied'}}}}]};
  const f=fixture();await userEvent.type(screen.getByLabelText('Version message'),'Restricted sync');
  expect(screen.getByRole('button',{name:'Sync Now'})).toBeDisabled();expect(screen.getByText(/Managed sync restriction/)).toBeVisible();expect(apiClient.post).not.toHaveBeenCalled();f.unmount();f.client.clear();
 });
 it('keeps an independently permitted pull usable without push permission',async()=>{
  state.push=false;state.pull=true;vi.mocked(apiClient.post).mockResolvedValue({success:true,pushed:false,pulled:true,filesChanged:1});
  const f=fixture();await userEvent.type(screen.getByLabelText('Version message'),'Reviewed pull');await userEvent.click(screen.getByRole('button',{name:/Pull from Remote/}));await userEvent.click(screen.getByRole('button',{name:'Sync Now'}));
  await waitFor(()=>expect(f.onSuccess).toHaveBeenCalledTimes(1));expect(apiClient.post).toHaveBeenCalledWith('/git-api/sync',{projectId,direction:'pull',message:'Reviewed pull'});f.unmount();f.client.clear();
 });

});
