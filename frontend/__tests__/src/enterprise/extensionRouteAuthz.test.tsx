import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareExtensionRoutes,
  validateExtensionRouteAuthz,
} from '@src/enterprise/extensionRouteAuthz';
import type { EnterpriseExtensionRoute } from '@src/enterprise/extensionRegistry';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

const authState = vi.hoisted((): { permissions: CurrentUserPermissions } => ({
  permissions: {
    userId: 'user-1',
    tenantId: null,
    platform: [] as string[],
    projects: [],
    engines: [],
    authorizationVersion: 'test',
    generatedAt: 1,
  },
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    permissions: authState.permissions,
  }),
}));

function RouteHost({ routes }: { routes: EnterpriseExtensionRoute[] }) {
  return useRoutes(prepareExtensionRoutes(routes, { scope: 'root', warn: false }));
}

function renderRoutes(routes: EnterpriseExtensionRoute[], path = '/enterprise') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RouteHost routes={routes} />
    </MemoryRouter>
  );
}

describe('extensionRouteAuthz', () => {
  it('reports renderable extension routes without authz metadata', () => {
    const issues = validateExtensionRouteAuthz([
      { path: 'enterprise', element: <div>Enterprise</div> },
    ], 'root');

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'route.missing-authz',
        path: '/enterprise',
      }),
    ]);
  });

  it('reports unknown extension route action ids', () => {
    const unknownActionId = ['platform', 'unknown', 'read'].join('.');

    const issues = validateExtensionRouteAuthz([
      {
        path: 'enterprise',
        element: <div>Enterprise</div>,
        authz: { actionId: unknownActionId },
      },
    ], 'root');

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'route.unknown-action',
        actionId: unknownActionId,
      }),
    ]);
  });

  it('reports invalid backend route manifest metadata', () => {
    const issues = validateExtensionRouteAuthz([
      {
        path: 'enterprise',
        element: <div>Enterprise</div>,
        authz: {
          actionId: 'platform.audit.read',
          backendRoutes: [{ method: 'GET', path: 'api/audit' }],
        },
      },
    ], 'root');

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'route.backend-invalid',
        path: '/enterprise',
      }),
    ]);
  });

  it('renders a valid extension route when the current permission snapshot allows its action', () => {
    authState.permissions = {
      userId: 'user-1',
      tenantId: null,
      platform: ['platform:audit:view'],
      projects: [],
      engines: [],
      authorizationVersion: 'test',
      generatedAt: 1,
    };

    renderRoutes([
      {
        path: 'enterprise',
        element: <div>Enterprise Audit</div>,
        authz: { actionId: 'platform.audit.read' },
      },
    ]);

    expect(screen.getByText('Enterprise Audit')).toBeInTheDocument();
  });

  it('shows an unauthorized state when the extension route action is denied', () => {
    authState.permissions = {
      userId: 'user-1',
      tenantId: null,
      platform: [],
      projects: [],
      engines: [],
      authorizationVersion: 'test',
      generatedAt: 1,
    };

    renderRoutes([
      {
        path: 'enterprise',
        element: <div>Enterprise Audit</div>,
        authz: { actionId: 'platform.audit.read' },
      },
    ]);

    expect(screen.getByText('Not authorized')).toBeInTheDocument();
    expect(screen.getByText('Missing permission platform:audit:view')).toBeInTheDocument();
  });

  it('uses the active tenant for tenant-scoped extension route actions', () => {
    authState.permissions = {
      userId: 'user-1',
      tenantId: 'tenant-default',
      platform: [],
      tenant: {
        resourceId: 'tenant-default',
        permissions: ['tenant:settings:view'],
      },
      projects: [],
      engines: [],
      authorizationVersion: 'test',
      generatedAt: 1,
    };

    renderRoutes([
      {
        path: 'enterprise',
        element: <div>Tenant settings extension</div>,
        authz: { actionId: 'tenant.settings.read' },
      },
    ]);

    expect(screen.getByText('Tenant settings extension')).toBeInTheDocument();
  });

  it('excludes extension routes that have invalid entry authz metadata', () => {
    const preparedRoutes = prepareExtensionRoutes([
      { path: 'enterprise', element: <div>Enterprise</div> },
    ], { scope: 'root', warn: false });

    expect(preparedRoutes).toEqual([]);
  });
});
