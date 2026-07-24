const primaryInstanceId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const sequentialInstanceId = '11111111-2222-4333-8444-555555555555'
const parallelInstanceId = '66666666-7777-4888-8999-000000000000'
const loopInstanceId = '99999999-aaaa-4bbb-8ccc-dddddddddddd'

const decisionDefinition = {
  id: 'invoice-risk:1:mock-decision-definition',
  key: 'invoice-risk',
  name: 'Invoice Risk',
  version: 1,
  versionTag: '1.0.0',
  category: 'mock',
  decisionRequirementsDefinitionId: 'invoice-risk-drd',
  decisionRequirementsDefinitionKey: 'invoice-risk-drd',
  historyTimeToLive: 30,
  tenantId: null,
}

const processDefinitions = [
  {
    id: 'invoice-process:3:mock-process-definition',
    key: 'invoice-process',
    name: 'Invoice Approval',
    version: 3,
    deploymentId: 'mock-deployment-primary',
    tenantId: null,
  },
  {
    id: 'invoice-sequential-review:1:mock-process-definition',
    key: 'invoice-sequential-review',
    name: 'Invoice Sequential Review',
    version: 1,
    deploymentId: 'mock-deployment-sequential',
    tenantId: null,
  },
  {
    id: 'invoice-parallel-approval:1:mock-process-definition',
    key: 'invoice-parallel-approval',
    name: 'Invoice Parallel Approval',
    version: 1,
    deploymentId: 'mock-deployment-parallel',
    tenantId: null,
  },
  {
    id: 'invoice-rework-loop:1:mock-process-definition',
    key: 'invoice-rework-loop',
    name: 'Invoice Rework Loop',
    version: 1,
    deploymentId: 'mock-deployment-loop',
    tenantId: null,
  },
]

/**
 * Synthetic Camunda 7 Authorization REST fixture catalogue. It deliberately
 * covers every importer disposition without containing customer identities:
 * exact group candidates, broad grants, direct users, revokes, and unsupported
 * task grants. The mock exposes this data through GET /authorization only.
 */
const nativeAuthorizations = [
  { id: 'synthetic-grant-process-read', type: 1, permissions: ['READ'], groupId: 'synthetic-operations', resourceType: 6, resourceId: 'invoice-process' },
  { id: 'synthetic-grant-decision-read', type: 1, permissions: ['READ'], groupId: 'synthetic-risk', resourceType: 10, resourceId: 'invoice-risk' },
  { id: 'synthetic-grant-process-broad', type: 1, permissions: ['READ'], groupId: 'synthetic-auditors', resourceType: 6, resourceId: '*' },
  { id: 'synthetic-user-grant', type: 1, permissions: ['READ'], userId: 'synthetic-user-001', resourceType: 6, resourceId: 'invoice-process' },
  { id: 'synthetic-group-revoke', type: 2, permissions: ['READ'], groupId: 'synthetic-denied', resourceType: 6, resourceId: 'invoice-process' },
  { id: 'synthetic-task-grant', type: 1, permissions: ['READ'], groupId: 'synthetic-task-team', resourceType: 7, resourceId: '*' },
]

function filterNativeAuthorizations(searchParams) {
  const firstResult = Math.max(Number(searchParams.get('firstResult') || 0), 0)
  const maxResults = Math.max(Number(searchParams.get('maxResults') || nativeAuthorizations.length), 0)
  return nativeAuthorizations.slice(firstResult, firstResult + maxResults)
}

const byId = (items) => new Map(items.map((item) => [item.id, item]))
const processDefinitionsById = byId(processDefinitions)

const runtimeInstances = [
  {
    id: primaryInstanceId,
    definitionId: processDefinitions[0].id,
    definitionKey: processDefinitions[0].key,
    businessKey: 'INV-42',
    caseInstanceId: null,
    tenantId: null,
    ended: false,
    suspended: false,
  },
  {
    id: sequentialInstanceId,
    definitionId: processDefinitions[1].id,
    definitionKey: processDefinitions[1].key,
    businessKey: 'SEQ-17',
    caseInstanceId: null,
    tenantId: null,
    ended: false,
    suspended: false,
  },
  {
    id: parallelInstanceId,
    definitionId: processDefinitions[2].id,
    definitionKey: processDefinitions[2].key,
    businessKey: 'PAR-11',
    caseInstanceId: null,
    tenantId: null,
    ended: false,
    suspended: false,
  },
  {
    id: loopInstanceId,
    definitionId: processDefinitions[3].id,
    definitionKey: processDefinitions[3].key,
    businessKey: 'LOOP-5',
    caseInstanceId: null,
    tenantId: null,
    ended: false,
    suspended: false,
  },
]

const runtimeInstancesById = byId(runtimeInstances)

const historicProcessInstances = [
  {
    id: primaryInstanceId,
    processDefinitionId: processDefinitions[0].id,
    processDefinitionKey: processDefinitions[0].key,
    processDefinitionName: processDefinitions[0].name,
    businessKey: 'INV-42',
    startTime: '2026-03-09T10:00:00.000Z',
    endTime: null,
    state: 'ACTIVE',
    suspended: false,
    superProcessInstanceId: null,
    rootProcessInstanceId: primaryInstanceId,
  },
  {
    id: sequentialInstanceId,
    processDefinitionId: processDefinitions[1].id,
    processDefinitionKey: processDefinitions[1].key,
    processDefinitionName: processDefinitions[1].name,
    businessKey: 'SEQ-17',
    startTime: '2026-03-09T11:00:00.000Z',
    endTime: null,
    state: 'ACTIVE',
    suspended: false,
    superProcessInstanceId: null,
    rootProcessInstanceId: sequentialInstanceId,
  },
  {
    id: parallelInstanceId,
    processDefinitionId: processDefinitions[2].id,
    processDefinitionKey: processDefinitions[2].key,
    processDefinitionName: processDefinitions[2].name,
    businessKey: 'PAR-11',
    startTime: '2026-03-09T12:00:00.000Z',
    endTime: null,
    state: 'ACTIVE',
    suspended: false,
    superProcessInstanceId: null,
    rootProcessInstanceId: parallelInstanceId,
  },
  {
    id: loopInstanceId,
    processDefinitionId: processDefinitions[3].id,
    processDefinitionKey: processDefinitions[3].key,
    processDefinitionName: processDefinitions[3].name,
    businessKey: 'LOOP-5',
    startTime: '2026-03-09T13:00:00.000Z',
    endTime: null,
    state: 'ACTIVE',
    suspended: false,
    superProcessInstanceId: null,
    rootProcessInstanceId: loopInstanceId,
  },
]

