/**
 * Mission Control metrics service
 */

import { getMetrics, getMetricByName } from '@shared/services/bpmn-engine-client.js'

export async function listMetrics(engineId: string, params: any) {
  return getMetrics<any>(engineId, params)
}

export async function getMetric(engineId: string, name: string, params: any) {
  return getMetricByName<any>(engineId, name, params)
}
