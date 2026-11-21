import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import VerifyEmail from '@src/pages/VerifyEmail';

const get = vi.hoisted(() => vi.fn());
vi.mock('@src/shared/api/client', () => ({ apiClient: { get } }));
vi.mock('@src/shared/components/PublicAuthShell', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

async function open(path = '/verify-email?token=verification-token') {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/t/:tenantSlug/verify-email" element={<VerifyEmail />} />
    <Route path="/login" element={<h1>Account login</h1>} />
    <Route path="/t/northwind/login" element={<h1>Northwind login</h1>} />
  </Routes></MemoryRouter>);
  await act(async () => {});
}

describe('VerifyEmail', () => {
  beforeEach(() => { vi.useFakeTimers(); get.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('keeps a successful verification visible until its successful redirect', async () => {
    get.mockResolvedValue({});
    await open();
    expect(screen.getByRole('heading', { name: 'Email verified' })).toBeInTheDocument();
    expect(screen.queryByText('Email was not verified')).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(screen.getByRole('heading', { name: 'Email verified' })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('heading', { name: 'Account login' })).toBeInTheDocument();
  });

  it('returns successful tenant verification to the same organization login', async () => {
    get.mockResolvedValue({ message: 'Email verified' });
    await open('/t/northwind/verify-email?token=verification-token');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole('heading', { name: 'Northwind login' })).toBeInTheDocument();
  });

  it.each([
    [{ code: 'TOKEN_EXPIRED', error: 'This link has expired' }, 'Verification link expired'],
    [{ code: 'TOKEN_INVALID', error: 'This link is invalid' }, 'Verification failed'],
    [null, 'Verification failed'],
  ])('keeps unsuccessful verification on its recovery screen: %j', async (response, title) => {
    get.mockResolvedValue(response);
    await open();
    expect(screen.getByRole('heading', { name: title as string })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(screen.getByRole('heading', { name: title as string })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request new link' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Account login' })).not.toBeInTheDocument();
  });

  it('shows a recovery state without sending a request when the token is missing', async () => {
    await open('/verify-email');
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Verification failed' })).toBeInTheDocument();
  });
});
