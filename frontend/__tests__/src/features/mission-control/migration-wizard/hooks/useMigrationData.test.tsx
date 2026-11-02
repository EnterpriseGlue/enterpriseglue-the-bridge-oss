import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '@src/contexts/AuthContext'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMigrationData } from '@src/features/mission-control/migration-wizard/hooks/useMigrationData'
import { apiClient } from '@src/shared/api/client'
import { MigrationExecuteRequestSchema } from '@enterpriseglue/shared/schemas/mission-control/migration.js'

const engineSelection = vi.hoisted(() => ({ engineId: 'engine-a' as string | undefined }))
const notify = vi.hoisted(() => vi.fn())
const tenantNavigate = vi.hoisted(() => vi.fn())

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => engineSelection.engineId,
}))

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({ tenantNavigate }),
}))

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify }),
}))

vi.mock('@src/shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/shared/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('@src/features/mission-control/shared/api/definitions', () => ({
  fetchProcessDefinitionXml: vi.fn().mockResolvedValue('<definitions />'),
}))

const authState={isAuthenticated:true,isLoading:false,user:{id:'reader'},sessionRevision:1,permissions:null} as any

const definitions = [
  { id: 'orders:1', key: 'orders', name: 'Orders', version: 1 },
  { id: 'orders:2', key: 'orders', name: 'Orders', version: 2 },
]

const plan = {
  sourceProcessDefinitionId: 'orders:1',
  targetProcessDefinitionId: 'orders:2',
  instructions: [{ sourceActivityIds: ['review'], targetActivityIds: ['approve'] }],
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <AuthContext.Provider value={authState}><MemoryRouter initialEntries={['/t/a/mission-control/migration/new?engineId=engine-a']}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MemoryRouter></AuthContext.Provider>
  )
}

