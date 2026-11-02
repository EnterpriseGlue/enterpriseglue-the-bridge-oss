import { apiClient } from './client';
import { BridgeDecisionResponseSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import type {
  BridgeDecisionRequest as SharedBridgeDecisionRequest,
  BridgeDecisionResponse as SharedBridgeDecisionResponse,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

/**
 * Composite bridge decisions are evaluated by the backend because the browser
 * cannot determine project-target and deployment-lineage access on its own.
 */
export const BRIDGE_AUTHZ_ACTION_IDS = {
  missionControlToStarbase: 'mission-control.bridge.starbase-edit.evaluate',
  starbaseToMissionControl: 'starbase.bridge.mission-control.evaluate',
} as const;

export type BridgeDecisionPayload = SharedBridgeDecisionRequest;
export type BridgeDecisionResponse = SharedBridgeDecisionResponse;

// Response validation owns the browser handoff only; destination APIs still authorize access.
async function evaluateBridge(path: string, payload: BridgeDecisionPayload): Promise<BridgeDecisionResponse> {
  const intent = { ...payload };
  const raw = await apiClient.post<unknown>(path, intent);
  const parsed = BridgeDecisionResponseSchema.safeParse(raw);
  const invalid = () => new Error('Bridge access response was not verified; select the resource again.');
  if (!parsed.success) throw invalid();
  const decision = parsed.data;
  const identityFields = ['projectId', 'fileId', 'engineId', 'targetId'] as const;
  for (const field of identityFields) {
    const resolved = decision[field];
    if (intent[field] !== undefined && resolved !== null && resolved !== intent[field]) throw invalid();
    if (decision.allowed && (!resolved || resolved !== resolved.trim())) throw invalid();
  }
  if (decision.allowed) {
    if (decision.reasonCode !== 'allowed' || decision.missingActions.length > 0) throw invalid();
    for (const field of ['definitionId', 'definitionKey', 'decisionDefinitionId', 'decisionDefinitionKey'] as const) {
      if (intent[field] !== undefined && decision.lineage[field] !== intent[field]) throw invalid();
    }
    if (intent.kind !== undefined && decision.lineage.kind !== (intent.kind === 'decision' || intent.kind === 'dmn' ? 'decision' : 'process')) throw invalid();
  }
  return decision;
}

export function evaluateMissionControlStarbaseBridge(payload: BridgeDecisionPayload): Promise<BridgeDecisionResponse> {
  return evaluateBridge('/api/mission-control/bridge/starbase-edit/evaluate', payload);
}

export function evaluateStarbaseMissionControlBridge(payload: BridgeDecisionPayload): Promise<BridgeDecisionResponse> {
  return evaluateBridge('/api/starbase/bridge/mission-control/evaluate', payload);
}
