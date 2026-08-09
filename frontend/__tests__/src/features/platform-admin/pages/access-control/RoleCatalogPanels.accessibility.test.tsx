import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  PermissionCatalogPanel,
  RoleCatalogPanel,
} from '@src/features/platform-admin/pages/access-control/RoleCatalogPanels';

describe('role catalog error announcements', () => {
  it('keeps the scope filter accessible without a toolbar label row', () => {
    render(
      <RoleCatalogPanel
        roles={[]}
        loading={false}
        failed={false}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onArchive={vi.fn()}
        canManage={false}
        filterRoles={(roles) => roles}
      />,
    );

    const scopeFilter = screen.getByRole('combobox', { name: 'Filter roles by scope' });
    expect(scopeFilter).toBeInTheDocument();
    expect(scopeFilter.closest('.cds--dropdown--lg')).toBeInTheDocument();
    expect(scopeFilter.closest('.eg-role-scope-filter')).toBeInTheDocument();
    expect(scopeFilter.closest('.cds--dropdown__wrapper')?.querySelector('label')).toBeNull();
  });

  it('announces role and permission load failures assertively', () => {
    const { rerender } = render(
      <RoleCatalogPanel
        roles={[]}
        loading={false}
        failed
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onArchive={vi.fn()}
        canManage={false}
        filterRoles={(roles) => roles}
      />,
    );

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Unable to load roles')).toBeInTheDocument();

    rerender(
      <PermissionCatalogPanel
        permissions={[]}
        loading={false}
        failed
        onCreate={vi.fn()}
        canManage={false}
        filterPermissions={(permissions) => permissions}
        getPermissionImplications={() => []}
        getPermissionRisk={() => null}
      />,
    );

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Unable to load permissions')).toBeInTheDocument();
  });
});
