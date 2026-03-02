/**
 * OAuth Callback Page
 * Handles the OAuth redirect from Git providers
 * Exchanges the authorization code for tokens and closes the popup
 */

import React, { useEffect, useState } from 'react';
import { InlineLoading, InlineNotification } from '@carbon/react';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';

export default function OAuthCallback() {
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      // Get code and state from URL
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const errorParam = params.get('error');
      const errorDescription = params.get('error_description');

      // Handle OAuth error
      if (errorParam) {
        throw new Error(errorDescription || errorParam || 'OAuth authorization failed');
      }

      if (!code || !state) {
        throw new Error('Missing authorization code or state');
      }

      // Exchange code for tokens
      const credential = await apiClient.post<{ providerId: string; providerUsername: string }>(
        '/git-api/oauth/callback',
        { code, state }
      );

      // Clean up any legacy values
      sessionStorage.removeItem('oauth_state');
      sessionStorage.removeItem('oauth_provider');

      // Store success info for parent window
      sessionStorage.setItem('oauth_success', JSON.stringify({
        providerId: credential.providerId,
        providerUsername: credential.providerUsername,
      }));

      setStatus('success');

      // Close popup after short delay
      setTimeout(() => {
        window.close();
      }, 1500);

    } catch (err: any) {
      console.error('OAuth callback error:', err);
      const parsed = parseApiError(err, 'Authentication failed');
      setError(parsed.message);
      setStatus('error');

      // Clean up
      sessionStorage.removeItem('oauth_state');
      sessionStorage.removeItem('oauth_provider');

      // Close popup after showing error
      setTimeout(() => {
        window.close();
      }, 3000);
    }
  };

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
            subtitle="You can close this window. Redirecting..."
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
          {status === 'error' && 'This window will close in a few seconds.'}
        </p>
      </div>
    </div>
  );
}
