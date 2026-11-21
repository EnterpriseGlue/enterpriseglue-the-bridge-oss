import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PublicAuthShell from '@src/shared/components/PublicAuthShell';
import { WorkspaceHeaderContext } from '@src/features/organizations/workspaceHeaderContext';

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

  it('keeps the dark illustrated account layout when the workspace owns the shared header', () => {
    render(<WorkspaceHeaderContext.Provider value={{
      branding: { brandTitle: 'Shared workspace', logoSrc: '/logo.png', logoHeight: 16,
        titleFontSize: 14, titleFontWeight: '600', titleOffset: 0 },
      navigation: null, actions: null,
    }}>
      <header aria-label="Shared workspace application header" />
      <PublicAuthShell title="Email verified"><button>Go to login now</button></PublicAuthShell>
    </WorkspaceHeaderContext.Provider>);
    const shell = document.querySelector('.eg-login-shell--process');
    expect(shell).toBeInTheDocument();
    expect(shell?.closest('.cds--g100')).not.toBeNull();
    expect(document.querySelector('.eg-login-landscape')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(document.querySelector('.eg-login-header')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'public-auth-main');
    expect(screen.getByRole('button', { name: 'Go to login now' })).toBeInTheDocument();
  });
});
