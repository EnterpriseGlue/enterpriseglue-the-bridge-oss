import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '@src/contexts/AuthContext'
import MigrationWizard from '@src/features/mission-control/migration-wizard/components/MigrationWizard'
import { apiClient } from '@src/shared/api/client'

const selection=vi.hoisted(()=>({engineId:undefined as string|undefined}))
vi.mock('@src/components/EngineSelector',()=>({useSelectedEngine:()=>selection.engineId}))
vi.mock('@src/shared/notifications/ToastProvider',()=>({useToast:()=>({notify:vi.fn()})}))
vi.mock('@src/shared/api/client',()=>({apiClient:{get:vi.fn(),post:vi.fn()}}))
vi.mock('@src/features/shared/components/viewer/BpmnViewerWithBadges',()=>({BpmnViewerWithBadges:()=>null}))
vi.mock('@src/features/mission-control/shared/api/definitions',()=>({fetchProcessDefinitionXml:vi.fn().mockResolvedValue('<definitions/>')}))

beforeEach(()=>{
  sessionStorage.clear();vi.clearAllMocks();selection.engineId=undefined
  vi.mocked(apiClient.get).mockResolvedValue([1,2,3].map(version=>({id:`orders:${version}`,key:'orders',name:'Orders',version})))
  vi.mocked(apiClient.post).mockImplementation(async(path,body:any)=>{
    if(path.endsWith('/generate'))return {...body,instructions:[{sourceActivityIds:['review'],targetActivityIds:['review']}]} as never
    if(path.endsWith('/preview'))return {count:1} as never
    if(path.endsWith('/active-sources'))return {review:1} as never
    throw Error('Unexpected handoff fixture request')
  })
})
describe('actual migration wizard handoff',()=>{
  it('retains the selected older source when engine and Carbon items finish loading',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
    const auth={isAuthenticated:true,isLoading:false,user:{id:'reader'},sessionRevision:1,permissions:null} as any
    function Fixture(){return <AuthContext.Provider value={auth}><MemoryRouter initialEntries={[{pathname:'/t/a/mission-control/migration/new',search:'?engineId=engine-a',state:{instanceIds:['instance-owned'],engineId:'engine-a',selectedKey:'orders',selectedVersion:1}}]}><QueryClientProvider client={client}><MigrationWizard/></QueryClientProvider></MemoryRouter></AuthContext.Provider>}
    const view=render(<Fixture/>);act(()=>{selection.engineId='engine-a';view.rerender(<Fixture/>)})
    await waitFor(()=>expect(vi.mocked(apiClient.post).mock.calls.some(([path,body])=>path.endsWith('/preview')&&(body as any).plan.sourceProcessDefinitionId==='orders:1')).toBe(true))
    expect(vi.mocked(apiClient.post).mock.calls.filter(([path])=>path.endsWith('/generate')).every(([,body])=>(body as any).sourceProcessDefinitionId==='orders:1')).toBe(true)
    expect(view.container.querySelector('#src-ver')?.textContent).toContain('1')
  })
})
