import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, InlineNotification, Stack, TextInput } from '@carbon/react';
import { CloudMicrosoftEmailCompleteSchema } from '@enterpriseglue/shared/schemas/auth/cloud-microsoft-email.js';
import PublicAuthShell from '../shared/components/PublicAuthShell';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';

export default function CloudMicrosoftEmail() {
  const [parameters] = useSearchParams();
  const verified = parameters.get('verified') === '1';
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/api/auth/cloud-signup/microsoft/email/request', { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (failure) {
      setError(parseApiError(failure).message || 'We could not send the verification link.');
    } finally {
      setBusy(false);
    }
  }

  async function continueSignIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.post('/api/auth/cloud-signup/microsoft/email/complete', {});
      window.location.assign(CloudMicrosoftEmailCompleteSchema.parse(result).destination);
    } catch (failure) {
      setError(parseApiError(failure).message || 'We could not finish signing you in.');
    } finally {
      setBusy(false);
    }
  }

  return <PublicAuthShell title={verified ? 'Finish Microsoft sign-in' : 'Verify your email address'}
    description={verified ? 'Continue to your EnterpriseGlue account.' : 'We’ll send you a verification link. Open it in this browser.'}>
    <Stack gap={5}>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Could not continue" subtitle={error} />}
      {verified ? <Button disabled={busy} onClick={() => void continueSignIn()}>Continue</Button>
        : sent ? <>
          <InlineNotification kind="success" lowContrast hideCloseButton title="Check your email"
            subtitle="Open the link in the same browser you used to sign in with Microsoft." />
          <Button kind="ghost" onClick={() => setSent(false)}>Use a different email address</Button>
        </> : <form onSubmit={(event) => void sendLink(event)}>
          <Stack gap={5}>
            <TextInput id="microsoft-email" labelText="Email address" type="email" autoComplete="email" required
              value={email} onChange={(event) => setEmail(event.target.value)} />
            <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a verification link'}</Button>
          </Stack>
        </form>}
      <Button as={Link} kind="ghost" to="/login">Back to sign in</Button>
    </Stack>
  </PublicAuthShell>;
}
