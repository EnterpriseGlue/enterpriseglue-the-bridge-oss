import React from 'react';
import { Tag } from '@carbon/react';

function typeFor(source: unknown): 'blue' | 'purple' | 'gray' {
  if (source === 'manual') return 'blue';
  if (source === 'config' || source === 'sso' || source === 'identity_provider') return 'purple';
  return 'gray';
}

function labelFor(source: unknown) {
  if (source === 'manual') return 'Manual';
  if (source === 'config') return 'Managed by configuration';
  if (source === 'sso') return 'Managed by SSO';
  if (source === 'identity_provider') return 'Managed by identity provider';
  if (source === 'api') return 'API managed';
  if (source === 'system') return 'System managed';
  return String(source || '-');
}

function descriptionFor(source: unknown) {
  if (source === 'sso') return 'Managed by an SSO assignment mapping. Change the mapping or the upstream entitlement.';
  if (source === 'identity_provider') return 'Managed by an identity-provider mapping. Change the mapping or the upstream entitlement.';
  if (source === 'config') return 'Managed by an authorization configuration bundle.';
  if (source === 'api') return 'Created through the EnterpriseGlue API.';
  if (source === 'system') return 'Created by an EnterpriseGlue system workflow.';
  return undefined;
}

export function AssignmentSourceTag({ source, configWarning = false }: { source: unknown; configWarning?: boolean }) {
  const description = configWarning ? 'Local changes are allowed, but the next configuration apply may overwrite them.' : descriptionFor(source);
  return <span title={description}><Tag type={configWarning ? 'warm-gray' : typeFor(source)}>{configWarning ? 'Configuration-linked' : labelFor(source)}</Tag></span>;
}
