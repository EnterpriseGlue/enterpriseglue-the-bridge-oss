import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PublicAuthShell from '@src/shared/components/PublicAuthShell';

vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn().mockResolvedValue({}) } }));

describe('shared public authentication appearance', () => {
  it('defaults all account pages to the process shell with accessible page structure', () => {
    render(<PublicAuthShell title="Account access"><button>Continue</button></PublicAuthShell>);
    expect(document.querySelector('.eg-login-shell--process')).toBeInTheDocument();
    expect(document.querySelector('.eg-login-landscape')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', screen.getByRole('heading').id);
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#public-auth-main');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('preserves the explicit light appearance override for host extensions', () => {
    render(<PublicAuthShell title="Account access" appearance="default"><span>Account options</span></PublicAuthShell>);
    expect(document.querySelector('.eg-login-shell--process')).not.toBeInTheDocument();
    expect(document.querySelector('.eg-login-landscape')).not.toBeInTheDocument();
    expect(screen.getByText('Account options')).toBeInTheDocument();
  });
});
