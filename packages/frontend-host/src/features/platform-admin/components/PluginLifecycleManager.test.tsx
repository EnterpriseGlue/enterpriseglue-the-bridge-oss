// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginLifecycleManager } from './PluginLifecycleManager';

const api = vi.hoisted(() => ({
  createPluginInstallation: vi.fn(),
  decidePluginInstallation: vi.fn(),
  getPluginCatalog: vi.fn(),
  getPluginManagerStatus: vi.fn(),
  listPluginInstallations: vi.fn(),
  recoverPluginInstallation: vi.fn(),
}));

vi.mock('../api/pluginPlatform', () => api);

const releaseDigest = `registry.example/releases/support@sha256:${'1'.repeat(64)}`;

beforeEach(() => {
  vi.clearAllMocks();
  api.getPluginManagerStatus.mockResolvedValue({
    apiVersion: 'manager-status.plugin.enterpriseglue.io/v1',
    available: true,
    capability: {
      managerId: 'manager-1',
      managerVersion: '0.1.0',
      state: 'ready',
      deploymentModes: ['compose_planner'],
      operations: ['plan', 'install', 'upgrade'],
    },
  });
  api.getPluginCatalog.mockResolvedValue({
    apiVersion: 'catalog-projection.plugin.enterpriseglue.io/v1',
    catalog: {
      apiVersion: 'catalog.plugin.enterpriseglue.io/v2',
      kind: 'EnterpriseGluePluginCatalog',
      metadata: {
        revision: '1.0.0',
        generatedAt: '2026-08-24T00:00:00.000Z',
        expiresAt: '2026-09-24T00:00:00.000Z',
      },
      products: [
        {
          descriptor: {
            apiVersion: 'product.plugin.enterpriseglue.io/v1',
            kind: 'EnterpriseGluePluginProduct',
            productId: 'io.enterpriseglue.ion-support',
            pluginId: 'io.enterpriseglue.ion-support',
            publisher: {
              id: 'io.enterpriseglue',
              displayName: 'EnterpriseGlue',
              verification: 'first_party',
            },
            displayName: 'ION Support',
            summary: 'Contextual Operaton and EnterpriseGlue support.',
            categories: ['support'],
            documentationUrl: 'https://enterpriseglue.ai/docs',
            supportUrl: 'https://enterpriseglue.ai/support',
            securityUrl: 'https://enterpriseglue.ai/security',
            privacyUrl: 'https://enterpriseglue.ai/privacy',
            dataFlowUrl: 'https://enterpriseglue.ai/data-flow',
            retentionUrl: 'https://enterpriseglue.ai/retention',
            deploymentModes: ['compose_planner'],
            architectures: ['amd64'],
            commercialAction: 'entitled',
          },
          releases: [
            {
              version: '1.1.0',
              channel: 'stable',
              state: 'available',
              release: releaseDigest,
            },
          ],
        },
      ],
    },
  });
  api.listPluginInstallations.mockResolvedValue({ items: [], total: 0 });
  api.createPluginInstallation.mockResolvedValue({
    installationId: 'installation-1',
    requestedAt: '2026-08-24T00:00:00.000Z',
  });
});

