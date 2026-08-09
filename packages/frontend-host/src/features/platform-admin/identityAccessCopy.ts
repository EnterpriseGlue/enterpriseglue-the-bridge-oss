export function countPhrase(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function identityProviderName(
  provider: { key: string; displayName?: string | null } | null | undefined,
): string {
  return provider?.displayName?.trim() || provider?.key || 'Identity provider';
}

export const MAX_LOGIN_LABEL_LENGTH = 40;

export function providerLoginLabel(
  provider: { key: string; displayName?: string | null } | null | undefined,
): string {
  const name = identityProviderName(provider);
  if (name.length <= MAX_LOGIN_LABEL_LENGTH) return name;
  return `${name.slice(0, MAX_LOGIN_LABEL_LENGTH - 1).trimEnd()}…`;
}

export function membershipBehaviorCopy(syncMode: string): {
  label: string;
  description: string;
} {
  return syncMode === 'authoritative'
    ? { label: 'Keep in sync', description: 'Add and remove members' }
    : { label: 'Add only', description: 'Never remove automatically' };
}

export function savedMembershipApplicationCopy(
  providerName: string,
  result: {
    scanned: number;
    created: number;
    removed: number;
    failed: number;
    truncated: boolean;
  },
): {
  title: string;
  description: string;
  partial: boolean;
} {
  const partial = result.failed > 0 || result.truncated;
  const outcome = result.failed > 0 && result.truncated
    ? `${countPhrase(result.failed, 'record')} failed, and more records remain.`
    : result.failed > 0
      ? `${countPhrase(result.failed, 'record')} failed.`
      : result.truncated
        ? 'More records remain.'
        : '';
  const nextAction = result.failed > 0 && result.truncated
    ? ' Review the refresh history for the failed record, then apply the remaining data.'
    : result.failed > 0
      ? ' Review the refresh history for the failed record.'
      : result.truncated
        ? ' Apply the remaining data.'
        : '';

  return {
    title: partial
      ? 'Part of the saved membership data was applied'
      : `Saved membership data applied: ${providerName}`,
    description: `${providerName}: Checked ${countPhrase(result.scanned, 'saved identity record')}. Added ${countPhrase(result.created, 'membership')} and removed ${countPhrase(result.removed, 'membership')}.${outcome ? ` ${outcome}` : ''} Access changes took effect immediately.${nextAction}`,
    partial,
  };
}

export function configurationOwnershipLabel(
  ownershipMode?: string | null,
  driftStatus?: string | null,
): string {
  if (driftStatus === 'drifted') return 'Different from configuration';
  if (ownershipMode === 'config_warn') return 'Configuration-linked';
  if (ownershipMode === 'config_locked') return 'Managed by configuration';
  return 'Manual';
}

export function configurationSourceName(sourceRef?: string | null): string {
  if (!sourceRef) return 'its configuration bundle';
  if (sourceRef.startsWith('config_bundle:')) {
    return `bundle ${sourceRef.slice('config_bundle:'.length)}`;
  }
  if (sourceRef.startsWith('config:')) {
    return `configuration source ${sourceRef.slice('config:'.length)}`;
  }
  return `configuration source ${sourceRef}`;
}

export function configurationOwnershipDescription(
  ownershipMode?: string | null,
  sourceRef?: string | null,
): string | undefined {
  if (ownershipMode === 'config_warn') {
    return 'Local changes are allowed, but the next configuration apply may overwrite them.';
  }
  if (ownershipMode === 'config_locked') {
    return `Managed by configuration and cannot be changed here. Update ${configurationSourceName(sourceRef)} and apply it again.`;
  }
  return undefined;
}

export function syncRunStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    running: 'Running',
    pending: 'Pending',
  };
  return labels[status] || status.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

export function syncRunTriggerLabel(trigger: string): string {
  const labels: Record<string, string> = {
    login: 'Sign-in',
    scheduled: 'Scheduled refresh',
    manual: 'Manual refresh',
    directory: 'Directory refresh',
    membership_replay: 'Saved membership data',
    stored_membership_replay: 'Saved membership data',
  };
  return labels[trigger] || trigger.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}
