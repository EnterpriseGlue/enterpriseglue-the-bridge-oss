import { InlineNotification } from '@carbon/react';
import type { BridgeDecisionResponse } from '../api/bridgeAuthz';
import { bridgeEffectiveAccessUrl, formatBridgeMissingActions } from '../api/bridgeDecisionPresentation';
import { useTenantNavigate } from '../hooks/useTenantNavigate';

export interface BridgeAccessNoticeProps {
  title: string;
  decision?: BridgeDecisionResponse | null;
  error?: string | null;
}

/**
 * Renders a backend-evaluated bridge result without replicating project-target
 * or runtime-lineage authorization in the browser.
 */
export function BridgeAccessNotice({ title, decision, error }: BridgeAccessNoticeProps) {
  const { tenantNavigate, toTenantPath } = useTenantNavigate();
  if ((!decision || decision.allowed) && !error) return null;

  const missingActions = decision && !decision.allowed ? formatBridgeMissingActions(decision) : null;
  const effectiveAccessUrl = decision && !decision.allowed ? bridgeEffectiveAccessUrl(decision) : null;
  const message = error || decision?.reason || 'The required bridge access could not be verified.';

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
      <InlineNotification kind="warning" title={title} subtitle={message} lowContrast hideCloseButton />
      {missingActions ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          Missing requirements: <code>{missingActions}</code>
        </div>
      ) : null}
      {effectiveAccessUrl ? (
        <a
          href={toTenantPath(effectiveAccessUrl)}
          style={{ fontSize: 12, width: 'fit-content' }}
          onClick={(event) => {
            event.preventDefault();
            tenantNavigate(effectiveAccessUrl);
          }}
        >
          Open Effective Access
        </a>
      ) : null}
    </div>
  );
}
