import { z } from 'zod'

// Modification instructions for process instance token manipulation
export const ModificationInstructionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('startBeforeActivity'),
    activityId: z.string(),
    ancestorActivityInstanceId: z.string().optional(),
    variables: z.record(z.any()).optional(),
  }),
  z.object({
    type: z.literal('startAfterActivity'),
    activityId: z.string(),
    ancestorActivityInstanceId: z.string().optional(),
    variables: z.record(z.any()).optional(),
  }),
  z.object({
    type: z.literal('startTransition'),
    transitionId: z.string(),
    ancestorActivityInstanceId: z.string().optional(),
    variables: z.record(z.any()).optional(),
  }),
  z.object({
    type: z.literal('cancel'),
    activityInstanceIds: z.array(z.string()).optional(),
    transitionInstanceIds: z.array(z.string()).optional(),
    activityId: z.string().optional(),
    cancelCurrentActiveActivityInstances: z.boolean().optional(),
  })
])

// Sync modification for a single process instance
export const ProcessInstanceModificationRequest = z.object({
  instructions: z.array(ModificationInstructionSchema).min(1),
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
})

// Async modification for multiple instances by definition
export const ProcessDefinitionModificationAsyncRequest = z.object({
  instructions: z.array(ModificationInstructionSchema).min(1),
  processInstanceIds: z.array(z.string()).optional(),
  processInstanceQuery: z.record(z.any()).optional(),
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
})

// Async restart of completed instances by definition
export const ProcessDefinitionRestartAsyncRequest = z.object({
  processInstanceIds: z.array(z.string()).optional(),
  historicProcessInstanceQuery: z.record(z.any()).optional(),
  initialVariables: z.boolean().optional(),
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
  withoutBusinessKey: z.boolean().optional(),
  // Optional instructions on where to restart (Camunda supports startBefore/After/Transition)
  instructions: z.array(ModificationInstructionSchema).optional(),
})

export type ModificationInstruction = z.infer<typeof ModificationInstructionSchema>
export type ProcessInstanceModification = z.infer<typeof ProcessInstanceModificationRequest>
export type ProcessDefinitionModificationAsync = z.infer<typeof ProcessDefinitionModificationAsyncRequest>
export type ProcessDefinitionRestartAsync = z.infer<typeof ProcessDefinitionRestartAsyncRequest>