const historicProcessInstancesById = byId(historicProcessInstances)

const activityTrees = new Map([
  [primaryInstanceId, {
    id: 'ActivityInstance_root_primary',
    processInstanceId: primaryInstanceId,
    activityId: processDefinitions[0].key,
    activityName: processDefinitions[0].name,
    childActivityInstances: [
      {
        id: 'ActivityInstance_review',
        activityId: 'Activity_Review',
        activityName: 'Review Invoice',
        childActivityInstances: [],
      },
    ],
  }],
  [sequentialInstanceId, {
    id: 'ActivityInstance_root_sequential',
    processInstanceId: sequentialInstanceId,
    activityId: processDefinitions[1].key,
    activityName: processDefinitions[1].name,
    childActivityInstances: [
      {
        id: 'ActivityInstance_seq_review_3',
        activityId: 'Activity_SequentialReview',
        activityName: 'Review Line Item',
        childActivityInstances: [],
      },
    ],
  }],
  [parallelInstanceId, {
    id: 'ActivityInstance_root_parallel',
    processInstanceId: parallelInstanceId,
    activityId: processDefinitions[2].key,
    activityName: processDefinitions[2].name,
    childActivityInstances: [
      {
        id: 'ActivityInstance_parallel_subprocess',
        activityId: 'SubProcess_ParallelApproval',
        activityName: 'Parallel Approval',
        childActivityInstances: [
          {
            id: 'ActivityInstance_parallel_approve_a',
            activityId: 'Activity_ParallelApprove',
            activityName: 'Approve Invoice',
            childActivityInstances: [],
          },
          {
            id: 'ActivityInstance_parallel_approve_b',
            activityId: 'Activity_ParallelApprove',
            activityName: 'Approve Invoice',
            childActivityInstances: [],
          },
          {
            id: 'ActivityInstance_parallel_approve_c',
            activityId: 'Activity_ParallelApprove',
            activityName: 'Approve Invoice',
            childActivityInstances: [],
          },
        ],
      },
    ],
  }],
  [loopInstanceId, {
    id: 'ActivityInstance_root_loop',
    processInstanceId: loopInstanceId,
    activityId: processDefinitions[3].key,
    activityName: processDefinitions[3].name,
    childActivityInstances: [
      {
        id: 'ActivityInstance_loop_review_3',
        activityId: 'Activity_ReviewLoop',
        activityName: 'Review Invoice',
        childActivityInstances: [],
      },
    ],
  }],
])