describe('PluginLifecycleManager', () => {
  it('renders the four Carbon lifecycle surfaces and creates a revision-bound install review', async () => {
    render(
      <PluginLifecycleManager
        canManage
        installedPlugins={[]}
        platformRevision={9}
        installedContent={<p>Installed plugin controls</p>}
      />,
    );

    expect(await screen.findByText('ION Support')).toBeVisible();
    const tabs = screen.getByRole('tablist', {
      name: 'Plugin lifecycle sections',
    });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Review and add' }));
    expect(
      screen.getByRole('heading', { name: 'Add ION Support' }),
    ).toBeVisible();
    expect(screen.getByText('No deployment changes yet')).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add ION Support' })).getByRole(
        'button',
        { name: 'Create review' },
      ),
    );

    await waitFor(() =>
      expect(api.createPluginInstallation).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'io.enterpriseglue.ion-support',
          release: releaseDigest,
          operation: 'install',
          expectedPlatformRevision: 9,
        }),
      ),
    );
  });

  it('offers a signed update from the Updates tab without changing runtime enablement', async () => {
    render(
      <PluginLifecycleManager
        canManage
        installedPlugins={[
          {
            pluginId: 'io.enterpriseglue.ion-support',
            version: '1.0.0',
            displayName: 'ION Support',
            state: 'healthy',
            enabled: true,
            healthy: true,
            compatible: true,
            entitled: 'active',
            reasonCode: 'none',
            revision: 4,
          },
        ]}
        platformRevision={9}
        installedContent={<p>Installed plugin controls</p>}
      />,
    );

    expect((await screen.findAllByText('ION Support')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Updates' }));
    expect(await screen.findByRole('button', { name: 'Review update' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review update' }));
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: 'Update ION Support' }),
      ).getByRole('button', { name: 'Create review' }),
    );

    await waitFor(() =>
      expect(api.createPluginInstallation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'upgrade',
          fromVersion: '1.0.0',
          currentEnabled: true,
        }),
      ),
    );
  });

  it('creates an offline intent without uploading artifact bytes', async () => {
    render(
      <PluginLifecycleManager
        canManage
        installedPlugins={[]}
        platformRevision={9}
        installedContent={<p>Installed plugin controls</p>}
      />,
    );

    await screen.findByText('ION Support');
    fireEvent.click(screen.getByRole('button', { name: 'Add offline delivery' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plugin ID' }), {
      target: { value: 'io.enterpriseglue.ion-support' },
    });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Immutable release reference' }),
      { target: { value: releaseDigest } },
    );
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: 'Add offline delivery' }),
      ).getByRole('button', { name: 'Create review' }),
    );

    await waitFor(() =>
      expect(api.createPluginInstallation).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'io.enterpriseglue.ion-support',
          release: releaseDigest,
          source: 'offline_delivery',
          deploymentMode: 'compose_planner',
          expectedPlatformRevision: 9,
        }),
      ),
    );
    expect(api.createPluginInstallation.mock.calls[0]?.[0]).not.toHaveProperty(
      'artifact',
    );
  });

  it('renders all review sections and rejects the exact revision-bound digests', async () => {
    const finding = {
      status: 'pass' as const,
      reasonCode: 'none' as const,
      summary: 'Verified.',
    };
    api.listPluginInstallations.mockResolvedValue({
      total: 1,
      items: [
        {
          intent: {
            apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1',
            kind: 'EnterpriseGluePluginInstallationIntent',
            installationId: 'installation-review-1',
            pluginId: 'io.enterpriseglue.ion-support',
            release: releaseDigest,
            operation: 'install',
            source: 'offline_delivery',
            deploymentMode: 'compose_planner',
            requesterRef: 'user-1',
            expectedPlatformRevision: 9,
            idempotencyKey: 'review-test-1',
            requestedAt: '2026-08-24T00:00:00.000Z',
          },
          state: 'awaiting_approval',
          reasonCode: 'approval_required',
          revision: 3,
          review: {
            apiVersion: 'install-review.plugin.enterpriseglue.io/v1',
            kind: 'EnterpriseGluePluginInstallReview',
            installationId: 'installation-review-1',
            pluginId: 'io.enterpriseglue.ion-support',
            version: '1.1.0',
            release: releaseDigest,
            planSha256: '2'.repeat(64),
            reviewSha256: '3'.repeat(64),
            platformRevision: 9,
            generatedAt: '2026-08-24T00:00:00.000Z',
            expiresAt: '2026-08-24T01:00:00.000Z',
            identity: finding,
            compatibility: finding,
            permissionsAndData: {
              ...finding,
              status: 'warning',
              summary: 'Data may leave the deployment.',
            },
            infrastructure: finding,
            migrationAndRollback: finding,
            entitlement: finding,
            entitlementState: 'active',
            rollbackClass: 'stateless',
            requestedPermissions: [],
            materialChanges: ['initial-install'],
            approvable: true,
          },
          approval: null,
          latestObservation: null,
          updatedAt: '2026-08-24T00:00:01.000Z',
        },
      ],
    });
    api.decidePluginInstallation.mockResolvedValue({ status: 'recorded' });

    render(
      <PluginLifecycleManager
        canManage
        installedPlugins={[]}
        platformRevision={9}
        installedContent={<p>Installed plugin controls</p>}
      />,
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Installation activity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));
    expect(screen.getAllByRole('button', { name: /^\d\. / })).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: '7. Final digest approval' }));
    expect(screen.getByText('2'.repeat(64))).toBeVisible();
    expect(screen.getByText('3'.repeat(64))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(api.decidePluginInstallation).toHaveBeenCalledWith({
        installationId: 'installation-review-1',
        decision: 'reject',
        reviewSha256: '3'.repeat(64),
        planSha256: '2'.repeat(64),
        expectedRevision: 3,
      }),
    );
  });

  it('keeps install actions unavailable for read-only users', async () => {
    render(
      <PluginLifecycleManager
        canManage={false}
        installedPlugins={[]}
        platformRevision={9}
        installedContent={<p>Installed plugin controls</p>}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Review and add' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add from registry' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add offline delivery' })).toBeDisabled();
  });
});
