import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@test/mocks/server'
import LayoutWithProSidebar from '../../../../../src/features/shared/components/LayoutWithProSidebar'

const logoutMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    logout: logoutMock,
    refreshUser: vi.fn(),
    user: {
      id: 'user-1',
      email: 'admin@example.com',
      platformRole: 'admin',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
  }),
}))

vi.mock('@src/shared/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => true,
}))

vi.mock('@src/features/shared/stores/layoutStore', () => ({
  useLayoutStore: () => ({
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
    toggleSidebarCollapsed: vi.fn(),
  }),
}))

vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({
    data: {
      syncPushEnabled: true,
      syncPullEnabled: false,
      syncBothEnabled: false,
      gitProjectTokenSharingEnabled: false,
      defaultDeployRoles: [],
    },
  }),
}))

vi.mock('@src/components/TenantPicker', () => ({
  default: () => <div data-testid="tenant-picker" />,
}))

vi.mock('@src/features/shared/components/ProSidebar', () => ({
  default: () => <div data-testid="pro-sidebar" />,
}))

vi.mock('@src/enterprise/loadEnterpriseFrontendPlugin', () => ({
  getEnterpriseFrontendPlugin: () => Promise.resolve({ navItems: [] }),
}))

function renderWithProviders() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LayoutWithProSidebar />}>
            <Route index element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('LayoutWithProSidebar notifications', () => {
  it('opens notifications panel and shows empty state', async () => {
    server.use(
      http.get('/t/default/api/notifications', () =>
        HttpResponse.json({ notifications: [], unreadCount: 0 })
      )
    )

    renderWithProviders()

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Notifications'))

    await waitFor(() => {
      expect(Boolean(screen.getByText(/No notifications yet/i))).toBe(true)
    })
  })

  it('marks notifications read when panel opens with unread items', async () => {
    let readCalled = false

    server.use(
      http.get('/t/default/api/notifications', () =>
        HttpResponse.json({
          notifications: [
            {
              id: 'notif-1',
              state: 'info',
              title: 'Update ready',
              subtitle: null,
              createdAt: Date.now(),
              readAt: null,
            },
          ],
          unreadCount: 2,
        })
      ),
      http.patch('/t/default/api/notifications/read', () => {
        readCalled = true
        return HttpResponse.json({ success: true })
      })
    )

    renderWithProviders()

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Notifications'))

    await waitFor(() => {
      expect(readCalled).toBe(true)
    })
  })
})
