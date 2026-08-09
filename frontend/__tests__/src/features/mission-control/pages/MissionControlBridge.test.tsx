import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import MissionControlBridge from '@src/features/mission-control/pages/MissionControlBridge';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'user-1',
    platform: [],
    projects: [],
    engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
    generatedAt: 1,
  } as any,
  user: {
    id: 'user-1',
    email: 'viewer@example.com',
    capabilities: {},
  } as any,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    permissions: authState.permissions,
  }),
}));

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({
    tenantNavigate: vi.fn(),
  }),
}));

describe('MissionControlBridge', () => {
  beforeEach(() => {
    authState.user = {
      id: 'user-1',
      email: 'viewer@example.com',
      capabilities: {},
    };
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
      generatedAt: 1,
    };
  });

  it('renders mission control tiles', () => {
    render(
      <MemoryRouter initialEntries={['/mission-control']}>
        <MissionControlBridge />
      </MemoryRouter>
    );

    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    expect(screen.getByText('Processes')).toBeInTheDocument();
    expect(screen.getByText('Batches')).toBeInTheDocument();
    expect(screen.getByText('Decisions')).toBeInTheDocument();
    expect(screen.queryByText('Migrations')).toBeNull();
  });

  it('does not show the migrations tile on the overview page even when runtime mutation is available', () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view', 'engine:process:modify'] }],
      generatedAt: 1,
    };

    render(
      <MemoryRouter initialEntries={['/mission-control']}>
        <MissionControlBridge />
      </MemoryRouter>
    );

    expect(screen.queryByText('Migrations')).toBeNull();
  });

  it('hides section tiles when the user lacks the matching runtime read permission', () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: ['engine:process:modify'] }],
      generatedAt: 1,
    };

    render(
      <MemoryRouter initialEntries={['/mission-control']}>
        <MissionControlBridge />
      </MemoryRouter>
    );

    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    expect(screen.queryByText('Processes')).toBeNull();
    expect(screen.queryByText('Batches')).toBeNull();
    expect(screen.queryByText('Decisions')).toBeNull();
  });
});
