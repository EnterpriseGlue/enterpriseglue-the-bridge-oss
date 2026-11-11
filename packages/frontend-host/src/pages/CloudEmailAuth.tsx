import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '../shared/auth/cloudWebAuthn';
import { isDocumentationIntent, accountDestination } from '../utils/documentationAccess';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Button, InlineLoading, InlineNotification, Stack, TextInput } from '@carbon/react';
import PublicAuthShell from '../shared/components/PublicAuthShell';
import EmailSignupTurnstile from '../shared/components/EmailSignupTurnstile';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';

type Mode = 'request' | 'register' | 'signin' | 'continue';

export default function CloudEmailAuth() {
  const location = useLocation();
  const path = location.pathname;
  const documentation = isDocumentationIntent(location.search);
  const intentQuery = documentation ? "?intent=documentation" : "";
  const mode: Mode = path.endsWith('/passkey') ? 'register' : path.endsWith('/signin') ? 'signin'
    : path.endsWith('/continue') ? 'continue' : 'request';
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailSignedIn, setEmailSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON | null>(null);
  const [siteKey, setSiteKey] = useState<string | null | undefined>();
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const supported = browserSupportsWebAuthn();
  const challengeUnavailable = useCallback(() => setError('Verification could not load. Reload this page or choose another sign-up method.'), []);

  useEffect(() => {
    if (mode !== 'request') return;
    let active = true;
    void apiClient.get<{ siteKey: string | null }>('/api/auth/cloud-signup/email/challenge').then(challenge => {
      if (!active) return;
      if (challenge.siteKey === null || (typeof challenge.siteKey === 'string' && challenge.siteKey)) setSiteKey(challenge.siteKey);
      else challengeUnavailable();
    }).catch(() => { if (active) challengeUnavailable(); });
    return () => { active = false; };
  }, [mode, challengeUnavailable]);

  const loadOptions = useCallback(async () => {
    if (!supported || mode === 'request' || mode === 'continue') return;
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
  }, [mode, supported]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  async function requestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || siteKey === undefined || (siteKey && !challengeToken)) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/api/auth/cloud-signup/email/request', {
        email: email.trim().toLowerCase(),
        ...(documentation ? { intent: 'documentation' } : {}),
        ...(challengeToken ? { turnstileToken: challengeToken } : {}),
      });
      setSent(true);
    } catch (failure) {
      const parsed = parseApiError(failure);
      setError(parsed.status === 400 ? parsed.message : 'We could not send the email right now. Please try again.');
    } finally {
      setBusy(false);
      setChallengeToken(null);
      setChallengeAttempt(attempt => attempt + 1);
    }
  }

  async function usePasskey() {
    if (!options) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        const result = await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON });
        await apiClient.post('/api/auth/cloud-signup/email/passkey/complete', result);
        window.location.assign(accountDestination(documentation, true));
      } else {
        const result = await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
        await apiClient.post('/api/auth/cloud-passkey/complete', result);
        window.location.assign(accountDestination(documentation));
      }
    } catch {
      setError('The passkey could not be verified. Try again or choose another sign-in method.');
      setOptions(null);
    } finally { setBusy(false); }
  }

  async function finishEmailLink() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/api/auth/cloud-signup/email/complete', {});
      if (supported) setEmailSignedIn(true);
      else window.location.assign(accountDestination(documentation, true));
    } catch {
      setError('Your email link is invalid or has expired. Request a new link.');
    } finally { setBusy(false); }
  }

  async function enrollPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await apiClient.post<PublicKeyCredentialCreationOptionsJSON>('/api/auth/cloud-passkey/register/options', {});
      const result = await startRegistration({ optionsJSON });
      await apiClient.post('/api/auth/cloud-passkey/register/complete', result);
      window.location.assign(accountDestination(documentation, true));
    } catch {
      setError('We could not add a passkey. You can try again or continue to your account.');
    } finally { setBusy(false); }
  }

  const title = mode === 'request' ? (documentation ? 'Sign up with email' : 'Continue with email')
    : mode === 'register' ? 'Create your passkey' : mode === 'signin' ? 'Sign in with a passkey'
      : emailSignedIn ? 'Add a passkey' : 'Sign in with your email link';
  const description = mode === 'request'
    ? (documentation ? 'We’ll email you a verification link. Then you can create a passkey.' : 'We’ll send a one-time sign-in link to your email address.')
    : mode === 'register'
      ? 'Your email is verified. Save a passkey to this device or password manager to secure your EnterpriseGlue account.'
      : mode === 'signin' ? 'Use the passkey you created for your EnterpriseGlue account.'
        : emailSignedIn ? 'Add a passkey to sign in with your device or password manager next time.' : 'Use the link you received to open your EnterpriseGlue account.';
  return <PublicAuthShell title={title} description={description}>
    <Stack gap={5}>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Could not continue" subtitle={error} />}
      {mode === 'request' ? sent
        ? <InlineNotification kind="success" lowContrast hideCloseButton title="Check your email" subtitle="If this address can be used, we sent the next step. The link expires in 15 minutes." />
        : <form onSubmit={(event) => void requestEmail(event)}>
            <Stack gap={5}>
              <TextInput id="cloud-signup-email" labelText="Email address" type="email" autoComplete="email" required
                value={email} onChange={(event) => setEmail(event.target.value)} />
              {siteKey && <EmailSignupTurnstile key={challengeAttempt} siteKey={siteKey}
                onToken={setChallengeToken} onError={challengeUnavailable} />}
              <Button type="submit" disabled={busy || siteKey === undefined || (!!siteKey && !challengeToken)}>
                {busy ? 'Sending…' : 'Email me a verification link'}
              </Button>
            </Stack>
          </form>
        : mode === 'continue' ? emailSignedIn ? <>
            <Button disabled={busy} onClick={() => void enrollPasskey()}>Add a passkey</Button>
            <Button kind="ghost" disabled={busy} onClick={() => window.location.assign(accountDestination(documentation, true))}>Continue to your account</Button>
          </> : <>
            <Button disabled={busy} onClick={() => void finishEmailLink()}>Sign in with email</Button>
            {error && <Button as={Link} kind="ghost" to={`/signup/email${intentQuery}`}>Request a new link</Button>}
          </>
        : !supported
          ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Passkeys unavailable" subtitle="Use a supported browser or choose another sign-in method." />
          : <>
              {!options && !error && <InlineLoading description="Preparing secure passkey options…" />}
              <Button disabled={!options || busy} onClick={() => void usePasskey()}>
                {busy ? 'Verifying…' : mode === 'register' ? 'Create passkey and account' : 'Sign in with passkey'}
              </Button>
              {!options && <Button kind="ghost" onClick={() => void loadOptions()}>Try again</Button>}
            </>}
      {!emailSignedIn && <Button as={Link} kind="ghost" to={documentation && mode === 'signin' ? '/documentation/access' : `${mode === 'signin' || mode === 'continue' ? '/login' : '/signup'}${intentQuery}`}>
        {mode === 'signin' ? 'Other sign-in methods' : 'Other sign-up methods'}
      </Button>}
      {mode === 'request' && <Button as={Link} kind="ghost" to={`/signup/email/signin${intentQuery}`}>Already have an email account? Sign in with a passkey</Button>}
    </Stack>
  </PublicAuthShell>;
}
