import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import UserManagement from '../../../../src/pages/admin/UserManagement';
import { authService } from '../../../../src/services/auth';

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1', capabilities: { canManageUsers: true } } }),
}));

const notifyMock = vi.fn();
vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: notifyMock }),
}));

vi.mock('@src/shared/hooks/useModal', () => ({
  useModal: () => ({
    isOpen: false,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    data: null,
  }),
}));

vi.mock('@src/components/FormModal', () => ({
  default: () => null,
}));

vi.mock('@src/shared/components/ConfirmModal', () => ({
  default: () => null,
}));

vi.mock('@src/services/auth', () => ({
  authService: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    unlockUser: vi.fn(),
  },
}));

describe('UserManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders users and filters by search', async () => {
    (authService.listUsers as unknown as Mock).mockResolvedValue([
      {
        id: 'user-1',
        email: 'admin@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        platformRole: 'admin',
        isActive: true,
        createdAt: Date.now(),
      },
      {
        id: 'user-2',
        email: 'dev@example.com',
        firstName: 'Dev',
        lastName: 'User',
        platformRole: 'developer',
        isActive: false,
        createdAt: Date.now(),
      },
    ]);

    render(<UserManagement />);

    await waitFor(() => {
      expect(Boolean(screen.getByText('admin@example.com'))).toBe(true);
    });

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/search users/i), 'dev');

    expect(Boolean(screen.queryByText('admin@example.com'))).toBe(false);
    expect(Boolean(screen.getByText('dev@example.com'))).toBe(true);
  });

  it('notifies on load error', async () => {
    (authService.listUsers as unknown as Mock).mockRejectedValue(new Error('boom'));

    render(<UserManagement />);

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Failed to load users' })
      );
    });
  });
});
