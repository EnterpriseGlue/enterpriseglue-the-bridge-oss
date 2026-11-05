import { BpmnEngineOperationError, camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js'

const typedReadStatus = (error: unknown, status: number) => error instanceof BpmnEngineOperationError
  && error.details?.operationClass === 'engine.read' && error.details?.engineStatus === status

/** Called after the ordinary route guard. Some engines return 500 for variables
 * of an absent runtime process, so prove parent existence with its typed read.
 * A race is classified as absent only when a second parent read proves 404. */
export async function readLiveProcessVariables(engineId: string, id: string): Promise<Record<string, any>> {
  const path = `/process-instance/${encodeURIComponent(id)}`
  const parent = await camundaGet<{ id: string }>(engineId, path)
  if (parent?.id !== id) throw new Error('Runtime process identity is unavailable')
  try {
    return await camundaGet<Record<string, any>>(engineId, `${path}/variables`)
  } catch (error) {
    if (typedReadStatus(error, 500)) {
      try { await camundaGet(engineId, path) }
      catch (parentError) { if (typedReadStatus(parentError, 404)) throw parentError }
    }
    throw error
  }
}
