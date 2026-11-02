import React from 'react';
import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import GitConnections from '@src/pages/settings/GitConnections';
import { apiClient } from '@src/shared/api/client';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { gitCredentialFixture as credential,gitProviderFixture as provider } from '@test/fixtures/gitCredentials';
const state=vi.hoisted(()=>({userId:'user-1',notify:vi.fn()}));
vi.mock('@src/shared/hooks/useAuth',()=>({useAuth:()=>({user:{id:state.userId},permissions:null,sessionRevision:1})}));
vi.mock('@src/shared/notifications/ToastProvider',()=>({useToast:()=>({notify:state.notify})}));
vi.mock('@src/shared/api/client',async original=>({...await original<typeof import('@src/shared/api/client')>(),apiClient:{get:vi.fn(),post:vi.fn(),patch:vi.fn(),delete:vi.fn()}}));
vi.mock('@carbon/react',()=>({
 Modal:({open,children,modalHeading,primaryButtonText,primaryButtonDisabled,onRequestSubmit,onRequestClose}:any)=>open?<div role="dialog" aria-label={modalHeading}>{children}<button disabled={primaryButtonDisabled} onClick={onRequestSubmit}>{primaryButtonText}</button><button onClick={onRequestClose}>Cancel</button></div>:null,
 Button:({children,onClick,disabled}:any)=><button onClick={onClick} disabled={disabled}>{children}</button>,
 TextInput:({id,labelText,value,onChange,disabled,type}:any)=><label>{labelText}<input id={id} value={value} onChange={onChange} disabled={disabled} type={type}/></label>,
 Select:({children,id,labelText,value,onChange,disabled}:any)=><label>{labelText}<select id={id} value={value} onChange={onChange} disabled={disabled}>{children}</select></label>,SelectItem:({value,text}:any)=><option value={value}>{text}</option>,
 RadioButtonGroup:({children,onChange,disabled}:any)=><div>{React.Children.map(children,child=>React.isValidElement(child)?React.cloneElement(child as any,{onSelect:onChange,parentDisabled:disabled}):child)}</div>,RadioButton:({labelText,value,onSelect,disabled,parentDisabled}:any)=><button disabled={disabled||parentDisabled} onClick={()=>onSelect(value)}>{labelText}</button>,
 InlineNotification:({title,subtitle}:any)=><p>{title}: {subtitle}</p>,Tag:({children}:any)=><span>{children}</span>,OverflowMenu:({children}:any)=><span>{children}</span>,OverflowMenuItem:({itemText,onClick}:any)=><button onClick={onClick}>{itemText}</button>,
 DataTable:({rows,headers,children}:any)=>children({rows:rows.map((r:any)=>({...r,cells:headers.map((h:any)=>({id:r.id+h.key,info:{header:h.key},value:r[h.key]}))})),headers,getTableProps:()=>({}),getHeaderProps:()=>({}),getRowProps:()=>({}),getToolbarProps:()=>({})}),
 Table:({children}:any)=><table>{children}</table>,TableHead:({children}:any)=><thead>{children}</thead>,TableBody:({children}:any)=><tbody>{children}</tbody>,TableRow:({children}:any)=><tr>{children}</tr>,TableHeader:({children}:any)=><th>{children}</th>,TableCell:({children}:any)=><td>{children}</td>,
 TableContainer:({children}:any)=><div>{children}</div>,TableToolbar:({children}:any)=><div>{children}</div>,TableToolbarContent:({children}:any)=><div>{children}</div>,TableToolbarSearch:()=>null,DataTableSkeleton:()=> <p>Loading</p>,
}));
let rows:unknown[];
beforeEach(()=>{vi.clearAllMocks();state.userId='user-1';rows=[];vi.mocked(apiClient.get).mockImplementation(async(url:string)=>url==='/git-api/credentials'?rows:[provider]);vi.mocked(apiClient.post).mockResolvedValue(credential);vi.mocked(apiClient.patch).mockResolvedValue({success:true});vi.mocked(apiClient.delete).mockResolvedValue(undefined);});
function fixture(){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const tree=()=> <QueryClientProvider client={client}><GitConnections embedded/></QueryClientProvider>;return {...render(tree()),tree,client};}
async function add(){await waitFor(()=>expect(screen.getByRole('button',{name:'Connect Provider'})).toBeEnabled());await userEvent.click(screen.getByRole('button',{name:'Connect Provider'}));await userEvent.selectOptions(screen.getByLabelText('Git Provider'),'github');await userEvent.type(screen.getByLabelText('Personal Access Token'),'synthetic-token');}
async function openCredential(name:string){await screen.findByText('Work');await userEvent.click(screen.getByRole('button',{name}));}
describe('personal Git credential settings wiring',()=>{
 it('does not announce success or clear its form for an invalid save receipt',async()=>{
  vi.mocked(apiClient.post).mockResolvedValue({});fixture();await add();await userEvent.click(screen.getByRole('button',{name:'Connect'}));
  expect(await screen.findByText(/Git credential response was not verified/)).toBeVisible();expect(screen.getByLabelText('Personal Access Token')).toHaveValue('synthetic-token');expect(state.notify).not.toHaveBeenCalledWith(expect.objectContaining({kind:'success'}));
 });
 it.each(['cancel','user','session'])('ignores late writes after %s changes',async change=>{
  let finish!:(value:unknown)=>void;vi.mocked(apiClient.post).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const f=fixture();const invalidate=vi.spyOn(f.client,'invalidateQueries');await add();await userEvent.click(screen.getByRole('button',{name:'Connect'}));await waitFor(()=>expect(apiClient.post).toHaveBeenCalledTimes(1));
  if(change==='cancel'){await userEvent.click(screen.getByRole('button',{name:'Cancel'}));await add();}
  else if(change==='user'){state.userId='user-2';f.rerender(f.tree());}else advanceBrowserSessionRevision();
  await act(async()=>finish(credential));expect(invalidate).not.toHaveBeenCalled();expect(state.notify).not.toHaveBeenCalled();
  if(change==='cancel'){expect(screen.getByLabelText('Personal Access Token')).toHaveValue('synthetic-token');expect(screen.getByRole('button',{name:'Connect'})).toBeEnabled();}
 });
 it('owns the captured PAT request, accepts its canonical receipt and keeps token requests out of mutation cache',async()=>{
  const f=fixture();await add();await userEvent.type(screen.getByLabelText('Connection Name (Optional)'),'Work');await userEvent.click(screen.getByRole('button',{name:'Connect'}));
  await waitFor(()=>expect(state.notify).toHaveBeenCalledWith({kind:'success',title:'Git provider connected'}));expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/git-api/credentials',{providerId:'github',token:'synthetic-token',name:'Work'});expect(f.client.getMutationCache().getAll()).toHaveLength(0);
 });
 it.each(['Rename','Update Token','Disconnect'])('validates the %s action response',async action=>{
  rows=[credential];vi.mocked(apiClient.post).mockResolvedValue({});vi.mocked(apiClient.patch).mockResolvedValue({});vi.mocked(apiClient.delete).mockResolvedValue({} as any);fixture();await openCredential(action);
  if(action==='Rename'){await userEvent.clear(screen.getByLabelText('Connection Name'));await userEvent.type(screen.getByLabelText('Connection Name'),'Renamed');await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Save'}));}
  else if(action==='Update Token'){await userEvent.type(screen.getByLabelText('New Personal Access Token'),'synthetic-new-token');await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Update Token'}));}
  else await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Disconnect'}));
  expect(await screen.findByText(/response was not verified/)).toBeVisible();expect(state.notify).not.toHaveBeenCalledWith(expect.objectContaining({kind:'success'}));
 });
 it('rejects a foreign owner row instead of caching/showing it',async()=>{rows=[{...credential,userId:'foreign'}];const f=fixture();expect(await screen.findByText(/Git credential list was not verified/)).toBeVisible();expect(screen.queryByText('Work')).not.toBeInTheDocument();expect(JSON.stringify(f.client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain('foreign');});
 it('does not reuse the prior principal rows',async()=>{rows=[credential];const f=fixture();await screen.findByText('Work');state.userId='user-2';rows=[];f.rerender(f.tree());expect(screen.queryByText('Work')).not.toBeInTheDocument();expect(await screen.findByText('No Git Providers Connected')).toBeVisible();});
 it('refuses ambiguous provider token replacement while still allowing canonical separate credential rows',async()=>{
  rows=[credential,{...credential,id:'credential-2',name:'Second'}];fixture();await screen.findByText('Second');
  await userEvent.click(screen.getAllByRole('button',{name:'Update Token'})[0]);await userEvent.type(screen.getByLabelText('New Personal Access Token'),'synthetic-new-token');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Update Token'}));expect(await screen.findByText(/cannot identify one saved connection/)).toBeVisible();expect(apiClient.post).not.toHaveBeenCalled();
 });
 it('does not fetch or display personal credentials without a current user identity',async()=>{state.userId='';rows=[credential];fixture();await act(async()=>{});expect(apiClient.get).not.toHaveBeenCalled();expect(screen.queryByText('Work')).not.toBeInTheDocument();});
 it('does not report a late result to a changed provider intent even if a delayed input event reaches a disabled control',async()=>{
  let finish!:(raw:unknown)=>void;vi.mocked(apiClient.post).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));fixture();await add();await userEvent.click(screen.getByRole('button',{name:'Connect'}));
  await waitFor(()=>expect(apiClient.post).toHaveBeenCalledTimes(1));fireEvent.change(screen.getByLabelText('Git Provider'),{target:{value:''}});
  await act(async()=>finish(credential));expect(state.notify).not.toHaveBeenCalled();expect(screen.queryByText(/context changed/)).not.toBeInTheDocument();
 });
 it('does not use a legacy oauth_success flag as completion',async()=>{sessionStorage.setItem('oauth_success','unrelated-old-flag');fixture();await add();expect(state.notify).not.toHaveBeenCalled();sessionStorage.clear();});
});
