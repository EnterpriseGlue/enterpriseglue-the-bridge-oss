import { Button } from '@carbon/react';
import { Login } from '@carbon/icons-react';
import type { PublicLoginProvider } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import googleLogo from '../../assets/login/google.png';
import microsoftLogo from '../../assets/login/microsoft.svg';
import appleLogo from '../../assets/login/apple.svg';

type ProviderBrand = 'google' | 'microsoft' | 'apple';

// Exact public names only: configuration keys and domains are not brand proof.
// This affects artwork, never provider identity, routing, or authorization.
export function getLoginProviderBrand(provider: PublicLoginProvider): ProviderBrand | null {
  if (provider.loginMethod !== 'redirect' || provider.protocol === 'ldap') return null;
  switch (provider.displayName.trim().toLowerCase()) {
    case 'google':
    case 'google workspace': return 'google';
    case 'microsoft':
    case 'microsoft entra id':
    case 'microsoft entra': return 'microsoft';
    case 'apple':
    case 'sign in with apple': return 'apple';
    default: return null;
  }
}

export default function LoginProviderButton({ provider, primary, disabled, onClick }: {
  provider: PublicLoginProvider;
  primary: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const brand = getLoginProviderBrand(provider);
  const label = brand === 'microsoft' ? 'Sign in with Microsoft'
    : brand === 'google' ? 'Continue with Google'
      : brand === 'apple' ? 'Continue with Apple'
        : `Continue with ${provider.displayName}`;
  const organization = provider.organization?.trim();
  const supporting = organization && organization.toLowerCase() !== provider.displayName.trim().toLowerCase()
    && organization.toLowerCase() !== brand ? organization : null;
  const accessibleLabel = `${label}${supporting ? ` ${supporting}` : ''}`;

  return <div className="eg-login-provider-option">
    {brand ? <button
      type="button"
      className={`eg-login-provider-button eg-login-provider-button--${brand}`}
      aria-label={accessibleLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <img src={brand === 'google' ? googleLogo : brand === 'apple' ? appleLogo : microsoftLogo} alt="" aria-hidden="true" className="eg-login-provider-logo" />
      <span className="eg-login-provider-button__action">{label}</span>
    </button> : <Button
      type="button"
      kind={primary ? 'primary' : 'tertiary'}
      size="md"
      className="eg-login-provider-button"
      aria-label={accessibleLabel}
      renderIcon={Login}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="eg-login-provider-button__action">{label}</span>
    </Button>}
  </div>;
}
