import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareExtensionRoutes,
  validateExtensionRouteAuthz,
} from '@src/enterprise/extensionRouteAuthz';
import type { EnterpriseExtensionRoute } from '@src/enterprise/extensionRegistry';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'user-1',
    platform: [] as string[],
    projects: [],
    engines: [],
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
      platform: ['platform:audit:view'],
      projects: [],
      engines: [],
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
      platform: [],
      projects: [],
      engines: [],
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

  it('excludes extension routes that have invalid entry authz metadata', () => {
    const preparedRoutes = prepareExtensionRoutes([
      { path: 'enterprise', element: <div>Enterprise</div> },
    ], { scope: 'root', warn: false });

    expect(preparedRoutes).toEqual([]);
  });
});