const activityHistory = new Map([
  [primaryInstanceId, [
    {
      id: 'history-start-event',
      activityInstanceId: 'ActivityInstance_start_primary',
      activityId: 'StartEvent_1',
      activityName: 'Start',
      activityType: 'startEvent',
      processDefinitionId: processDefinitions[0].id,
      processInstanceId: primaryInstanceId,
      executionId: primaryInstanceId,
      startTime: '2026-03-09T10:00:00.000Z',
      endTime: '2026-03-09T10:00:01.000Z',
      durationInMillis: 1000,
      canceled: false,
    },
    {
      id: 'history-review-task',
      activityInstanceId: 'ActivityInstance_review',
      activityId: 'Activity_Review',
      activityName: 'Review Invoice',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[0].id,
      processInstanceId: primaryInstanceId,
      executionId: primaryInstanceId,
      taskId: 'task-review-primary',
      startTime: '2026-03-09T10:00:02.000Z',
      endTime: null,
      durationInMillis: null,
      canceled: false,
    },
  ]],
  [sequentialInstanceId, [
    {
      id: 'seq-start',
      activityInstanceId: 'ActivityInstance_seq_start',
      activityId: 'StartEvent_Seq',
      activityName: 'Start',
      activityType: 'startEvent',
      processDefinitionId: processDefinitions[1].id,
      processInstanceId: sequentialInstanceId,
      executionId: sequentialInstanceId,
      startTime: '2026-03-09T11:00:00.000Z',
      endTime: '2026-03-09T11:00:01.000Z',
      durationInMillis: 1000,
      canceled: false,
    },
    {
      id: 'seq-review-1',
      activityInstanceId: 'ActivityInstance_seq_review_1',
      activityId: 'Activity_SequentialReview',
      activityName: 'Review Line Item',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[1].id,
      processInstanceId: sequentialInstanceId,
      executionId: 'Execution_seq_review_1',
      taskId: 'task-seq-1',
      startTime: '2026-03-09T11:00:02.000Z',
      endTime: '2026-03-09T11:02:02.000Z',
      durationInMillis: 120000,
      canceled: false,
    },
    {
      id: 'seq-review-2',
      activityInstanceId: 'ActivityInstance_seq_review_2',
      activityId: 'Activity_SequentialReview',
      activityName: 'Review Line Item',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[1].id,
      processInstanceId: sequentialInstanceId,
      executionId: 'Execution_seq_review_2',
      taskId: 'task-seq-2',
      startTime: '2026-03-09T11:02:03.000Z',
      endTime: '2026-03-09T11:04:03.000Z',
      durationInMillis: 120000,
      canceled: false,
    },
    {
      id: 'seq-review-3',
      activityInstanceId: 'ActivityInstance_seq_review_3',
      activityId: 'Activity_SequentialReview',
      activityName: 'Review Line Item',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[1].id,
      processInstanceId: sequentialInstanceId,
      executionId: 'Execution_seq_review_3',
      taskId: 'task-seq-3',
      startTime: '2026-03-09T11:04:04.000Z',
      endTime: null,
      durationInMillis: null,
      canceled: false,
    },
  ]],
  [parallelInstanceId, [
    {
      id: 'par-start',
      activityInstanceId: 'ActivityInstance_par_start',
      activityId: 'StartEvent_Parallel',
      activityName: 'Start',
      activityType: 'startEvent',
      processDefinitionId: processDefinitions[2].id,
      processInstanceId: parallelInstanceId,
      executionId: parallelInstanceId,
      startTime: '2026-03-09T12:00:00.000Z',
      endTime: '2026-03-09T12:00:01.000Z',
      durationInMillis: 1000,
      canceled: false,
    },
    {
      id: 'par-subprocess',
      activityInstanceId: 'ActivityInstance_parallel_subprocess',
      activityId: 'SubProcess_ParallelApproval',
      activityName: 'Parallel Approval',
      activityType: 'subProcess',
      processDefinitionId: processDefinitions[2].id,
      processInstanceId: parallelInstanceId,
      executionId: 'Execution_parallel_subprocess',
      startTime: '2026-03-09T12:00:02.000Z',
      endTime: null,
      durationInMillis: null,
      canceled: false,
    },
    {
      id: 'par-approve-a',
      activityInstanceId: 'ActivityInstance_parallel_approve_a',
      parentActivityInstanceId: 'ActivityInstance_parallel_subprocess',
      activityId: 'Activity_ParallelApprove',
      activityName: 'Approve Invoice',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[2].id,
      processInstanceId: parallelInstanceId,
      executionId: 'Execution_parallel_a',
      taskId: 'task-par-a',
      startTime: '2026-03-09T12:00:03.000Z',
      endTime: '2026-03-09T12:05:03.000Z',
      durationInMillis: 300000,
      canceled: false,
    },
    {
      id: 'par-approve-b',
      activityInstanceId: 'ActivityInstance_parallel_approve_b',
      parentActivityInstanceId: 'ActivityInstance_parallel_subprocess',
      activityId: 'Activity_ParallelApprove',
      activityName: 'Approve Invoice',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[2].id,
      processInstanceId: parallelInstanceId,
      executionId: 'Execution_parallel_b',
      taskId: 'task-par-b',
      startTime: '2026-03-09T12:00:04.000Z',
      endTime: null,
      durationInMillis: null,
      canceled: false,
    },
    {
      id: 'par-approve-c',
      activityInstanceId: 'ActivityInstance_parallel_approve_c',
      parentActivityInstanceId: 'ActivityInstance_parallel_subprocess',
      activityId: 'Activity_ParallelApprove',
      activityName: 'Approve Invoice',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[2].id,
      processInstanceId: parallelInstanceId,
      executionId: 'Execution_parallel_c',
      taskId: 'task-par-c',
      startTime: '2026-03-09T12:00:05.000Z',
      endTime: null,
      durationInMillis: null,
      canceled: false,
    },
  ]],
  [loopInstanceId, [
    {
      id: 'loop-start',
      activityInstanceId: 'ActivityInstance_loop_start',
      activityId: 'StartEvent_Loop',
      activityName: 'Start',
      activityType: 'startEvent',
      processDefinitionId: processDefinitions[3].id,
      processInstanceId: loopInstanceId,
      executionId: loopInstanceId,
      startTime: '2026-03-09T13:00:00.000Z',
      endTime: '2026-03-09T13:00:01.000Z',
      durationInMillis: 1000,
      canceled: false,
    },
    {
      id: 'loop-review-1',
      activityInstanceId: 'ActivityInstance_loop_review_1',
      activityId: 'Activity_ReviewLoop',
      activityName: 'Review Invoice',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[3].id,
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_review_1',
      taskId: 'task-loop-review-1',
      startTime: '2026-03-09T13:00:02.000Z',
      endTime: '2026-03-09T13:05:02.000Z',
      durationInMillis: 300000,
      canceled: false,
    },
    {
      id: 'loop-gateway-1',
      activityInstanceId: 'ActivityInstance_loop_gateway_1',
      activityId: 'Gateway_Rework',
      activityName: 'Needs Rework?',
      activityType: 'exclusiveGateway',
      processDefinitionId: processDefinitions[3].id,
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_gateway_1',
      startTime: '2026-03-09T13:05:03.000Z',
      endTime: '2026-03-09T13:05:04.000Z',
      durationInMillis: 1000,
      canceled: false,
    },
    {
      id: 'loop-fix-1',
      activityInstanceId: 'ActivityInstance_loop_fix_1',
      activityId: 'Activity_FixInvoice',
      activityName: 'Fix Invoice',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[3].id,
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_fix_1',
      taskId: 'task-loop-fix-1',
      startTime: '2026-03-09T13:05:05.000Z',
      endTime: '2026-03-09T13:10:05.000Z',
      durationInMillis: 300000,
      canceled: false,
    },
    {
      id: 'loop-review-2',
      activityInstanceId: 'ActivityInstance_loop_review_2',
      activityId: 'Activity_ReviewLoop',
      activityName: 'Review Invoice',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[3].id,
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_review_2',
      taskId: 'task-loop-review-2',
      startTime: '2026-03-09T13:10:06.000Z',
      endTime: '2026-03-09T13:13:06.000Z',
      durationInMillis: 180000,
      canceled: false,
    },
    {
      id: 'loop-gateway-2',
      activityInstanceId: 'ActivityInstance_loop_gateway_2',
      activityId: 'Gateway_Rework',
      activityName: 'Needs Rework?',
      activityType: 'exclusiveGateway',
      processDefinitionId: processDefinitions[3].id,
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_gateway_2',
      startTime: '2026-03-09T13:13:07.000Z',
      endTime: '2026-03-09T13:13:08.000Z',
      durationInMillis: 1000,
      canceled: false,
    },
    {
      id: 'loop-review-3',
      activityInstanceId: 'ActivityInstance_loop_review_3',
      activityId: 'Activity_ReviewLoop',
      activityName: 'Review Invoice',
      activityType: 'userTask',
      processDefinitionId: processDefinitions[3].id,
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_review_3',
      taskId: 'task-loop-review-3',
      startTime: '2026-03-09T13:13:09.000Z',
      endTime: null,
      durationInMillis: null,
      canceled: false,
    },
  ]],
])

const processInstanceVariables = new Map([
  [primaryInstanceId, {
    customerId: { type: 'String', value: 'ACME-42' },
    amount: { type: 'Double', value: 1200 },
  }],
  [sequentialInstanceId, {
    invoiceId: { type: 'String', value: 'SEQ-17' },
    lineItems: { type: 'Json', value: ['Item-1', 'Item-2', 'Item-3'] },
    currentIndex: { type: 'Integer', value: 2 },
  }],
  [parallelInstanceId, {
    invoiceId: { type: 'String', value: 'PAR-11' },
    approvers: { type: 'Json', value: ['alice', 'bob', 'carol'] },
    approvalsPending: { type: 'Integer', value: 2 },
  }],
  [loopInstanceId, {
    invoiceId: { type: 'String', value: 'LOOP-5' },
    reworkCount: { type: 'Integer', value: 2 },
    lastOutcome: { type: 'String', value: 'needs-rework' },
  }],
])

