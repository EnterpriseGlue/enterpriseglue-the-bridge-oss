import type { ComponentProps } from 'react';
import { InlineNotification } from '@carbon/react';
import { ProjectEngineTargetsPanel } from './ProjectEngineTargetsPanel';

type ProjectEngineTargetsPanelProps = ComponentProps<typeof ProjectEngineTargetsPanel>;

/**
 * Keeps the project-target tab's error boundary and panel wiring together
 * without wrapping Carbon's TabPanel, which must remain a direct child of
 * TabPanels in the parent page.
 */
export function ProjectEngineTargetsTab({
  failed,
  ...panelProps
}: ProjectEngineTargetsPanelProps & { failed: boolean }) {
  if (failed) {
    return <InlineNotification kind="error" title="Unable to load project-engine targets" lowContrast />;
  }

  return <ProjectEngineTargetsPanel {...panelProps} />;
}