describe('useMigrationData engine boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(authState,{isAuthenticated:true,isLoading:false,user:{id:'reader'},sessionRevision:1,permissions:null})
    engineSelection.engineId = 'engine-a'
    vi.mocked(apiClient.get).mockResolvedValue(definitions)
    vi.mocked(apiClient.post).mockImplementation(async (path: string) => {
      if (path.endsWith('/generate')) return plan as never
      if (path.endsWith('/active-sources')) return { review: 1 } as never
      if (path.endsWith('/preview')) return { count: 1 } as never
      if (path.endsWith('/plan/validate')) return { instructionReports: [] } as never
      if (path.endsWith('/execute-async')) return { id: 'batch-1', type: 'MIGRATE_INSTANCES' } as never
      if (path.endsWith('/execute-direct')) return {ok:true} as never
      throw new Error(`Unexpected request: ${path}`)
    })
  })

  it('isolates active-source query state by engine identity', async () => {
    const queryClient = createQueryClient()
    const first = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/mission-control-api/migration/active-sources',
      { engineId: 'engine-a', processInstanceIds: ['pi-1'] },
      { credentials: 'include' },
    ))
    first.unmount()

    engineSelection.engineId = 'engine-b'
    renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-b', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/mission-control-api/migration/active-sources',
      { engineId: 'engine-b', processInstanceIds: ['pi-1'] },
      { credentials: 'include' },
    ))
    const cached=queryClient.getQueryCache().getAll().filter(q=>q.queryKey[2]==='active-src')
    expect(cached).toHaveLength(2)
    expect(cached[0].queryKey).not.toEqual(cached[1].queryKey)
  })

  it('invalidates a prepared plan and refuses execution after an engine switch', async () => {
    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(result.current.plan).toEqual(plan))
    await waitFor(() => expect(result.current.previewQ.data).toEqual({ count: 1 }))


    engineSelection.engineId = 'engine-b'
    rerender()

    await expect(result.current.executeMutation.mutateAsync('approved change')).rejects.toThrow(
      /Review the current|selection|context/i,
    )
    await expect(result.current.executeDirectMutation.mutateAsync('approved change')).rejects.toThrow(
      /Review the current|selection|context/i,
    )
    expect(vi.mocked(apiClient.post).mock.calls.filter(([path]) => path === '/mission-control-api/migration/execute-async')).toHaveLength(0)
    expect(vi.mocked(apiClient.post).mock.calls.filter(([path]) => path === '/mission-control-api/migration/execute-direct')).toHaveLength(0)
    await waitFor(() => expect(result.current.plan).toBeNull())
    expect(result.current.instanceIds).toEqual([])
  })

  it('does not restore legacy selected instances that have no origin engine identity', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-legacy'], preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )

    await waitFor(() => expect(result.current.defsQ.isSuccess).toBe(true))
    expect(result.current.instanceIds).toEqual([])
    expect(vi.mocked(apiClient.post).mock.calls.some(([path]) => path === '/mission-control-api/migration/active-sources')).toBe(false)
  })

  it('ignores a plan response that resolves after the selected engine changed', async () => {
    let resolveGenerate: ((value: typeof plan) => void) | undefined
    vi.mocked(apiClient.post).mockImplementation(async (path: string) => {
      if (path.endsWith('/generate')) {
        return await new Promise<typeof plan>((resolve) => { resolveGenerate = resolve }) as never
      }
      if (path.endsWith('/active-sources')) return { review: 1 } as never
      throw new Error(`Unexpected request: ${path}`)
    })
    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(resolveGenerate).toBeTypeOf('function'))

    engineSelection.engineId = 'engine-b'
    rerender()
    await act(async () => resolveGenerate?.(plan))

    await waitFor(() => expect(result.current.generating).toBe(false))
    expect(result.current.plan).toBeNull()
  })

  it('keeps successful batch navigation qualified to the migration engine', async () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(result.current.plan).toEqual(plan))

    await waitFor(()=>expect(result.current.canReview).toBe(true))
    await act(async()=>result.current.validateMutation.mutateAsync())
    await act(async () => result.current.executeMutation.mutateAsync('approved change'))

    expect(tenantNavigate).toHaveBeenCalledWith('/mission-control/batches/batch-1?engineId=engine-a')
  })

  it('builds an execution plan accepted by the real shared request schema', async () => {
    const { result } = renderHook(() => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }), { wrapper: wrapperFor(createQueryClient()) })
    await waitFor(() => expect(result.current.planWithOverrides).toBeTruthy())
    expect(MigrationExecuteRequestSchema.safeParse({ engineId: 'engine-a', plan: result.current.planWithOverrides, processInstanceIds: ['pi-1'], auditReason: 'Approved fixture migration' }).success).toBe(true)
  })

  it('does not reuse validation after an instruction override changes', async () => {
    const { result } = renderHook(() => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }), { wrapper: wrapperFor(createQueryClient()) })
    await waitFor(() => expect(result.current.planWithOverrides).toBeTruthy())
    await act(async () => result.current.validateMutation.mutateAsync())
    act(() => result.current.setOverrides({ 0: 'other-task' }))
    try { await act(async () => result.current.executeMutation.mutateAsync('Approved fixture migration')) } catch { /* No dispatch is the assertion. */ }
    expect(vi.mocked(apiClient.post).mock.calls.filter(([path]) => path.endsWith('/execute-async'))).toHaveLength(0)
  })

  it('does not navigate when an execution response completes after an A to B to A switch', async () => {
    let resolveExecute: ((value: { id: string }) => void) | undefined
    vi.mocked(apiClient.post).mockImplementation(async (path: string) => {
      if (path.endsWith('/generate')) return plan as never
      if (path.endsWith('/active-sources')) return { review: 1 } as never
      if (path.endsWith('/preview')) return { count: 1 } as never
      if (path.endsWith('/plan/validate')) return {instructionReports:[]} as never
      if (path.endsWith('/execute-async')) {
        return await new Promise<{ id: string }>((resolve) => { resolveExecute = resolve }) as never
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const queryClient = createQueryClient()
    const { result, rerender } = renderHook(
      () => useMigrationData({ instanceIds: ['pi-1'], originEngineId: 'engine-a', preselectedKey: 'orders', preselectedVersion: 1 }),
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(result.current.plan).toEqual(plan))

    await waitFor(()=>expect(result.current.canReview).toBe(true))
    await act(async()=>result.current.validateMutation.mutateAsync())
    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.executeMutation.mutateAsync('approved change')
      await Promise.resolve()
    })
    engineSelection.engineId = 'engine-b'
    rerender()
    engineSelection.engineId = 'engine-a'
    rerender()
    await act(async () => {
      resolveExecute?.({ id: 'batch-a', type:'MIGRATE_INSTANCES' } as any)
      await pending.catch(()=>{})
    })

    expect(tenantNavigate).not.toHaveBeenCalled()
  })
})