const historicVariables = new Map([
  [primaryInstanceId, [
    {
      id: 'variable-customer-id',
      name: 'customerId',
      value: 'ACME-42',
      type: 'String',
      processInstanceId: primaryInstanceId,
      executionId: primaryInstanceId,
      activityInstanceId: 'ActivityInstance_review',
      createTime: '2026-03-09T10:00:02.000Z',
    },
    {
      id: 'variable-amount',
      name: 'amount',
      value: 1200,
      type: 'Double',
      processInstanceId: primaryInstanceId,
      executionId: primaryInstanceId,
      activityInstanceId: 'ActivityInstance_review',
      createTime: '2026-03-09T10:00:02.000Z',
    },
  ]],
  [sequentialInstanceId, [
    {
      id: 'variable-seq-index',
      name: 'currentIndex',
      value: 2,
      type: 'Integer',
      processInstanceId: sequentialInstanceId,
      executionId: 'Execution_seq_review_3',
      activityInstanceId: 'ActivityInstance_seq_review_3',
      createTime: '2026-03-09T11:04:04.000Z',
    },
    {
      id: 'variable-seq-line-item-1',
      name: 'lineItem',
      value: 'Item-1',
      type: 'String',
      processInstanceId: sequentialInstanceId,
      executionId: 'Execution_seq_review_1',
      activityInstanceId: 'ActivityInstance_seq_review_1',
      createTime: '2026-03-09T11:00:02.000Z',
    },
    {
      id: 'variable-seq-line-item-2',
      name: 'lineItem',
      value: 'Item-2',
      type: 'String',
      processInstanceId: sequentialInstanceId,
      executionId: 'Execution_seq_review_2',
      activityInstanceId: 'ActivityInstance_seq_review_2',
      createTime: '2026-03-09T11:02:03.000Z',
    },
    {
      id: 'variable-seq-line-item-3',
      name: 'lineItem',
      value: 'Item-3',
      type: 'String',
      processInstanceId: sequentialInstanceId,
      executionId: 'Execution_seq_review_3',
      activityInstanceId: 'ActivityInstance_seq_review_3',
      createTime: '2026-03-09T11:04:04.000Z',
    },
  ]],
  [parallelInstanceId, [
    {
      id: 'variable-par-approver-a',
      name: 'approver',
      value: 'alice',
      type: 'String',
      processInstanceId: parallelInstanceId,
      executionId: 'Execution_parallel_a',
      activityInstanceId: 'ActivityInstance_parallel_approve_a',
      createTime: '2026-03-09T12:00:03.000Z',
    },
    {
      id: 'variable-par-approver-b',
      name: 'approver',
      value: 'bob',
      type: 'String',
      processInstanceId: parallelInstanceId,
      executionId: 'Execution_parallel_b',
      activityInstanceId: 'ActivityInstance_parallel_approve_b',
      createTime: '2026-03-09T12:00:04.000Z',
    },
    {
      id: 'variable-par-approver-c',
      name: 'approver',
      value: 'carol',
      type: 'String',
      processInstanceId: parallelInstanceId,
      executionId: 'Execution_parallel_c',
      activityInstanceId: 'ActivityInstance_parallel_approve_c',
      createTime: '2026-03-09T12:00:05.000Z',
    },
  ]],
  [loopInstanceId, [
    {
      id: 'variable-loop-count',
      name: 'reworkCount',
      value: 2,
      type: 'Integer',
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_review_3',
      activityInstanceId: 'ActivityInstance_loop_review_3',
      createTime: '2026-03-09T13:13:09.000Z',
    },
    {
      id: 'variable-loop-reason-1',
      name: 'reworkReason',
      value: 'Missing cost center',
      type: 'String',
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_review_1',
      activityInstanceId: 'ActivityInstance_loop_review_1',
      createTime: '2026-03-09T13:05:02.000Z',
    },
    {
      id: 'variable-loop-reason-2',
      name: 'reworkReason',
      value: 'Attachment unreadable',
      type: 'String',
      processInstanceId: loopInstanceId,
      executionId: 'Execution_loop_review_2',
      activityInstanceId: 'ActivityInstance_loop_review_2',
      createTime: '2026-03-09T13:13:06.000Z',
    },
  ]],
])

const variableHistory = new Map([
  ['variable-customer-id', [
    {
      id: 'variable-history-customer-id',
      variableInstanceId: 'variable-customer-id',
      variableName: 'customerId',
      value: 'ACME-42',
      variableType: 'String',
      time: '2026-03-09T10:00:02.000Z',
      activityInstanceId: 'ActivityInstance_review',
      executionId: primaryInstanceId,
      taskId: null,
      revision: 1,
    },
  ]],
])

