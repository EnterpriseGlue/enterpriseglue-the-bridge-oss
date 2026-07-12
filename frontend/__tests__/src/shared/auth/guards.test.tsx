import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  getDecisionDiagnosticHref,
  getGuardedActionUnavailableReason,
  GuardedAction,
  GuardedOverflowMenuItem,
  summarizeBulkActionUnavailableReasons,
  WhyUnavailableLink,
} from '@src/shared/auth/guards';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import { PlatformPermission } from '@src/shared/auth/permissions';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

function getRenderedMenuItem(label: string): HTMLElement {
  const node = screen.getByText(label);
  return node.closest('button') || node.closest('[role="menuitem"]') || node;
}

const basePermissions: CurrentUserPermissions = {
  userId: 'user-1',
  platform: [],
  projects: [],
  engines: [],
  generatedAt: 1,
};

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const permissions = overrides.permissions ?? basePermissions;
  return {
    user: null,
    permissions,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
    refreshUser: vi.fn(),
    setAuthenticatedUser: vi.fn(),
    refreshPermissions: vi.fn(),
    hasPlatformPermission: vi.fn((permission: string) => Boolean(permissions?.platform?.includes(permission))),
    hasAnyPlatformPermission: vi.fn((required: string[]) => required.some((permission) => Boolean(permissions?.platform?.includes(permission)))),
    hasProjectPermission: vi.fn(),
    hasAnyProjectPermission: vi.fn(),
    hasAnyEnginePermission: vi.fn(),
    hasEnginePermission: vi.fn(),
    hasAnyScopedEnginePermission: vi.fn(),
    ...overrides,
  };
}

const deniedEngineDeleteDecision = {
  actionId: 'engine.inventory.delete',
  allowed: false,
  diagnostics: { explainUrl: '/admin/access-control?tab=effective-access' },
  permissionId: 'engine:delete',
  reason: 'Missing permission engine:delete',
  resourceId: 'engine-1',
  resourceType: 'engine',
  state: 'disabled',
} as const;

