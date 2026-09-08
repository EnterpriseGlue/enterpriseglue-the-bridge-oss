import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), permissions: { platform: ['platform:tenants:self-create'] } }));
vi.mock('@src/shared/api/client', async (original) => ({
  ...await original<typeof import('@src/shared/api/client')>(),
  apiClient: { get: mocks.get },
}));
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'account-1' }, permissions: mocks.permissions }) }));
vi.mock('@src/enterprise/extensionRegistry', async (original) => ({
  ...await original<typeof import('@src/enterprise/extensionRegistry')>(), isMultiTenantEnabled: () => true,
}));

import { createRootLayoutRoute } from '@src/routes/index';

describe('pooled root onboarding redirect', () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue([]);
    mocks.permissions.platform = ['platform:tenants:self-create'];
  });

  function mount(registered = true) {
    const route = createRootLayoutRoute(registered ? [{
      path: 'cloud/onboarding', element: <div>Registered onboarding</div>,
      handle: { enterpriseglueAuthz: { actionId: 'platform.tenants.self_create' } },
    }] : []);
    render(<MemoryRouter><Routes>
      <Route path="/" element={route.children?.[0].element} />
      <Route path="/cloud/onboarding" element={<div>Organization onboarding</div>} />
      <Route path="/admin/tenants" element={<div>Tenant administration</div>} />
    </Routes></MemoryRouter>);
  }

  it('resumes registered onboarding for an eligible account without memberships', async () => {
    mount();
    expect(await screen.findByText('Organization onboarding')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/api/auth/my-tenants');
  });

  it('preserves the existing destination when no onboarding extension is registered', async () => {
    mount(false);
    expect(await screen.findByText('Tenant administration')).toBeInTheDocument();
  });

  it('does not select onboarding without the self-create permission', async () => {
    mocks.permissions.platform = [];
    mount();
    expect(await screen.findByText('Tenant administration')).toBeInTheDocument();
  });
});