const historicTasks = new Map([
  [primaryInstanceId, [
    {
      id: 'task-review-primary',
      name: 'Review Invoice',
      assignee: 'demo.reviewer',
      startTime: '2026-03-09T10:00:02.000Z',
      endTime: null,
      activityInstanceId: 'ActivityInstance_review',
      executionId: primaryInstanceId,
    },
  ]],
  [sequentialInstanceId, [
    {
      id: 'task-seq-1',
      name: 'Review Line Item',
      assignee: 'sequential.approver.1',
      startTime: '2026-03-09T11:00:02.000Z',
      endTime: '2026-03-09T11:02:02.000Z',
      activityInstanceId: 'ActivityInstance_seq_review_1',
      executionId: 'Execution_seq_review_1',
    },
    {
      id: 'task-seq-2',
      name: 'Review Line Item',
      assignee: 'sequential.approver.2',
      startTime: '2026-03-09T11:02:03.000Z',
      endTime: '2026-03-09T11:04:03.000Z',
      activityInstanceId: 'ActivityInstance_seq_review_2',
      executionId: 'Execution_seq_review_2',
    },
    {
      id: 'task-seq-3',
      name: 'Review Line Item',
      assignee: 'sequential.approver.3',
      startTime: '2026-03-09T11:04:04.000Z',
      endTime: null,
      activityInstanceId: 'ActivityInstance_seq_review_3',
      executionId: 'Execution_seq_review_3',
    },
  ]],
  [parallelInstanceId, [
    {
      id: 'task-par-a',
      name: 'Approve Invoice',
      assignee: 'alice',
      startTime: '2026-03-09T12:00:03.000Z',
      endTime: '2026-03-09T12:05:03.000Z',
      activityInstanceId: 'ActivityInstance_parallel_approve_a',
      executionId: 'Execution_parallel_a',
    },
    {
      id: 'task-par-b',
      name: 'Approve Invoice',
      assignee: 'bob',
      startTime: '2026-03-09T12:00:04.000Z',
      endTime: null,
      activityInstanceId: 'ActivityInstance_parallel_approve_b',
      executionId: 'Execution_parallel_b',
    },
    {
      id: 'task-par-c',
      name: 'Approve Invoice',
      assignee: 'carol',
      startTime: '2026-03-09T12:00:05.000Z',
      endTime: null,
      activityInstanceId: 'ActivityInstance_parallel_approve_c',
      executionId: 'Execution_parallel_c',
    },
  ]],
  [loopInstanceId, [
    {
      id: 'task-loop-review-1',
      name: 'Review Invoice',
      assignee: 'loop.reviewer.1',
      startTime: '2026-03-09T13:00:02.000Z',
      endTime: '2026-03-09T13:05:02.000Z',
      activityInstanceId: 'ActivityInstance_loop_review_1',
      executionId: 'Execution_loop_review_1',
    },
    {
      id: 'task-loop-fix-1',
      name: 'Fix Invoice',
      assignee: 'requester',
      startTime: '2026-03-09T13:05:05.000Z',
      endTime: '2026-03-09T13:10:05.000Z',
      activityInstanceId: 'ActivityInstance_loop_fix_1',
      executionId: 'Execution_loop_fix_1',
    },
    {
      id: 'task-loop-review-2',
      name: 'Review Invoice',
      assignee: 'loop.reviewer.2',
      startTime: '2026-03-09T13:10:06.000Z',
      endTime: '2026-03-09T13:13:06.000Z',
      activityInstanceId: 'ActivityInstance_loop_review_2',
      executionId: 'Execution_loop_review_2',
    },
    {
      id: 'task-loop-review-3',
      name: 'Review Invoice',
      assignee: 'loop.reviewer.3',
      startTime: '2026-03-09T13:13:09.000Z',
      endTime: null,
      activityInstanceId: 'ActivityInstance_loop_review_3',
      executionId: 'Execution_loop_review_3',
    },
  ]],
])

const decisionHistory = new Map([
  [primaryInstanceId, [
    {
      id: 'decision-history-1',
      decisionDefinitionId: decisionDefinition.id,
      decisionDefinitionKey: decisionDefinition.key,
      decisionDefinitionName: decisionDefinition.name,
      evaluationTime: '2026-03-09T10:00:03.000Z',
      processDefinitionId: processDefinitions[0].id,
      processDefinitionKey: processDefinitions[0].key,
      processInstanceId: primaryInstanceId,
      activityId: 'Activity_Review',
      activityInstanceId: 'ActivityInstance_review',
      rootDecisionInstanceId: 'decision-history-1',
      tenantId: null,
      state: 'SUCCEEDED',
    },
  ]],
])

const decisionInputs = new Map([
  ['decision-history-1', [
    {
      id: 'decision-input-amount',
      clauseName: 'amount',
      type: 'Double',
      value: 1200,
    },
  ]],
])

const decisionOutputs = new Map([
  ['decision-history-1', [
    {
      id: 'decision-output-risk',
      clauseName: 'risk',
      type: 'String',
      value: 'low',
    },
  ]],
])

const incidents = new Map([
  [parallelInstanceId, [
    {
      id: 'incident-parallel-1',
      processInstanceId: parallelInstanceId,
      incidentType: 'failedJob',
      activityId: 'Activity_ParallelApprove',
      configuration: 'job-par-c',
      jobId: 'job-par-c',
      incidentMessage: 'Approval SLA breached for carol',
      incidentTimestamp: '2026-03-09T12:07:05.000Z',
    },
  ]],
])

const jobs = new Map([
  [parallelInstanceId, [
    {
      id: 'job-par-c',
      processInstanceId: parallelInstanceId,
      dueDate: '2026-03-09T12:30:00.000Z',
      retries: 0,
      exceptionMessage: 'Approval SLA breached for carol',
    },
  ]],
])

const externalTasks = new Map()

const userOperations = new Map([
  [`${sequentialInstanceId}:Execution_seq_review_3`, [
    {
      id: 'user-op-seq-1',
      operationType: 'Claim',
      entityType: 'Task',
      property: 'assignee',
      orgValue: null,
      newValue: 'sequential.approver.3',
      annotation: 'Sequential reviewer claimed the third item',
      timestamp: '2026-03-09T11:04:10.000Z',
      userId: 'sequential.approver.3',
    },
  ]],
  [`${parallelInstanceId}:Execution_parallel_b`, [
    {
      id: 'user-op-par-1',
      operationType: 'Claim',
      entityType: 'Task',
      property: 'assignee',
      orgValue: null,
      newValue: 'bob',
      annotation: 'Parallel branch claimed',
      timestamp: '2026-03-09T12:00:20.000Z',
      userId: 'bob',
    },
  ]],
  [`${loopInstanceId}:Execution_loop_review_3`, [
    {
      id: 'user-op-loop-1',
      operationType: 'SetAssignee',
      entityType: 'Task',
      property: 'assignee',
      orgValue: 'loop.reviewer.2',
      newValue: 'loop.reviewer.3',
      annotation: 'Escalated after repeated rework',
      timestamp: '2026-03-09T13:13:20.000Z',
      userId: 'manager',
    },
  ]],
])

