import type { ComponentProps } from 'react';
import { InlineNotification } from '@carbon/react';
import { ApiClientsPanel } from './MachineIdentityPanel';

type ApiClientsPanelProps = ComponentProps<typeof ApiClientsPanel>;

/**
 * Owns the External Registration tab's aggregate query failure boundary while
 * leaving Carbon's direct TabPanel children in the parent Access Control page.
 */
export function ExternalRegistrationTab({
  failed,
  ...panelProps
}: ApiClientsPanelProps & { failed: boolean }) {
  if (failed) {
    return <InlineNotification kind="error" title="Unable to load external registration data" lowContrast />;
  }

  return <ApiClientsPanel {...panelProps} />;
}
