/**
 * Deploy to Git button
 * Primary action for committing and pushing changes
 */

import React, { useState } from 'react';
import { Button } from '@carbon/react';
import { Rocket } from '@carbon/icons-react';
import DeployDialog from './DeployDialog';

interface DeployButtonProps {
  projectId: string;
  fileIds?: string[];
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  kind?: 'primary' | 'secondary' | 'tertiary' | 'ghost';
  onDeploySuccess?: () => void;
}

export default function DeployButton({ 
  projectId, 
  fileIds,
  disabled = false,
  size = 'md',
  kind = 'primary',
  onDeploySuccess,
}: DeployButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <Button
        size={size}
        kind={kind}
        disabled={disabled}
        renderIcon={Rocket}
        onClick={() => setIsDialogOpen(true)}
        title="Deploy project to Git repository (Cmd/Ctrl + Shift + D)"
      >
        Deploy
      </Button>

      {isDialogOpen && (
        <DeployDialog
          projectId={projectId}
          fileIds={fileIds}
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onDeploySuccess={onDeploySuccess}
        />
      )}
    </>
  );
}