const processBpmnXml = new Map([
  [processDefinitions[0].id, `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://enterpriseglue.ai/mock">
  <bpmn:process id="invoice-process" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Activity_Review" name="Review Invoice">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_Approved" name="Approved">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Activity_Review" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Activity_Review" targetRef="EndEvent_Approved" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="invoice-process">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Activity_Review_di" bpmnElement="Activity_Review">
        <dc:Bounds x="260" y="80" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_Approved_di" bpmnElement="EndEvent_Approved">
        <dc:Bounds x="462" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="260" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="380" y="120" />
        <di:waypoint x="462" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`],
  [processDefinitions[1].id, `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_seq" targetNamespace="http://enterpriseglue.ai/mock">
  <bpmn:process id="invoice-sequential-review" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Seq" name="Start"><bpmn:outgoing>Flow_Seq_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Activity_SequentialReview" name="Review Line Item">
      <bpmn:incoming>Flow_Seq_1</bpmn:incoming>
      <bpmn:outgoing>Flow_Seq_2</bpmn:outgoing>
      <bpmn:multiInstanceLoopCharacteristics isSequential="true">
        <bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality>
      </bpmn:multiInstanceLoopCharacteristics>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_Seq" name="Reviewed"><bpmn:incoming>Flow_Seq_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Seq_1" sourceRef="StartEvent_Seq" targetRef="Activity_SequentialReview" />
    <bpmn:sequenceFlow id="Flow_Seq_2" sourceRef="Activity_SequentialReview" targetRef="EndEvent_Seq" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_Seq"><bpmndi:BPMNPlane id="BPMNPlane_Seq" bpmnElement="invoice-sequential-review">
    <bpmndi:BPMNShape id="StartEvent_Seq_di" bpmnElement="StartEvent_Seq"><dc:Bounds x="120" y="142" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Activity_SequentialReview_di" bpmnElement="Activity_SequentialReview"><dc:Bounds x="230" y="120" width="150" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="EndEvent_Seq_di" bpmnElement="EndEvent_Seq"><dc:Bounds x="460" y="142" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="Flow_Seq_1_di" bpmnElement="Flow_Seq_1"><di:waypoint x="156" y="160" /><di:waypoint x="230" y="160" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_Seq_2_di" bpmnElement="Flow_Seq_2"><di:waypoint x="380" y="160" /><di:waypoint x="460" y="160" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`],
  [processDefinitions[2].id, `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_par" targetNamespace="http://enterpriseglue.ai/mock">
  <bpmn:process id="invoice-parallel-approval" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Parallel" name="Start"><bpmn:outgoing>Flow_Par_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="SubProcess_ParallelApproval" name="Parallel Approval">
      <bpmn:incoming>Flow_Par_1</bpmn:incoming>
      <bpmn:outgoing>Flow_Par_2</bpmn:outgoing>
      <bpmn:startEvent id="StartEvent_Parallel_Sub"><bpmn:outgoing>Flow_Par_Sub_1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:userTask id="Activity_ParallelApprove" name="Approve Invoice">
        <bpmn:incoming>Flow_Par_Sub_1</bpmn:incoming>
        <bpmn:outgoing>Flow_Par_Sub_2</bpmn:outgoing>
        <bpmn:multiInstanceLoopCharacteristics isSequential="false">
          <bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality>
        </bpmn:multiInstanceLoopCharacteristics>
      </bpmn:userTask>
      <bpmn:endEvent id="EndEvent_Parallel_Sub"><bpmn:incoming>Flow_Par_Sub_2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="Flow_Par_Sub_1" sourceRef="StartEvent_Parallel_Sub" targetRef="Activity_ParallelApprove" />
      <bpmn:sequenceFlow id="Flow_Par_Sub_2" sourceRef="Activity_ParallelApprove" targetRef="EndEvent_Parallel_Sub" />
    </bpmn:subProcess>
    <bpmn:endEvent id="EndEvent_Parallel" name="Approved"><bpmn:incoming>Flow_Par_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Par_1" sourceRef="StartEvent_Parallel" targetRef="SubProcess_ParallelApproval" />
    <bpmn:sequenceFlow id="Flow_Par_2" sourceRef="SubProcess_ParallelApproval" targetRef="EndEvent_Parallel" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_Par"><bpmndi:BPMNPlane id="BPMNPlane_Par" bpmnElement="invoice-parallel-approval">
    <bpmndi:BPMNShape id="StartEvent_Parallel_di" bpmnElement="StartEvent_Parallel"><dc:Bounds x="110" y="162" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="SubProcess_ParallelApproval_di" bpmnElement="SubProcess_ParallelApproval" isExpanded="true"><dc:Bounds x="210" y="90" width="280" height="180" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="StartEvent_Parallel_Sub_di" bpmnElement="StartEvent_Parallel_Sub"><dc:Bounds x="250" y="162" width="30" height="30" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Activity_ParallelApprove_di" bpmnElement="Activity_ParallelApprove"><dc:Bounds x="320" y="135" width="130" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="EndEvent_Parallel_Sub_di" bpmnElement="EndEvent_Parallel_Sub"><dc:Bounds x="470" y="162" width="30" height="30" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="EndEvent_Parallel_di" bpmnElement="EndEvent_Parallel"><dc:Bounds x="560" y="162" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="Flow_Par_1_di" bpmnElement="Flow_Par_1"><di:waypoint x="146" y="180" /><di:waypoint x="210" y="180" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_Par_Sub_1_di" bpmnElement="Flow_Par_Sub_1"><di:waypoint x="280" y="177" /><di:waypoint x="320" y="177" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_Par_Sub_2_di" bpmnElement="Flow_Par_Sub_2"><di:waypoint x="450" y="177" /><di:waypoint x="470" y="177" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_Par_2_di" bpmnElement="Flow_Par_2"><di:waypoint x="490" y="180" /><di:waypoint x="560" y="180" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`],
  [processDefinitions[3].id, `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_loop" targetNamespace="http://enterpriseglue.ai/mock">
  <bpmn:process id="invoice-rework-loop" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Loop" name="Start"><bpmn:outgoing>Flow_Loop_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Activity_ReviewLoop" name="Review Invoice">
      <bpmn:incoming>Flow_Loop_1</bpmn:incoming>
      <bpmn:incoming>Flow_Loop_4</bpmn:incoming>
      <bpmn:outgoing>Flow_Loop_2</bpmn:outgoing>
      <bpmn:standardLoopCharacteristics />
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_Rework" name="Needs Rework?">
      <bpmn:incoming>Flow_Loop_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Loop_3</bpmn:outgoing>
      <bpmn:outgoing>Flow_Loop_5</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:userTask id="Activity_FixInvoice" name="Fix Invoice">
      <bpmn:incoming>Flow_Loop_3</bpmn:incoming>
      <bpmn:outgoing>Flow_Loop_4</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_Loop" name="Approved"><bpmn:incoming>Flow_Loop_5</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Loop_1" sourceRef="StartEvent_Loop" targetRef="Activity_ReviewLoop" />
    <bpmn:sequenceFlow id="Flow_Loop_2" sourceRef="Activity_ReviewLoop" targetRef="Gateway_Rework" />
    <bpmn:sequenceFlow id="Flow_Loop_3" sourceRef="Gateway_Rework" targetRef="Activity_FixInvoice" />
    <bpmn:sequenceFlow id="Flow_Loop_4" sourceRef="Activity_FixInvoice" targetRef="Activity_ReviewLoop" />
    <bpmn:sequenceFlow id="Flow_Loop_5" sourceRef="Gateway_Rework" targetRef="EndEvent_Loop" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_Loop"><bpmndi:BPMNPlane id="BPMNPlane_Loop" bpmnElement="invoice-rework-loop">
    <bpmndi:BPMNShape id="StartEvent_Loop_di" bpmnElement="StartEvent_Loop"><dc:Bounds x="92" y="172" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Activity_ReviewLoop_di" bpmnElement="Activity_ReviewLoop"><dc:Bounds x="180" y="150" width="140" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Gateway_Rework_di" bpmnElement="Gateway_Rework" isMarkerVisible="true"><dc:Bounds x="370" y="165" width="50" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Activity_FixInvoice_di" bpmnElement="Activity_FixInvoice"><dc:Bounds x="470" y="260" width="120" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="EndEvent_Loop_di" bpmnElement="EndEvent_Loop"><dc:Bounds x="490" y="172" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="Flow_Loop_1_di" bpmnElement="Flow_Loop_1"><di:waypoint x="128" y="190" /><di:waypoint x="180" y="190" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_Loop_2_di" bpmnElement="Flow_Loop_2"><di:waypoint x="320" y="190" /><di:waypoint x="370" y="190" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_Loop_3_di" bpmnElement="Flow_Loop_3"><di:waypoint x="395" y="215" /><di:waypoint x="395" y="300" /><di:waypoint x="470" y="300" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_Loop_4_di" bpmnElement="Flow_Loop_4"><di:waypoint x="470" y="300" /><di:waypoint x="250" y="300" /><di:waypoint x="250" y="230" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Flow_Loop_5_di" bpmnElement="Flow_Loop_5"><di:waypoint x="420" y="190" /><di:waypoint x="490" y="190" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`],
])

const dmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" id="Definitions_mock" name="Invoice Risk" namespace="http://enterpriseglue.ai/mock/dmn">
  <decision id="invoice-risk" name="Invoice Risk">
    <decisionTable id="DecisionTable_1" hitPolicy="FIRST">
      <input id="Input_1">
        <inputExpression id="InputExpression_1" typeRef="number">
          <text>amount</text>
        </inputExpression>
      </input>
      <output id="Output_1" label="risk" name="risk" typeRef="string" />
      <rule id="Rule_1">
        <inputEntry id="UnaryTests_1"><text>&lt;= 5000</text></inputEntry>
        <outputEntry id="LiteralExpression_1"><text>"low"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_1" dmnElementRef="invoice-risk">
        <dc:Bounds x="160" y="100" width="180" height="80" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>`

function bool(value) {
  return value === 'true' || value === '1'
}

function asList(map) {
  return Array.from(map.values()).flat()
}

function byProcessDefinitionId(definitionId) {
  return historicProcessInstances.filter((item) => item.processDefinitionId === definitionId).map((item) => item.id)
}

function filterProcessDefinitions(searchParams) {
  const key = searchParams.get('key')
  const version = searchParams.get('version')
  const latestVersion = searchParams.get('latestVersion')
  let items = [...processDefinitions]
  if (key) items = items.filter((item) => item.key === key)
  if (version) items = items.filter((item) => String(item.version) === String(version))
  if (bool(latestVersion)) {
    const latestByKey = new Map()
    for (const item of items) {
      const current = latestByKey.get(item.key)
      if (!current || item.version > current.version) latestByKey.set(item.key, item)
    }
    items = Array.from(latestByKey.values())
  }
  return items
}

function filterRuntimeInstances(searchParams) {
  const processDefinitionId = searchParams.get('processDefinitionId')
  const processDefinitionKey = searchParams.get('processDefinitionKey')
  const processInstanceIdIn = searchParams.get('processInstanceIdIn')
  const suspended = searchParams.get('suspended')
  const withIncident = searchParams.get('withIncident')
  const activityIdIn = searchParams.get('activityIdIn')
  let items = [...runtimeInstances]
  if (processDefinitionId) items = items.filter((item) => item.definitionId === processDefinitionId)
  if (processDefinitionKey) items = items.filter((item) => item.definitionKey === processDefinitionKey)
  if (processInstanceIdIn) {
    const allowed = new Set(processInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
    items = items.filter((item) => allowed.has(item.id))
  }
  if (suspended !== null) items = items.filter((item) => item.suspended === bool(suspended))
  if (bool(withIncident)) items = items.filter((item) => (incidents.get(item.id) || []).length > 0)
  if (activityIdIn) {
    const allowedActivityIds = new Set(activityIdIn.split(',').map((item) => item.trim()).filter(Boolean))
    items = items.filter((item) => (activityHistory.get(item.id) || []).some((entry) => allowedActivityIds.has(entry.activityId) && !entry.endTime))
  }
  return items
}

function filterHistoricProcessInstances(searchParams) {
  const processDefinitionId = searchParams.get('processDefinitionId')
  const processDefinitionKey = searchParams.get('processDefinitionKey')
  const processInstanceIdIn = searchParams.get('processInstanceIdIn')
  const superProcessInstanceId = searchParams.get('superProcessInstanceId')
  const finished = searchParams.get('finished')
  const unfinished = searchParams.get('unfinished')
  let items = [...historicProcessInstances]
  if (processDefinitionId) items = items.filter((item) => item.processDefinitionId === processDefinitionId)
  if (processDefinitionKey) items = items.filter((item) => item.processDefinitionKey === processDefinitionKey)
  if (processInstanceIdIn) {
    const allowed = new Set(processInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
    items = items.filter((item) => allowed.has(item.id))
  }
  if (superProcessInstanceId) items = items.filter((item) => item.superProcessInstanceId === superProcessInstanceId)
  if (bool(finished)) items = items.filter((item) => !!item.endTime)
  if (bool(unfinished)) items = items.filter((item) => !item.endTime)
  return items
}

function filterHistoricActivityInstances(searchParams) {
  const processInstanceId = searchParams.get('processInstanceId')
  const processDefinitionId = searchParams.get('processDefinitionId')
  const unfinished = searchParams.get('unfinished')
  const finished = searchParams.get('finished')
  const canceled = searchParams.get('canceled')
  const firstResult = Number(searchParams.get('firstResult') || '0')
  const maxResults = Number(searchParams.get('maxResults') || '0')
  let items = []
  if (processInstanceId) {
    items = [...(activityHistory.get(processInstanceId) || [])]
  } else if (processDefinitionId) {
    const ids = byProcessDefinitionId(processDefinitionId)
    items = ids.flatMap((id) => activityHistory.get(id) || [])
  }
  if (bool(unfinished)) items = items.filter((item) => !item.endTime)
  if (bool(finished)) items = items.filter((item) => !!item.endTime)
  if (bool(canceled)) items = items.filter((item) => !!item.canceled)
  if (Number.isFinite(firstResult) && firstResult > 0) items = items.slice(firstResult)
  if (Number.isFinite(maxResults) && maxResults > 0) items = items.slice(0, maxResults)
  return items
}

function filterHistoricVariables(searchParams) {
  const processInstanceId = searchParams.get('processInstanceId')
  const activityInstanceIdIn = searchParams.get('activityInstanceIdIn')
  let items = processInstanceId ? [...(historicVariables.get(processInstanceId) || [])] : asList(historicVariables)
  if (activityInstanceIdIn) {
    const allowed = new Set(activityInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
    items = items.filter((item) => item.activityInstanceId && allowed.has(item.activityInstanceId))
  }
  return items
}

function filterIncidents(searchParams) {
  const processInstanceId = searchParams.get('processInstanceId')
  const processInstanceIdIn = searchParams.get('processInstanceIdIn')
  let items = processInstanceId ? [...(incidents.get(processInstanceId) || [])] : asList(incidents)
  if (processInstanceIdIn) {
    const allowed = new Set(processInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
    items = items.filter((item) => allowed.has(item.processInstanceId))
  }
  return items
}

function filterJobs(searchParams) {
  const processInstanceId = searchParams.get('processInstanceId')
  let items = processInstanceId ? [...(jobs.get(processInstanceId) || [])] : asList(jobs)
  if (bool(searchParams.get('withException'))) items = items.filter((item) => !!item.exceptionMessage)
  return items
}

function filterExternalTasks(searchParams) {
  const processInstanceId = searchParams.get('processInstanceId')
  return processInstanceId ? [...(externalTasks.get(processInstanceId) || [])] : asList(externalTasks)
}

function filterDecisionDefinitions(searchParams) {
  const key = searchParams.get('key')
  let items = [decisionDefinition]
  if (key) items = items.filter((item) => item.key === key)
  return items
}

function filterDecisionHistory(searchParams) {
  const processInstanceId = searchParams.get('processInstanceId')
  const decisionDefinitionId = searchParams.get('decisionDefinitionId')
  const activityInstanceIdIn = searchParams.get('activityInstanceIdIn')
  let items = processInstanceId ? [...(decisionHistory.get(processInstanceId) || [])] : asList(decisionHistory)
  if (decisionDefinitionId) items = items.filter((item) => item.decisionDefinitionId === decisionDefinitionId)
  if (activityInstanceIdIn) {
    const allowed = new Set(activityInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
    items = items.filter((item) => item.activityInstanceId && allowed.has(item.activityInstanceId))
  }
  return items
}

function filterHistoricTasks(searchParams) {
  const processInstanceId = searchParams.get('processInstanceId')
  const activityInstanceIdIn = searchParams.get('activityInstanceIdIn')
  let items = processInstanceId ? [...(historicTasks.get(processInstanceId) || [])] : asList(historicTasks)
  if (activityInstanceIdIn) {
    const allowed = new Set(activityInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
    items = items.filter((item) => item.activityInstanceId && allowed.has(item.activityInstanceId))
  }
  return items
}

function filterUserOperations(searchParams) {
  const processInstanceId = searchParams.get('processInstanceId')
  const executionId = searchParams.get('executionId')
  if (!processInstanceId || !executionId) return []
  return [...(userOperations.get(`${processInstanceId}:${executionId}`) || [])]
}

function getProcessDefinitionStatistics(processDefinitionId) {
  const definition = processDefinitionsById.get(processDefinitionId)
  if (!definition) return []
  if (definition.key === 'invoice-process') {
    return [{ id: 'Activity_Review', instances: 1, incidents: 0 }]
  }
  if (definition.key === 'invoice-sequential-review') {
    return [{ id: 'Activity_SequentialReview', instances: 1, incidents: 0 }]
  }
  if (definition.key === 'invoice-parallel-approval') {
    return [
      { id: 'SubProcess_ParallelApproval', instances: 1, incidents: 0 },
      { id: 'Activity_ParallelApprove', instances: 3, incidents: [{ incidentType: 'failedJob', incidentCount: 1 }] },
    ]
  }
  if (definition.key === 'invoice-rework-loop') {
    return [
      { id: 'Activity_ReviewLoop', instances: 1, incidents: 0 },
      { id: 'Activity_FixInvoice', instances: 0, incidents: 0 },
      { id: 'Gateway_Rework', instances: 0, incidents: 0 },
    ]
  }
  return []
}

export {
  primaryInstanceId,
  sequentialInstanceId,
  parallelInstanceId,
  loopInstanceId,
  processDefinitions,
  nativeAuthorizations,
  processDefinitionsById,
  runtimeInstances,
  runtimeInstancesById,
  historicProcessInstances,
  historicProcessInstancesById,
  processInstanceVariables,
  activityTrees,
  activityHistory,
  historicVariables,
  variableHistory,
  historicTasks,
  incidents,
  jobs,
  externalTasks,
  decisionDefinition,
  dmnXml,
  processBpmnXml,
  decisionInputs,
  decisionOutputs,
  filterProcessDefinitions,
  filterNativeAuthorizations,
  filterRuntimeInstances,
  filterHistoricProcessInstances,
  filterHistoricActivityInstances,
  filterHistoricVariables,
  filterIncidents,
  filterJobs,
  filterExternalTasks,
  filterDecisionDefinitions,
  filterDecisionHistory,
  filterHistoricTasks,
  filterUserOperations,
  getProcessDefinitionStatistics,
}
