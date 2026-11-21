import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrganizationList } from '@src/features/organizations/OrganizationList';
import type { OrganizationMembership } from '@src/features/organizations/OrganizationSession';

const alpha: OrganizationMembership = { tenantId: 'alpha', tenantSlug: 'alpha', tenantName: 'Alpha', tenantStatus: 'active', role: 'member' };
const bravo = { ...alpha, tenantId: 'bravo', tenantSlug: 'bravo', tenantName: 'Bravo' };

describe('Organization choice listbox', () => {
  it('announces its keyboard pattern and moves focus without opening an organization', async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(<OrganizationList memberships={[alpha, bravo, { ...alpha, tenantId: 'suspended', tenantName: 'Suspended', tenantStatus: 'suspended' }]}
      lastOrganization="bravo" onChoose={choose} busy={false} />);
    expect(screen.getByRole('listbox', { name: 'Your organizations' })).toHaveAccessibleDescription(/arrow keys.*Enter/);
    const first = screen.getByRole('option', { name: /Bravo/ });
    const second = screen.getByRole('option', { name: /Alpha/ });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(choose).not.toHaveBeenCalled();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(second).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(choose).toHaveBeenCalledExactlyOnceWith(alpha);
    expect(screen.getByRole('option', { name: /Suspended/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps a pending switch from submitting another organization choice', async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(<OrganizationList memberships={[alpha, bravo]} lastOrganization={null} onChoose={choose} busy />);
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('option', { name: /Bravo/ }));
    expect(choose).not.toHaveBeenCalled();
  });

  it('keeps search usable and explains an empty filtered list', async () => {
    const user = userEvent.setup();
    render(<OrganizationList memberships={Array.from({ length: 8 }, (_, i) => ({ ...alpha, tenantId: String(i), tenantName: `Organization ${i}` }))}
      lastOrganization={null} onChoose={vi.fn()} busy={false} />);
    await user.type(screen.getByRole('searchbox'), 'No match');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(screen.getByText('No organizations match your search')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