describe('migration reviewed intent ownership',()=>{
  beforeEach(()=>{vi.clearAllMocks();engineSelection.engineId='engine-a';Object.assign(authState,{isAuthenticated:true,isLoading:false,user:{id:'reader'},sessionRevision:1,permissions:null});vi.mocked(apiClient.get).mockResolvedValue(definitions);vi.mocked(apiClient.post).mockImplementation(async(path:string)=>{if(path.endsWith('/generate'))return plan as never;if(path.endsWith('/preview'))return {count:1} as never;if(path.endsWith('/active-sources'))return {review:1} as never;if(path.endsWith('/plan/validate'))return {instructionReports:[]} as never;if(path.endsWith('/execute-async'))return {id:'batch-1',type:'MIGRATE_INSTANCES'} as never;if(path.endsWith('/execute-direct'))return {ok:true} as never;throw Error('Unexpected fixture route');});});
  const make=()=>renderHook(()=>useMigrationData({instanceIds:['pi-1'],originEngineId:'engine-a',preselectedKey:'orders',preselectedVersion:1}),{wrapper:wrapperFor(createQueryClient())});
  async function reviewed(){const f=make();await waitFor(()=>expect(f.result.current.canReview).toBe(true));await act(async()=>f.result.current.validateMutation.mutateAsync());return f;}
  it.each(['mapping','trigger','removed','variables','listeners','io','actor','session','permissions','logout','loading'])('requires a fresh review after %s changes',async change=>{
    const f=await reviewed();
    act(()=>{
      if(change==='mapping')f.result.current.setOverrides({0:'changed'});
      if(change==='trigger')f.result.current.setTriggerOverrides({0:true});
      if(change==='removed')f.result.current.setRemoved({0:true});
      if(change==='variables')f.result.current.setVarRows([{name:'x',type:'String',value:'new',scope:'GLOBAL'}]);
      if(change==='listeners')f.result.current.setSkipCustomListeners(true);
      if(change==='io')f.result.current.setSkipIoMappings(true);
      if(change==='actor')authState.user={id:'other'};
      if(change==='session')authState.sessionRevision++;
      if(change==='permissions')authState.permissions={userId:'reader',authorizationVersion:'new',platform:[],projects:[],engines:[]};
      if(change==='logout')authState.isAuthenticated=false;
      if(change==='loading')authState.isLoading=true;
      f.rerender();
    });
    try{await act(async()=>f.result.current.executeMutation.mutateAsync('Fixture change'));}catch{}
    expect(vi.mocked(apiClient.post).mock.calls.some(([path])=>path.endsWith('/execute-async'))).toBe(false);
  });
  it('does not replay either mode while one execution is pending or after acknowledgement loss',async()=>{
    const f=await reviewed(),normal=vi.mocked(apiClient.post).getMockImplementation()!;let reject!:(error:Error)=>void;
    vi.mocked(apiClient.post).mockImplementation((path,...args)=>path.endsWith('/execute-async')?new Promise((_resolve,no)=>{reject=no;}):normal(path,...args));
    let pending!:Promise<unknown>;
    act(()=>{pending=f.result.current.executeMutation.mutateAsync('Fixture change');void pending.catch(()=>{});});
    await expect(f.result.current.executeDirectMutation.mutateAsync('Other mode')).rejects.toThrow();
    await act(async()=>{reject(Error('Lost acknowledgement'));await pending.catch(()=>{});});
    act(()=>f.result.current.setSkipCustomListeners(true));
    await expect(f.result.current.executeDirectMutation.mutateAsync('Retry')).rejects.toThrow();
    expect(vi.mocked(apiClient.post).mock.calls.filter(([p])=>p.includes('/execute-'))).toHaveLength(1);
    expect(f.result.current.executionError).toContain('not verified');
  });
  it('does not treat an empty or malformed validation body as clean',async()=>{
    const f=make();await waitFor(()=>expect(f.result.current.canReview).toBe(true));const normal=vi.mocked(apiClient.post).getMockImplementation()!;
    vi.mocked(apiClient.post).mockImplementation((path,...args)=>path.endsWith('/plan/validate')?Promise.resolve({} as never):normal(path,...args));
    await act(async()=>{await expect(f.result.current.validateMutation.mutateAsync()).rejects.toThrow();});
    await expect(f.result.current.executeMutation.mutateAsync('Fixture')).rejects.toThrow();
    expect(vi.mocked(apiClient.post).mock.calls.some(([p])=>p.includes('/execute-'))).toBe(false);
  });
  it('does not widen a mismatched handoff into all instances of a source',async()=>{
    engineSelection.engineId='engine-b';const f=make();await waitFor(()=>expect(f.result.current.defsQ.isSuccess).toBe(true));
    act(()=>{f.result.current.setSrcKey('orders');f.result.current.setSrcVer(1);f.result.current.setTgtKey('orders');f.result.current.setTgtVer(2);});
    await expect(f.result.current.executeMutation.mutateAsync('Fixture')).rejects.toThrow();
    expect(f.result.current.selectionError).toBeTruthy();expect(vi.mocked(apiClient.post).mock.calls.some(([p])=>p.includes('/execute-'))).toBe(false);
  });
  it('starts a new generation when the target changes and ignores the old result',async()=>{
    vi.mocked(apiClient.get).mockResolvedValue([...definitions,{id:'orders:3',key:'orders',name:'Orders',version:3}]);
    const normal=vi.mocked(apiClient.post).getMockImplementation()!,pending=new Map<string,(value:any)=>void>();
    vi.mocked(apiClient.post).mockImplementation((path,...args)=>path.endsWith('/generate')?new Promise(resolve=>pending.set((args[0] as any).targetProcessDefinitionId,resolve)):normal(path,...args));
    const f=make();await waitFor(()=>expect(pending.has('orders:3')).toBe(true));
    act(()=>f.result.current.setTgtVer(2));await waitFor(()=>expect(pending.has('orders:2')).toBe(true));
    await act(async()=>pending.get('orders:3')!({...plan,targetProcessDefinitionId:'orders:3'}));expect(f.result.current.basePlan).toBeNull();
    await act(async()=>pending.get('orders:2')!(plan));await waitFor(()=>expect(f.result.current.basePlan?.targetProcessDefinitionId).toBe('orders:2'));
  });
  it('returns a stale validation result when the draft changes during its request',async()=>{
    const f=make();await waitFor(()=>expect(f.result.current.canReview).toBe(true));const normal=vi.mocked(apiClient.post).getMockImplementation()!;let settle!:(value:any)=>void;
    vi.mocked(apiClient.post).mockImplementation((path,...args)=>path.endsWith('/plan/validate')?new Promise(resolve=>{settle=resolve;}):normal(path,...args));
    let validating!:Promise<any>;act(()=>{validating=f.result.current.validateMutation.mutateAsync();});act(()=>f.result.current.setSkipIoMappings(true));
    let result:any;await act(async()=>{settle({instructionReports:[]});result=await validating;});expect(result.stale).toBe(true);expect(f.result.current.reviewApproved).toBe(false);
  });

  it('does not approve variable failures or warnings even when instruction validation is clean', async()=>{
    const f=make();await waitFor(()=>expect(f.result.current.canReview).toBe(true));
    const normal=vi.mocked(apiClient.post).getMockImplementation()!;
    for(const field of ['failures','warnings']){
      vi.mocked(apiClient.post).mockImplementation((path,...args)=>path.endsWith('/plan/validate')?Promise.resolve({instructionReports:[],variableReports:{details:{[field]:['Invalid typed value']}}} as never):normal(path,...args));
      await act(async()=>f.result.current.validateMutation.mutateAsync());
      expect(f.result.current.reviewApproved).toBe(false);
      await expect(f.result.current.executeMutation.mutateAsync('Fixture')).rejects.toThrow();
    }
    expect(vi.mocked(apiClient.post).mock.calls.some(([p])=>p.includes('/execute-'))).toBe(false);
  });

});
