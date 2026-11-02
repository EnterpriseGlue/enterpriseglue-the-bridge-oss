import { Button, InlineNotification } from '@carbon/react';
import { LoadingState } from '../../../shared/components/LoadingState';

export function RuntimeDefinitionLinkNotice({ error, onClear }: { error: string | null; onClear: () => void }) {
  if (!error) return <LoadingState message="Loading linked runtime definition..." />;
  return <div style={{ padding: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
    <InlineNotification kind="warning" title="Linked definition unavailable" subtitle={error} lowContrast hideCloseButton />
    <Button kind="tertiary" size="sm" onClick={onClear}>Clear linked selection</Button>
  </div>;
}
