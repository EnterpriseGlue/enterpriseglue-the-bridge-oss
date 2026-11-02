import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeMigrationAsync, executeMigrationDirect } from '../../../../../packages/backend-host/src/modules/mission-control/migration/service.js'
import { postMigrationExecute, postMigrationExecuteAsync } from '@enterpriseglue/shared/services/bpmn-engine-client.js'
const insert=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined))
vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js',()=>({postMigrationGenerate:vi.fn(),postMigrationValidate:vi.fn(),postMigrationExecute:vi.fn(),postMigrationExecuteAsync:vi.fn().mockResolvedValue({id:'engine-batch'}),getProcessInstanceActivityTree:vi.fn(),getProcessInstanceCount:vi.fn()}))
vi.mock('@enterpriseglue/shared/db/data-source.js',()=>({getDataSource:async()=>({getRepository:()=>({insert})})}))
beforeEach(()=>{vi.clearAllMocks();vi.mocked(postMigrationExecuteAsync).mockResolvedValue({id:'engine-batch'})})
describe('migration execution engine envelope',()=>{
  it.each(['direct','batch'] as const)('puts reviewed variables inside the engine migrationPlan for %s',async mode=>{
    const variables={details:{type:'Json',value:'{"reviewed":true}'},count:{type:'Long',value:42}}
    const body={plan:{sourceProcessDefinitionId:'src',targetProcessDefinitionId:'tgt',instructions:[{sourceActivityIds:['a'],targetActivityIds:['b']}]},processInstanceIds:['owned'],variables,skipCustomListeners:true,skipIoMappings:false,auditReason:'Reviewed'}
    await (mode==='direct'?executeMigrationDirect:executeMigrationAsync)('engine-owned',body)
    const call=vi.mocked(mode==='direct'?postMigrationExecute:postMigrationExecuteAsync).mock.calls[0]
    expect(call[0]).toBe('engine-owned')
    expect(call[1]).toEqual({migrationPlan:{...body.plan,updateEventTriggers:false,instructions:[{...body.plan.instructions[0],updateEventTrigger:false}],variables},processInstanceIds:['owned'],skipCustomListeners:true,skipIoMappings:false})
    expect(call[1]).not.toHaveProperty('variables')
    expect(body.plan).not.toHaveProperty('variables')
    expect(insert).toHaveBeenCalledTimes(mode==='batch'?1:0)
  })
  it.each([undefined,{}, {id:''},{id:' foreign '}])('does not record a phantom local batch for an unverified engine acknowledgement %j',async ack=>{
    vi.mocked(postMigrationExecuteAsync).mockResolvedValue(ack as never)
    await expect(executeMigrationAsync('owned',{plan:{sourceProcessDefinitionId:'src',targetProcessDefinitionId:'tgt',instructions:[]},auditReason:'Reviewed'})).rejects.toThrow('could not be verified')
    expect(insert).not.toHaveBeenCalled()
    expect(postMigrationExecuteAsync).toHaveBeenCalledOnce()
  })

})
