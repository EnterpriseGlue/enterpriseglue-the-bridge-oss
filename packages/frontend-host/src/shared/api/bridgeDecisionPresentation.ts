import type { BridgeDecisionResponse } from './bridgeAuthz';

/**
 * Keeps bridge diagnostics consistent across Starbase and Mission Control.
 * The server remains authoritative: this only presents its evaluated result.
 */
export function formatBridgeMissingActions(decision: BridgeDecisionResponse): string | null {
  const actions = [...new Set(decision.missingActions.filter(Boolean))];
  return actions.length > 0 ? actions.join(', ') : null;
}

export function bridgeEffectiveAccessUrl(decision: BridgeDecisionResponse): string | null {
  return decision.diagnostics?.effectiveAccessUrl || null;
}
