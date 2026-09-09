import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PublicLoginProvider } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import LoginProviderButton, { getLoginProviderBrand } from '@src/shared/components/LoginProviderButton';
import googleLogo from '@src/assets/login/google.png';
import microsoftLogo from '@src/assets/login/microsoft.svg';
import appleLogo from '@src/assets/login/apple.svg';

const provider = (displayName: string, overrides: Partial<PublicLoginProvider> = {}): PublicLoginProvider => ({
  id: 'provider-1', key: 'private-config-key', displayName, organization: null,
  protocol: 'oidc', loginMethod: 'redirect', preferred: false, loginDomains: [], ...overrides,
});

describe('LoginProviderButton', () => {
  it.each([
    ['Google', 'google', 'Continue with Google', googleLogo],
    ['Google Workspace', 'google', 'Continue with Google', googleLogo],
    ['Microsoft', 'microsoft', 'Sign in with Microsoft', microsoftLogo],
    ['Microsoft Entra ID', 'microsoft', 'Sign in with Microsoft', microsoftLogo],
    ['Apple', 'apple', 'Continue with Apple', appleLogo],
  ])('uses official artwork for %s without changing its click action', async (name, brand, label, asset) => {
    const onClick = vi.fn();
    render(<LoginProviderButton provider={provider(name)} primary disabled={false} onClick={onClick} />);
    const button = screen.getByRole('button', { name: label });
    expect(button).toHaveClass(`eg-login-provider-button--${brand}`);
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('img')).toHaveAttribute('src', asset);
    expect(button.querySelector('img')).toHaveAttribute('alt', '');
    expect(button.querySelector('svg')).toBeNull();
    expect(screen.queryByText('private-config-key')).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('omits organization captions while preserving accessible provider disambiguation', () => {
    const { rerender } = render(<LoginProviderButton provider={provider('Google', { organization: ' Google ' })} primary={false} disabled={false} onClick={vi.fn()} />);
    expect(screen.queryByText('Google', { exact: true })).not.toBeInTheDocument();
    rerender(<LoginProviderButton provider={provider('Microsoft', { organization: 'Example workforce' })} primary={false} disabled={false} onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Sign in with Microsoft Example workforce' });
    expect(screen.queryByText('Example workforce')).not.toBeInTheDocument();
    expect(button).not.toHaveTextContent('Example workforce');
  });

  it.each(['Google', 'Microsoft', 'Apple', 'Corporate directory'])('does not activate disabled %s buttons', async (name) => {
    const onClick = vi.fn();
    render(<LoginProviderButton provider={provider(name)} primary={false} disabled onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not guess a brand from a key, domain, partial name, or password provider', () => {
    expect(getLoginProviderBrand(provider('Employee login', { key: 'google', loginDomains: ['google.com'] }))).toBeNull();
    expect(getLoginProviderBrand(provider('Google partner directory'))).toBeNull();
    expect(getLoginProviderBrand(provider('Apple', { protocol: 'ldap', loginMethod: 'password' }))).toBeNull();
    render(<LoginProviderButton provider={provider('Corporate directory')} primary disabled={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Continue with Corporate directory' })).toHaveClass('cds--btn--primary');
  });
});
