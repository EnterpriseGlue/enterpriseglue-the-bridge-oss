import { apiClient } from './client';

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
