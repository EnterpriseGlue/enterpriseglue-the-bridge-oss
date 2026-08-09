import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { EngineAccessModal } from '@src/features/starbase/components/project-detail/EngineAccessModal';
import { ProjectPermission } from '@src/shared/auth/permissions';

describe('EngineAccessModal', () => {
  it('exports EngineAccessModal component', () => {
    expect(EngineAccessModal).toBeDefined();
    expect(typeof EngineAccessModal).toBe('function');
  });

  function renderModal(overrides: Partial<Parameters<typeof EngineAccessModal>[0]> = {}) {
    const props: Parameters<typeof EngineAccessModal>[0] = {
      open: true,
      onClose: vi.fn(),
      engineAccessQ: {
        isLoading: false,
        isError: false,
        data: {
          accessedEngines: [],
          pendingRequests: [],
          availableEngines: [],
        },
      },
      canRequestEngineAccess: true,
      requestEngineAccessUnavailableReason: null,
      myMembershipLoading: false,
      selectedEngineForRequest: null,
      setSelectedEngineForRequest: vi.fn(),
      requestEngineAccessM: {
        isPending: false,
        mutate: vi.fn(),
      },
      ...overrides,
    };

    return {
      props,
      ...render(<EngineAccessModal {...props} />),
    };
  }

  it('renders deployment target modes and eligibility for connected engines', () => {
    renderModal({
      engineAccessQ: {
        isLoading: false,
        isError: false,
        data: {
          accessedEngines: [
            {
              engineId: 'engine-1',
              engineName: 'Dev Engine',
              baseUrl: 'https://engine.example.test',
              environment: { name: 'Development', color: '#0f62fe' },
              deploymentTarget: {
                id: 'target-1',
                status: 'active',
                source: 'manual',
                sourceRef: null,
                allowManualDeploy: true,
                allowCiDeploy: true,
                allowApiDeploy: false,
                allowImport: true,
                lastSeenAt: null,
                createdAt: 1704067200,
                updatedAt: 1704067200,
              },
              deploymentEligibility: {
                diagnosticsVisible: true,
                manual: { allowed: true, reasons: [] },
                ci: { allowed: false, reasons: ['Missing permission engine:deploy'] },
              },
              health: { status: 'connected', latencyMs: 42 },
              grantedAt: 1704067200,
            },
          ],
          pendingRequests: [],
          availableEngines: [],
        },
      },
    });

    expect(screen.getByText('Dev Engine')).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getAllByText('Manual').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('CI')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
    expect(screen.getByText('Manual allowed')).toBeInTheDocument();
    expect(screen.getByText('CI denied')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('disables request controls with the exact missing permission reason', () => {
    renderModal({
      canRequestEngineAccess: false,
      requestEngineAccessUnavailableReason: `Missing permission ${ProjectPermission.PROJECT_SETTINGS}`,
      engineAccessQ: {
        isLoading: false,
        isError: false,
        data: {
          accessedEngines: [],
          pendingRequests: [],
          availableEngines: [{ id: 'engine-2', name: 'QA Engine' }],
        },
      },
    });

    expect(screen.getByText('Request access unavailable')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.PROJECT_SETTINGS}`)).toBeInTheDocument();
    const requestButton = screen.getByRole('button', { name: /request access/i });
    expect(requestButton).toBeDisabled();
    expect(requestButton).toHaveAttribute('title', `Missing permission ${ProjectPermission.PROJECT_SETTINGS}`);
  });

  it('submits the selected engine access request when permitted', async () => {
    const mutate = vi.fn();
    renderModal({
      selectedEngineForRequest: 'engine-2',
      requestEngineAccessM: { isPending: false, mutate },
      engineAccessQ: {
        isLoading: false,
        isError: false,
        data: {
          accessedEngines: [],
          pendingRequests: [],
          availableEngines: [{ id: 'engine-2', name: 'QA Engine' }],
        },
      },
    });

    await userEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect(mutate).toHaveBeenCalledWith('engine-2');
  });
});
