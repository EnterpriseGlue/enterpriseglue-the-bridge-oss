import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Button,
  InlineLoading,
  Tile,
} from '@carbon/react';
import { Checkmark, UserFollow, Login as LoginIcon } from '@carbon/icons-react';
import { useAuth } from '../shared/hooks/useAuth';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useToast } from '../shared/notifications/ToastProvider';

interface InviteInfo {
  email: string;
  tenantName: string;
  tenantSlug: string;
  resourceType: 'tenant' | 'project' | 'engine';
  role: string;
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { notify } = useToast();

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (token) {
      loadInviteInfo();
    }
  }, [token]);

  const loadInviteInfo = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<InviteInfo>(`/api/invitations/${token}`);
      setInviteInfo(data);
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to load invitation');
      notify({ kind: 'error', title: 'Failed to load invitation', subtitle: parsed.message });
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!token) return;

    try {
      setAccepting(true);

      const data = await apiClient.post<{ tenantSlug: string }>(`/api/invitations/${token}/accept`);
      setAccepted(true);
      setTimeout(() => {
        navigate(`/t/${data.tenantSlug}/`);
      }, 2000);
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to accept invitation');
      notify({ kind: 'error', title: 'Failed to accept invitation', subtitle: parsed.message });
    } finally {
      setAccepting(false);
    }
  };

  const resourceLabel = inviteInfo?.resourceType === 'tenant' ? 'workspace' : inviteInfo?.resourceType;
  const isEmailMismatch = Boolean(
    isAuthenticated && inviteInfo && user?.email && user.email.toLowerCase() !== inviteInfo.email.toLowerCase()
  );

  useEffect(() => {
    if (!isEmailMismatch || !inviteInfo) return;
    notify({
      kind: 'warning',
      title: 'Email mismatch',
      subtitle: `This invitation was sent to ${inviteInfo.email}, but you're logged in as ${user?.email}.`,
    });
  }, [isEmailMismatch, inviteInfo, notify, user?.email]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-primary)',
        }}
      >
        <InlineLoading description="Loading invitation..." />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-primary)',
        padding: 'var(--spacing-6)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-6)' }}>
          <UserFollow size={48} style={{ color: 'var(--cds-interactive-01)', marginBottom: 'var(--spacing-4)' }} />
          <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: 'var(--spacing-2)' }}>
            You're invited!
          </h1>
        </div>

        <Tile style={{ padding: 'var(--spacing-6)' }}>
          {accepted ? (
            <div style={{ textAlign: 'center' }}>
              <Checkmark size={48} style={{ color: 'var(--cds-support-success)', marginBottom: 'var(--spacing-4)' }} />
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: 'var(--spacing-3)' }}>
                Invitation accepted!
              </h2>
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-4)' }}>
                Redirecting to your workspace...
              </p>
              <InlineLoading description="Redirecting..." />
            </div>
          ) : inviteInfo ? (
            <div>
              <p style={{ fontSize: '16px', marginBottom: 'var(--spacing-4)' }}>
                You've been invited to join the <strong>{inviteInfo.tenantName}</strong> {resourceLabel} on EnterpriseGlue.
              </p>

              <div
                style={{
                  backgroundColor: 'var(--color-bg-tertiary)',
                  padding: 'var(--spacing-4)',
                  borderRadius: '4px',
                  marginBottom: 'var(--spacing-5)',
                }}
              >
                <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>
                  Invitation for:
                </p>
                <p style={{ fontWeight: 600 }}>{inviteInfo.email}</p>
              </div>

              {isAuthenticated ? (
                user?.email?.toLowerCase() === inviteInfo.email.toLowerCase() ? (
                  <Button
                    renderIcon={Checkmark}
                    onClick={handleAccept}
                    disabled={accepting}
                    style={{ width: '100%' }}
                  >
                    {accepting ? 'Accepting...' : 'Accept Invitation'}
                  </Button>
                ) : (
                  <div>
                    <p style={{ marginBottom: 'var(--spacing-4)', color: 'var(--color-text-secondary)', fontSize: '14px' }}>
                      This invitation was sent to {inviteInfo.email}, but you're logged in as {user?.email}. Please log out and sign in with the correct account.
                    </p>
                    <Button kind="secondary" onClick={() => navigate('/login')} style={{ width: '100%' }}>
                      Switch Account
                    </Button>
                  </div>
                )
              ) : (
                <div>
                  <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-4)' }}>
                    Please sign in to accept this invitation.
                  </p>
                  <Button
                    renderIcon={LoginIcon}
                    onClick={() => navigate(`/login`, { state: { from: { pathname: `/t/${inviteInfo.tenantSlug}/invite/${token}` } } })}
                    style={{ width: '100%' }}
                  >
                    Sign in to continue
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--color-text-secondary)' }}>
                This invitation is invalid or has expired.
              </p>
            </div>
          )}
        </Tile>

        <p style={{ textAlign: 'center', marginTop: 'var(--spacing-5)', color: 'var(--color-text-secondary)' }}>
          <Link to="/" style={{ color: 'var(--cds-link-01)' }}>
            Go to home page
          </Link>
        </p>
      </div>
    </div>
  );
}
