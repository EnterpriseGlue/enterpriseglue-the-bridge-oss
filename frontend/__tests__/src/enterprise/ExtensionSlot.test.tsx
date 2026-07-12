import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExtensionMenuItems, ExtensionNavItems } from '@src/enterprise/ExtensionSlot';
import { extensions, registerMenuItem, registerNavItem } from '@src/enterprise/extensionRegistry';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    permissions: null,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
    refreshUser: vi.fn(),
    setAuthenticatedUser: vi.fn(),
    refreshPermissions: vi.fn(),
    hasPlatformPermission: vi.fn().mockReturnValue(false),
    hasAnyPlatformPermission: vi.fn().mockReturnValue(false),
    hasProjectPermission: vi.fn().mockReturnValue(false),
    hasAnyProjectPermission: vi.fn().mockReturnValue(false),
    hasAnyEnginePermission: vi.fn().mockReturnValue(false),
    hasEnginePermission: vi.fn().mockReturnValue(false),
    hasAnyScopedEnginePermission: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('ExtensionSlot permission-aware gates', () => {
  beforeEach(() => {
    extensions.navItems.splice(0, extensions.navItems.length);
    extensions.menuItems.splice(0, extensions.menuItems.length);
  });

  const renderWithAuth = (children: React.ReactElement, auth = makeAuth()) =>
    render(
      <AuthContext.Provider value={auth}>
        {children}
      </AuthContext.Provider>
    );

  it('renders nav items when a matching RBAC permission satisfies the requirement', () => {
    registerNavItem({
      id: 'audit',
      label: 'Audit',
      path: '/admin/audit',
      section: 'admin',
      requiredPermission: 'platform:audit:view',
    });

    const auth = makeAuth({
      hasPlatformPermission: vi.fn((permission: string) => permission === 'platform:audit:view'),
    });

    renderWithAuth(
      <ExtensionNavItems
        section="admin"
        renderItem={(item) => <span>{item.label}</span>}
      />,
      auth
    );

    expect(screen.getByText('Audit')).toBeInTheDocument();
  });

  it('renders nav items when declared action metadata is allowed by the permission snapshot', () => {
    registerNavItem({
      id: 'audit-action',
      label: 'Audit Action',
      path: '/admin/audit',
      section: 'admin',
      actionId: 'platform.audit.read',
    });

    const auth = makeAuth({
      permissions: {
        userId: 'user-1',
        platform: ['platform:audit:view'],
        projects: [],
        engines: [],
        generatedAt: 1,
      },
    });

    renderWithAuth(
      <ExtensionNavItems
        section="admin"
        renderItem={(item) => <span>{item.label}</span>}
      />,
      auth
    );

    expect(screen.getByText('Audit Action')).toBeInTheDocument();
  });

  it('hides nav items when declared action metadata is denied', () => {
    registerNavItem({
      id: 'audit-action-denied',
      label: 'Audit Action Denied',
      path: '/admin/audit',
      section: 'admin',
      actionId: 'platform.audit.read',
    });

    renderWithAuth(
      <ExtensionNavItems
        section="admin"
        renderItem={(item) => <span>{item.label}</span>}
      />,
      makeAuth({
        permissions: {
          userId: 'user-1',
          platform: [],
          projects: [],
          engines: [],
          generatedAt: 1,
        },
      })
    );

    expect(screen.queryByText('Audit Action Denied')).toBeNull();
  });

  it('keeps deprecated admin role gates working through admin-nav permissions', () => {
    registerMenuItem({
      id: 'access-control',
      label: 'Access Control',
      requiredRole: 'admin',
    });

    const auth = makeAuth({
      hasAnyPlatformPermission: vi.fn((permissions: string[]) =>
        permissions.includes('platform:authz:roles:view')
      ),
    });

    renderWithAuth(
      <ExtensionMenuItems
        renderItem={(item) => <span>{item.label}</span>}
      />,
      auth
    );

    expect(screen.getByText('Access Control')).toBeInTheDocument();
  });

  it('hides nav items when required permissions are missing', () => {
    registerNavItem({
      id: 'users',
      label: 'Users',
      path: '/admin/users',
      section: 'admin',
      requiredPermissions: ['platform:users:view', 'platform:users:manage'],
    });

    render(
      <ExtensionNavItems
        section="admin"
        renderItem={(item) => <span>{item.label}</span>}
      />
    );

    expect(screen.queryByText('Users')).toBeNull();
  });

  it('renders menu items when declared action metadata is allowed by the permission snapshot', () => {
    registerMenuItem({
      id: 'audit-menu-action',
      label: 'Audit Menu Action',
      actionId: 'platform.audit.read',
    });

    const auth = makeAuth({
      permissions: {
        userId: 'user-1',
        platform: ['platform:audit:view'],
        projects: [],
        engines: [],
        generatedAt: 1,
      },
    });

    renderWithAuth(
      <ExtensionMenuItems
        renderItem={(item) => <span>{item.label}</span>}
      />,
      auth
    );

    expect(screen.getByText('Audit Menu Action')).toBeInTheDocument();
  });
});
