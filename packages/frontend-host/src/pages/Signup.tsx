import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, InlineLoading, InlineNotification, Stack } from '@carbon/react';
import { Login } from '@carbon/icons-react';
import { ExtensionSlot } from '../enterprise/ExtensionSlot';
import { isMultiTenantEnabled } from '../enterprise/extensionRegistry';
import PublicAuthShell from '../shared/components/PublicAuthShell';
import { apiClient, ApiError } from '../shared/api/client';

type CloudSignupProvider = { id: string; displayName: string; protocol: 'oidc' | 'saml' };

/**
 * OSS Signup Page
 * 
 * In OSS single-tenant mode, self-service signup is disabled.
 * Users must be created by a platform administrator.
 * 
 * In EE multi-tenant mode, the full signup flow (with tenant creation)
 * is provided via the 'signup-form' extension slot.
 */
export default function Signup() {
  const [providers, setProviders] = useState<CloudSignupProvider[] | null>(null);
  const [cloudSignupAvailable, setCloudSignupAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await apiClient.get<CloudSignupProvider[]>('/api/auth/cloud-signup/providers');
      setProviders(result);
      setCloudSignupAvailable(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setCloudSignupAvailable(false);
        return;
      }
      setCloudSignupAvailable(true);
      setError('Cloud account signup is temporarily unavailable.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (cloudSignupAvailable === null) {
    return <PublicAuthShell title="Create your Cloud account" description="Checking available secure sign-in methods."><InlineLoading description="Loading account options…" /></PublicAuthShell>;
  }
  if (cloudSignupAvailable) {
    return (
      <PublicAuthShell title="Create your Cloud account" description="Use a verified work account, then create your EnterpriseGlue organization.">
        <Stack gap={5}>
          {error ? <InlineNotification kind="error" lowContrast hideCloseButton title="Signup unavailable" subtitle={error} /> : null}
          {!error && providers?.length === 0 ? <InlineNotification kind="info" lowContrast hideCloseButton title="No signup method configured" subtitle="A Cloud account identity provider must be configured before signup can continue." /> : null}
          {providers?.map((provider) => (
            <Button key={provider.id} onClick={() => window.location.assign(`/api/auth/cloud-signup/providers/${encodeURIComponent(provider.id)}/start?returnTo=${encodeURIComponent('/cloud/onboarding')}`)}>
              Continue with {provider.displayName}
            </Button>
          ))}
          {error ? <Button kind="secondary" onClick={() => void load()}>Retry</Button> : null}
          <Button as={Link} kind="ghost" to="/login" renderIcon={Login}>Already have an account?</Button>
        </Stack>
      </PublicAuthShell>
    );
  }

  // Preserve the legacy multi-tenant extension slot during the plugin-architecture migration.
  const multiTenantEnabled = isMultiTenantEnabled();
  if (multiTenantEnabled) {
    return <ExtensionSlot name="signup-form" fallback={<OSSSignupMessage />} />;
  }
  return <OSSSignupMessage />;
}

/**
 * OSS Signup Message - Displayed when self-service signup is disabled
 */
function OSSSignupMessage() {
  return (
    <PublicAuthShell
      title="Account registration"
      description="Self-service signup is not available on this EnterpriseGlue instance."
    >
      <InlineNotification
        kind="info"
        lowContrast
        hideCloseButton
        title="Administrator-created accounts"
        subtitle="This OSS installation uses single-tenant account administration. Contact a platform administrator to request access."
      />
      <div className="eg-public-auth-actions">
        <Button as={Link} to="/login" renderIcon={Login}>Go to login</Button>
      </div>
    </PublicAuthShell>
  );
}
