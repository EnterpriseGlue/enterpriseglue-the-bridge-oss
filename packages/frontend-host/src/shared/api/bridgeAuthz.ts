import { apiClient } from './client';
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

export function evaluateMissionControlStarbaseBridge(payload: BridgeDecisionPayload): Promise<BridgeDecisionResponse> {
  return apiClient.post<BridgeDecisionResponse>('/api/mission-control/bridge/starbase-edit/evaluate', payload);
}

export function evaluateStarbaseMissionControlBridge(payload: BridgeDecisionPayload): Promise<BridgeDecisionResponse> {
  return apiClient.post<BridgeDecisionResponse>('/api/starbase/bridge/mission-control/evaluate', payload);
}