describe('frontend auth guard primitives', () => {
  it('renders enabled overflow menu items and invokes the click handler', () => {
    const onClick = vi.fn();

    render(<GuardedOverflowMenuItem itemText="Open" closeMenu={vi.fn()} onClick={onClick} />);

    fireEvent.click(getRenderedMenuItem('Open'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables overflow menu items with a contextual unavailable reason', () => {
    const onClick = vi.fn();

    render(
      <GuardedOverflowMenuItem
        itemText="Delete"
        closeMenu={vi.fn()}
        unavailableReason="Manual deletion is disabled"
        onClick={onClick}
      />
    );

    const item = getRenderedMenuItem('Delete');
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('title', 'Manual deletion is disabled');

    fireEvent.click(item);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('hides unavailable overflow menu items when requested', () => {
    render(
      <GuardedOverflowMenuItem
        itemText="Hidden action"
        hideWhenUnavailable
        unavailableReason="Missing permission"
      />
    );

    expect(screen.queryByText('Hidden action')).not.toBeInTheDocument();
  });

  it('derives unavailable reasons from denied authz decisions', () => {
    expect(
      getGuardedActionUnavailableReason(
        {
          actionId: 'engine.inventory.delete',
          allowed: false,
          reason: 'Missing permission engine:delete',
          resourceId: 'engine-1',
          resourceType: 'engine',
          state: 'disabled',
        },
        null
      )
    ).toBe('Missing permission engine:delete');

    expect(
      getGuardedActionUnavailableReason(
        {
          actionId: 'engine.inventory.delete',
          allowed: true,
          reason: 'Allowed by current permission snapshot',
          resourceId: 'engine-1',
          resourceType: 'engine',
          state: 'allowed',
        },
        null
      )
    ).toBeNull();
  });

  it('builds Effective Access diagnostic URLs with action and resource context', () => {
    expect(getDecisionDiagnosticHref(deniedEngineDeleteDecision)).toBe(
      '/admin/access-control?tab=effective-access&actionId=engine.inventory.delete&permissionId=engine%3Adelete&resourceType=engine&resourceId=engine-1'
    );
  });

  it('renders Why unavailable links only for Access Control readers', () => {
    const adminAuth = makeAuth({
      permissions: {
        ...basePermissions,
        platform: [PlatformPermission.AUTHZ_ROLES_VIEW],
      },
    });

    const { rerender } = render(
      <AuthContext.Provider value={makeAuth()}>
        <WhyUnavailableLink decision={deniedEngineDeleteDecision} />
      </AuthContext.Provider>
    );

    expect(screen.queryByRole('link', { name: 'Why unavailable' })).toBeNull();

    rerender(
      <AuthContext.Provider value={adminAuth}>
        <WhyUnavailableLink decision={deniedEngineDeleteDecision} />
      </AuthContext.Provider>
    );

    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=engine.inventory.delete&permissionId=engine%3Adelete&resourceType=engine&resourceId=engine-1'
    );
  });

  it('adds an admin diagnostic link next to disabled guarded actions', () => {
    render(
      <AuthContext.Provider
        value={makeAuth({
          permissions: {
            ...basePermissions,
            platform: [PlatformPermission.AUTHZ_ROLES_VIEW],
          },
        })}
      >
        <GuardedAction actionId="engine.inventory.delete" resource={{ type: 'engine', id: 'engine-1' }}>
          <button type="button">Delete engine</button>
        </GuardedAction>
      </AuthContext.Provider>
    );

    expect(screen.getByRole('button', { name: 'Delete engine' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Why unavailable' })).toBeInTheDocument();
  });

  it('summarizes bulk action partial denials with denied counts and first reason', () => {
    const projects = [
      { id: 'project-1', allowed: true },
      { id: 'project-2', allowed: false, reason: 'Missing permission project:deploy' },
      { id: 'project-3', allowed: false, reason: 'No eligible deployment target' },
    ];

    const summary = summarizeBulkActionUnavailableReasons(
      projects,
      (project) => project.allowed ? null : project.reason,
      {
        actionPastTense: 'deployed',
        itemLabelSingular: 'project',
        itemLabelPlural: 'projects',
      }
    );

    expect(summary.allowed).toBe(false);
    expect(summary.totalCount).toBe(3);
    expect(summary.deniedCount).toBe(2);
    expect(summary.firstDeniedReason).toBe('Missing permission project:deploy');
    expect(summary.firstDeniedItem?.id).toBe('project-2');
    expect(summary.deniedItems.map((project) => project.id)).toEqual(['project-2', 'project-3']);
    expect(summary.reason).toBe(
      'Unavailable: 2 of 3 selected projects cannot be deployed. First reason: Missing permission project:deploy.'
    );
  });

  it('attaches first denied diagnostic decisions to bulk summaries', () => {
    const summary = summarizeBulkActionUnavailableReasons(
      [
        { id: 'project-1', allowed: true },
        { id: 'project-2', allowed: false, reason: 'Missing permission project:deploy' },
      ],
      (project) => project.allowed ? null : project.reason,
      {
        actionPastTense: 'deployed',
        getDiagnosticDecision: (project, reason) => ({
          ...deniedEngineDeleteDecision,
          actionId: 'project.deploy.create',
          permissionId: 'project:deploy',
          reason,
          resourceId: project.id,
          resourceType: 'project',
        }),
        itemLabelSingular: 'project',
        itemLabelPlural: 'projects',
      }
    );

    expect(summary.firstDeniedDecision).toMatchObject({
      actionId: 'project.deploy.create',
      permissionId: 'project:deploy',
      reason: 'Missing permission project:deploy',
      resourceId: 'project-2',
      resourceType: 'project',
    });
    expect(summary.firstDeniedDiagnosticHref).toBe(
      '/admin/access-control?tab=effective-access&actionId=project.deploy.create&permissionId=project%3Adeploy&resourceType=project&resourceId=project-2'
    );
  });

  it('summarizes allowed and empty bulk action selections', () => {
    expect(
      summarizeBulkActionUnavailableReasons(
        [{ id: 'project-1', allowed: true }],
        (project) => project.allowed ? null : 'Denied'
      )
    ).toMatchObject({
      allowed: true,
      deniedCount: 0,
      firstDeniedReason: null,
      firstDeniedDecision: null,
      firstDeniedDiagnosticHref: null,
      firstDeniedItem: null,
      reason: null,
      totalCount: 1,
    });

    expect(
      summarizeBulkActionUnavailableReasons(
        [],
        () => 'Denied',
        { emptyReason: 'Select at least one project' }
      )
    ).toMatchObject({
      allowed: false,
      deniedCount: 0,
      firstDeniedReason: null,
      firstDeniedDecision: null,
      firstDeniedDiagnosticHref: null,
      firstDeniedItem: null,
      reason: 'Select at least one project',
      totalCount: 0,
    });
  });
});
