import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Button, InlineLoading, InlineNotification, Stack, TextInput } from '@carbon/react';
import PublicAuthShell from '../shared/components/PublicAuthShell';
import { apiClient } from '../shared/api/client';

type Mode = 'request' | 'register' | 'signin';

export default function CloudEmailAuth() {
  const path = useLocation().pathname;
  const mode: Mode = path.endsWith('/passkey') ? 'register' : path.endsWith('/signin') ? 'signin' : 'request';
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON | null>(null);
  const supported = browserSupportsWebAuthn();

  const loadOptions = useCallback(async () => {
    if (mode === 'request') return;
    setError(null);
    try {
      const result = mode === 'register'
        ? await apiClient.post<PublicKeyCredentialCreationOptionsJSON>('/api/auth/cloud-signup/email/passkey/options', {})
        : await apiClient.post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/cloud-passkey/options', {});
      setOptions(result);
    } catch {
      setOptions(null);
      setError(mode === 'register' ? 'Your email link is invalid or has expired. Request a new link.' : 'Passkey sign-in is temporarily unavailable.');
    }
  }, [mode]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  async function requestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/api/auth/cloud-signup/email/request', { email: email.trim().toLowerCase() });
      setSent(true);
    } catch {
      setError('We could not send the email right now. Please try again.');
    } finally { setBusy(false); }
  }

  async function usePasskey() {
    if (!options) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        const result = await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON });
        await apiClient.post('/api/auth/cloud-signup/email/passkey/complete', result);
        window.location.assign('/cloud/onboarding');
      } else {
        const result = await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
        await apiClient.post('/api/auth/cloud-passkey/complete', result);
        window.location.assign('/login');
      }
    } catch {
      setError('The passkey could not be verified. Try again or choose another sign-in method.');
      setOptions(null);
    } finally { setBusy(false); }
  }

  const title = mode === 'request' ? 'Sign up with email' : mode === 'register' ? 'Create your passkey' : 'Sign in with a passkey';
  const description = mode === 'request'
    ? 'We’ll email you a link to verify your address before you create an account.'
    : mode === 'register'
      ? 'Your email is verified. Save a passkey to this device or password manager to secure your Cloud account.'
      : 'Use the passkey you created for your EnterpriseGlue Cloud account.';
  return <PublicAuthShell title={title} description={description}>
    <Stack gap={5}>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Could not continue" subtitle={error} />}
      {mode === 'request' ? sent
        ? <InlineNotification kind="success" lowContrast hideCloseButton title="Check your email" subtitle="If this address can be used, we sent the next step. The link expires in 15 minutes." />
        : <form onSubmit={(event) => void requestEmail(event)}>
            <Stack gap={5}>
              <TextInput id="cloud-signup-email" labelText="Email address" type="email" autoComplete="email" required
                value={email} onChange={(event) => setEmail(event.target.value)} />
              <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a verification link'}</Button>
            </Stack>
          </form>
        : !supported
          ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Passkeys unavailable" subtitle="Use a supported browser or choose Apple, Google, or Microsoft instead." />
          : <>
              {!options && !error && <InlineLoading description="Preparing secure passkey options…" />}
              <Button disabled={!options || busy} onClick={() => void usePasskey()}>
                {busy ? 'Verifying…' : mode === 'register' ? 'Create passkey and account' : 'Sign in with passkey'}
              </Button>
              {!options && <Button kind="ghost" onClick={() => void loadOptions()}>Try again</Button>}
            </>}
      <Button as={Link} kind="ghost" to={mode === 'signin' ? '/login' : '/signup'}>
        {mode === 'signin' ? 'Other sign-in methods' : 'Other sign-up methods'}
      </Button>
      {mode === 'request' && <Button as={Link} kind="ghost" to="/signup/email/signin">Already have an email account? Sign in with a passkey</Button>}
    </Stack>
  </PublicAuthShell>;
}
