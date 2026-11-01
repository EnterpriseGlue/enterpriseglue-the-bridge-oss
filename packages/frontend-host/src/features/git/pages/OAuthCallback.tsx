/**
 * OAuth Callback Page
 * Handles the OAuth redirect from Git providers
 * Exchanges the authorization code for tokens and closes the popup
 */

import React, { useEffect, useRef, useState } from 'react';
import { InlineLoading, InlineNotification } from '@carbon/react';
import { apiClient } from '../../../shared/api/client';
import { GitCredentialSchema } from '@enterpriseglue/shared/schemas/git/repository.js';
import { getBrowserSessionRevision } from '../../../utils/browserSession';
import { GIT_OAUTH_COMPLETED, GIT_OAUTH_FAILED, isGitOAuthState } from '../api/gitOAuthPopup';

export default function OAuthCallback() {
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [error, setError] = useState<string | null>(null);

  const exchange = useRef<Promise<unknown> | null>(null);
  const input = useRef<{ code: string | null; state: string | null; invalid: boolean } | null>(null);
  const session = useRef(getBrowserSessionRevision()).current;
  if (!input.current) {
    const params = new URLSearchParams(window.location.search);
    input.current = { code: params.get('code'), state: params.get('state'), invalid: params.has('error') || params.getAll('code').length !== 1 || params.getAll('state').length !== 1 };
  }
  useEffect(() => {
    let active = true;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const current = () => active && session === getBrowserSessionRevision();
    const captured = input.current!;
    if (!exchange.current) {
      // Remove the authorization code/state from the address bar before awaiting.
      window.history.replaceState(null, '', window.location.pathname);
      exchange.current = (async () => {
        if (captured.invalid || !captured.code || captured.code.length > 8192 || !isGitOAuthState(captured.state)) throw new Error('Invalid callback');
        return apiClient.post('/git-api/oauth/callback', { code: captured.code, state: captured.state });
      })();
    }
    void exchange.current.then(raw => {
      if (!current()) return;
      const result = GitCredentialSchema.safeParse(raw);
      if (!result.success || result.data.authType !== 'oauth') throw new Error('Invalid callback receipt');
      const opener = window.opener;
      if (!opener || opener.closed) throw new Error('Original Git connection window is unavailable');
      opener.postMessage({ type: GIT_OAUTH_COMPLETED, state: captured.state, credential: result.data }, window.location.origin);
      setStatus('success');
      closeTimer = setTimeout(() => { if (current()) window.close(); }, 1500);
    }).catch(() => {
      if (!current()) return;
      setError('Git authorization was not verified. Return to the original connection window.'); setStatus('error');
      if (window.opener && isGitOAuthState(captured.state)) window.opener.postMessage({ type: GIT_OAUTH_FAILED, state: captured.state }, window.location.origin);
    });
    return () => { active = false; if (closeTimer) clearTimeout(closeTimer); };
  }, [session]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: 'var(--spacing-5)',
      backgroundColor: 'var(--cds-background)',
    }}>
      <div style={{
        maxWidth: '400px',
        width: '100%',
        textAlign: 'center',
      }}>
        <h2 style={{ marginBottom: 'var(--spacing-5)' }}>
          {status === 'processing' && 'Completing Authentication...'}
          {status === 'success' && 'Authentication Successful!'}
          {status === 'error' && 'Authentication Failed'}
        </h2>

        {status === 'processing' && (
          <InlineLoading description="Exchanging authorization code..." />
        )}

        {status === 'success' && (
          <InlineNotification
            kind="success"
            title="Connected!"
            subtitle="You can close this window."
            lowContrast
            hideCloseButton
          />
        )}

        {status === 'error' && (
          <InlineNotification
            kind="error"
            title="Connection Failed"
            subtitle={error || 'Please try again'}
            lowContrast
            hideCloseButton
          />
        )}

        <p style={{ 
          marginTop: 'var(--spacing-5)', 
          color: 'var(--cds-text-secondary)',
          fontSize: '14px'
        }}>
          {status === 'processing' && 'Please wait...'}
          {status === 'success' && 'This window will close automatically.'}
          {status === 'error' && 'Close this window after reviewing the error.'}
        </p>
      </div>
    </div>
  );
}
