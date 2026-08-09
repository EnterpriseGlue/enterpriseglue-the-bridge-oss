import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EngineSetsPanel } from '@src/features/platform-admin/pages/access-control/EngineSetsPanel';

const engineSet = {
  id: 'engine-set-1',
  tenantId: 'tenant-1',
  key: 'production',
  name: 'Production engines',
  description: null,
  selector: { mode: 'engine_ids' as const, engineIds: ['engine-1'] },
  selectorFingerprint: 'selector-1',
  source: 'manual' as const,
  sourceRef: null,
  ownershipMode: 'manual' as const,
  sourceHash: null,
  lastAppliedAt: null,
  driftStatus: null,
  isArchived: false,
  createdById: 'admin-1',
  lastMaterializedAt: null,
  materializationStatus: 'active',
  materializationError: null,
  materializedEngineCount: 0,
  createdAt: 1,
  updatedAt: 1,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof EngineSetsPanel>> = {}) {
  const props: React.ComponentProps<typeof EngineSetsPanel> = {
    engineSets: [engineSet],
    selectedEngineSet: null,
    assignments: [],
    apiClients: [],
    groups: [],
    serviceAccounts: [],
    auditEntries: [],
    loading: false,
    detailLoading: false,
    assignmentLoading: false,
    auditLoading: false,
    materializeSummary: null,
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onArchive: vi.fn(),
    onMaterialize: vi.fn(),
    onSelect: vi.fn(),
    pending: false,
    canManage: true,
    canReadAssignments: false,
    canReadAudit: false,
    ...overrides,
  };
  render(<EngineSetsPanel {...props} />);
  return props;
}

function menuItem(label: string): HTMLElement | null {
  const node = screen.queryAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node?.closest('button') || node?.closest('[role="menuitem"]') || node || null;
}

describe('EngineSetsPanel', () => {
  it('opens details for a selected Engine Set without performing a mutation', async () => {
    const props = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Production engines' }));
    await waitFor(() => expect(menuItem('View details')).toBeTruthy());
    fireEvent.click(menuItem('View details')!);

    expect(props.onSelect).toHaveBeenCalledWith('engine-set-1');
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it('keeps config-locked Engine Sets visible but blocks edit and archive actions', async () => {
    renderPanel({
      engineSets: [{ ...engineSet, source: 'config', ownershipMode: 'config_locked' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Production engines' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Archive')).toBeDisabled();
    expect(screen.getByTitle(/Managed by configuration/)).toBeInTheDocument();
  });

  it('treats legacy Engine Sets without selector or ownership metadata as manual', async () => {
    renderPanel({
      engineSets: [{
        ...engineSet,
        selector: undefined,
        source: undefined,
        ownershipMode: undefined,
      } as unknown as typeof engineSet],
    });

    expect(screen.getByText('Selector details unavailable')).toBeVisible();
    expect(screen.getByText('manual')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Production engines' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).not.toBeDisabled();
    expect(menuItem('Archive')).not.toBeDisabled();
  });
});
