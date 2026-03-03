/**
 * Mission Control messages service
 */

import { correlateMessage, deliverSignal } from '@enterpriseglue/shared/services/bpmn-engine-client.js'

export async function sendMessage(engineId: string, body: any) {
  return correlateMessage<any>(engineId, body)
}

export async function sendSignal(engineId: string, body: any) {
  return deliverSignal(engineId, body)
}
