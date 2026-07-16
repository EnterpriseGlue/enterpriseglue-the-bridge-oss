import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BridgeAccessNotice } from '@src/shared/auth/BridgeAccessNotice';

describe('BridgeAccessNotice', () => {
  it('shows backend requirements and preserves the tenant-scoped Effective Access link', () => {
    render(
      <MemoryRouter initialEntries={['/t/default/mission-control/decisions']}>
        <BridgeAccessNotice
          title="Starbase edit unavailable"
          decision={{
            allowed: false,
            reasonCode: 'missing_project_file_read_permission',
            reason: 'The runtime artifact cannot be opened in Starbase.',
            missingActions: ['project.files.read'],
            projectId: 'project-1',
            fileId: 'file-1',
            engineId: 'engine-1',
            targetId: 'target-1',
            lineage: {},
            diagnostics: {
              effectiveAccessUrl: '/admin/access-control?tab=effective-access',
              label: 'Effective Access',
            },
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Missing requirements:')).toBeInTheDocument();
    expect(screen.getByText('project.files.read')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Effective Access' }))
      .toHaveAttribute('href', '/t/default/admin/access-control?tab=effective-access');
  });
});
