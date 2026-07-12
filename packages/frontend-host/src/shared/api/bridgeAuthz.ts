import { apiClient } from './client';

/**
 * Composite bridge decisions are evaluated by the backend because the browser
 * cannot determine project-target and deployment-lineage access on its own.
 */
export const BRIDGE_AUTHZ_ACTION_IDS = {
  missionControlToStarbase: 'mission-control.bridge.starbase-edit.evaluate',
  starbaseToMissionControl: 'starbase.bridge.mission-control.evaluate',
} as const;

export type BridgeDecisionPayload = {
  engineId?: string;
  projectId?: string;
  fileId?: string;
  targetId?: string;
  definitionId?: string;
  definitionKey?: string;
  decisionDefinitionId?: string;
  decisionDefinitionKey?: string;
  kind?: 'process' | 'decision' | 'bpmn' | 'dmn';
};

export type BridgeDecisionResponse = {
  allowed: boolean;
  reasonCode: string;
  reason: string;
  missingActions: string[];
  projectId: string | null;
  fileId: string | null;
  engineId: string | null;
  targetId: string | null;
  lineage: Record<string, unknown>;
  diagnostics?: {
    effectiveAccessUrl?: string;
    label?: string;
  };
};

export function evaluateMissionControlStarbaseBridge(payload: BridgeDecisionPayload): Promise<BridgeDecisionResponse> {
  return apiClient.post<BridgeDecisionResponse>('/api/mission-control/bridge/starbase-edit/evaluate', payload);
}

export function evaluateStarbaseMissionControlBridge(payload: BridgeDecisionPayload): Promise<BridgeDecisionResponse> {
  return apiClient.post<BridgeDecisionResponse>('/api/starbase/bridge/mission-control/evaluate', payload);
}
