import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, InlineLoading, InlineNotification, Stack } from '@carbon/react';
import PublicAuthShell from '../shared/components/PublicAuthShell';
import LoginProviderButton from '../shared/components/LoginProviderButton';
import { apiClient } from '../shared/api/client';
import { useAuth } from '../shared/hooks/useAuth';
import { clearDocumentationRequest, getDocumentationRequest } from '../utils/documentationAccess';

type Provider = { id: string; displayName: string; protocol: 'oidc' | 'saml' };
export default function DocumentationAccess() {
  const location = useLocation();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [request] = useState(() => getDocumentationRequest(location.search));
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [busy, setBusy] = useState(false);
  const [documentationOrigin, setDocumentationOrigin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (request) return;
    let active = true;
    void apiClient.get<{documentationOrigin: string}>('/api/auth/documentation/configuration').then((value) => {
      const origin = new URL(value.documentationOrigin);
      if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) throw new Error();
      if (active) setDocumentationOrigin(origin.origin);
    }).catch(() => { if (active) setError('Documentation access is not available yet. Please return to the documentation link supplied to you.'); });
    return () => { active = false; };
  }, [request]);
  const continueToDocumentation = useCallback(async () => {
    if (!request) return;
    setBusy(true); setError(null);
    try {
      const result = await apiClient.post<{ callbackUrl: string }>('/api/auth/documentation/grant', { state: request.state, challenge: request.challenge });
      const callback = new URL(result.callbackUrl);
      // The server pins the canonical origin. Reject malformed callback URLs before navigation.
      if (callback.protocol !== 'https:' || callback.pathname !== '/auth/callback') throw new Error();
      clearDocumentationRequest();
      window.location.assign(callback.toString());
    } catch { setBusy(false); setError('We could not open documentation. Try again, or return to the documentation site to restart sign-in.'); }
  }, [request]);
  useEffect(() => {
    if (isLoading || isAuthenticated || !request) return;
    let active = true;
    void apiClient.get<Provider[]>('/api/auth/cloud-signup/providers')
      .then((value) => { if (active) setProviders(value); })
      .catch(() => { if (active) setError('Account sign-in is temporarily unavailable. Please try again later.'); })
      .finally(() => { if (active) setLoadingProviders(false); });
    return () => { active = false; };
  }, [isLoading, isAuthenticated, request]);
  return <PublicAuthShell title="Documentation access" description="Use your EnterpriseGlue account to read documentation. No Cloud organization or workspace is required.">
    <Stack gap={5}>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Could not continue" subtitle={error} />}
      {!request ? <><InlineNotification kind="info" lowContrast hideCloseButton title="Start from the documentation site" subtitle="Open the configured documentation site to begin a secure sign-in. Your account remains available without creating a Cloud organization." />{documentationOrigin && <Button as="a" href={documentationOrigin} kind="primary">Open documentation</Button>}</>
        : isLoading ? <InlineLoading description="Checking your account session…" />
        : isAuthenticated && user?.mustResetPassword ? <Button as={Link} to="/reset-password">Complete required password reset</Button>
        : isAuthenticated && user?.isEmailVerified === false ? <Button as={Link} to="/resend-verification">Verify your email address</Button>
        : isAuthenticated ? <Button disabled={busy} onClick={() => void continueToDocumentation()}>{busy ? 'Opening documentation…' : 'Continue to documentation'}</Button>
        : <>
          {loadingProviders && <InlineLoading description="Loading sign-in methods…" />}
          {providers.map((provider) => <LoginProviderButton key={provider.id}
            provider={{ ...provider, key: provider.id, organization: null, loginMethod: 'redirect', preferred: false, loginDomains: [] }} primary={false} disabled={false}
            onClick={() => window.location.assign(`/api/auth/cloud-signup/providers/${encodeURIComponent(provider.id)}/start?returnTo=${encodeURIComponent('/documentation/access')}`)} />)}
          <Button as={Link} kind="secondary" to="/signup/email/signin?intent=documentation">Sign in with a passkey</Button>
          <Button as={Link} kind="ghost" to="/signup?intent=documentation">Create free account</Button>
        </>}
    </Stack>
  </PublicAuthShell>;
}
