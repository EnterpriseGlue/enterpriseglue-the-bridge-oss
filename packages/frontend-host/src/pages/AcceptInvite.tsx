import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Button,
  InlineLoading,
  TextInput,
  PasswordInput,
  InlineNotification,
} from '@carbon/react';
import { Checkmark } from '@carbon/icons-react';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useAuth } from '../shared/hooks/useAuth';
import type { LoginResponse } from '../shared/types/auth';
import type {
  CompleteOnboardingRequest,
  InvitationInfo,
  InvitationOnboardingResponse,
  VerifyInvitationOtpRequest,
} from '@enterpriseglue/shared/schemas/platform-admin/invitation.js';
import PublicAuthShell from '../shared/components/PublicAuthShell';

const PASSWORD_REQUIREMENTS = 'Use at least 8 characters with an uppercase letter, lowercase letter, number, and symbol (!@#$%^&*_+=).';

function validateInvitationPassword(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(password)) return 'Add at least one lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Add at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Add at least one number.';
  if (!/[!@#$%^&*_+=]/.test(password)) return 'Add at least one symbol (!@#$%^&*_+=).';
  return null;
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setAuthenticatedUser } = useAuth();
  const onboardingStageKey = token ? `invite-onboarding-stage:${token}` : null;

  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InvitationInfo | null>(null);
  const [completed, setCompleted] = useState(false);
  const [stage, setStage] = useState<'redeem' | 'verify' | 'set-password'>('verify');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [oneTimePassword, setOneTimePassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [feedback, setFeedback] = useState<{ title: string; subtitle?: string } | null>(null);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (token) {
      loadInviteInfo();
    }
  }, [token]);

  useEffect(() => {
    if (!onboardingStageKey) {
      return;
    }

    const savedStage = window.sessionStorage.getItem(onboardingStageKey);
    if (savedStage === 'set-password') {
      setStage('set-password');
    }
  }, [onboardingStageKey]);


  const loadInviteInfo = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<InvitationInfo>(`/api/invitations/${token}`);
      setInviteInfo(data);
      if (data.status === 'onboarding') {
        setStage('set-password');
      } else if (data.deliveryMethod === 'email') {
        setStage('redeem');
      } else {
        setStage('verify');
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to load invitation');
      setFeedback({ title: 'Failed to load invitation', subtitle: parsed.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemEmailInvite = async () => {
    if (!token) return;

    try {
      setRedeeming(true);
      await apiClient.post<InvitationOnboardingResponse>(`/api/invitations/${token}/redeem`, {});
      setFeedback(null);
      setStage('set-password');
      if (onboardingStageKey) {
        window.sessionStorage.setItem(onboardingStageKey, 'set-password');
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to redeem invitation');
      setFeedback({ title: 'Failed to redeem invitation', subtitle: parsed.message });
    } finally {
      setRedeeming(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!token) return;

    try {
      setVerifying(true);

      const request: VerifyInvitationOtpRequest = { oneTimePassword };
      await apiClient.post<InvitationOnboardingResponse>(`/api/invitations/${token}/verify-otp`, request);
      setFeedback(null);
      setStage('set-password');
      if (onboardingStageKey) {
        window.sessionStorage.setItem(onboardingStageKey, 'set-password');
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to verify one-time password');
      setFeedback({ title: 'Failed to verify one-time password', subtitle: parsed.message });
    } finally {
      setVerifying(false);
    }
  };

  const handleComplete = async () => {
    setSubmitAttempted(true);
    if (!firstName.trim() || !lastName.trim()) {
      setFeedback({ title: 'Name is required', subtitle: 'Enter your first name and last name to finish account setup.' });
      return;
    }

    if (validateInvitationPassword(password) || password !== confirmPassword) return;

    try {
      setCompleting(true);
      const request: CompleteOnboardingRequest = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        newPassword: password,
      };
      const response = await apiClient.post<LoginResponse>('/api/auth/complete-onboarding', request);
      setFeedback(null);
      setAuthenticatedUser(response.user);
      setCompleted(true);
      if (onboardingStageKey) {
        window.sessionStorage.removeItem(onboardingStageKey);
      }
      setTimeout(() => {
        navigate(`/t/${encodeURIComponent(inviteInfo?.tenantSlug || 'default')}/`, { replace: true });
      }, 1200);
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to complete onboarding');
      setFeedback({ title: 'Failed to complete onboarding', subtitle: parsed.message });
    } finally {
      setCompleting(false);
    }
  };

  const resourceLabel = inviteInfo?.resourceType === 'tenant'
    ? 'workspace'
    : inviteInfo?.resourceType === 'platform_user'
      ? 'platform'
      : inviteInfo?.resourceType;
  const passwordError = passwordTouched || submitAttempted ? validateInvitationPassword(password) : null;
  const confirmPasswordError = confirmPasswordTouched || submitAttempted
    ? !confirmPassword
      ? 'Confirm your new password.'
      : password !== confirmPassword
        ? 'Passwords do not match.'
        : null
    : null;
  const loginPath = inviteInfo?.tenantSlug ? `/t/${encodeURIComponent(inviteInfo.tenantSlug)}/login` : '/login';
  const inviteStatusNotice = inviteInfo?.status === 'expired'
    ? {
        kind: 'warning' as const,
        title: 'Invitation expired',
        subtitle: `This invite expired on ${new Date(inviteInfo.expiresAt).toLocaleString('en-GB')}. Ask a project owner or delegate to send a new invitation.`,
      }
    : inviteInfo?.status === 'onboarding'
      ? {
          kind: 'info' as const,
          title: 'Continue account setup',
          subtitle: inviteInfo.deliveryMethod === 'email'
            ? 'Your email invite was already redeemed. Finish your profile and password setup below.'
            : 'Your one-time password was already verified. Finish your profile and password setup below.',
        }
      : inviteInfo?.deliveryMethod === 'email' && stage === 'redeem'
        ? {
            kind: 'info' as const,
            title: 'Email invitation ready',
            subtitle: 'Click continue to redeem this one-time invite link and start account setup.',
          }
      : null;

  if (loading) {
    return (
      <PublicAuthShell title="Set up your account" description="Loading your invitation details." panelSize="wide">
        <InlineLoading description="Loading invitation..." />
      </PublicAuthShell>
    );
  }

  return (
    <PublicAuthShell
      title={completed ? 'Account ready' : 'Set up your account'}
      description={!completed && inviteInfo ? <>You have been invited to join <strong>{inviteInfo.resourceName || inviteInfo.tenantSlug}</strong> {resourceLabel ? `(${resourceLabel})` : ''}.</> : undefined}
      homePath={inviteInfo?.tenantSlug ? `/t/${encodeURIComponent(inviteInfo.tenantSlug)}/` : '/'}
      panelSize="wide"
    >
      {(publicBranding) => <>
          {feedback ? (
            <InlineNotification
              lowContrast
              kind="error"
              title={feedback.title}
              subtitle={feedback.subtitle}
              hideCloseButton
              style={{ marginBottom: 'var(--spacing-5)' }}
            />
          ) : null}
          {completed ? (
            <div>
              <Checkmark size={48} style={{ color: 'var(--cds-support-success)', marginBottom: 'var(--spacing-4)' }} />
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-4)' }}>
                {`Redirecting you into ${publicBranding.brandTitle}...`}
              </p>
              <InlineLoading description="Redirecting..." />
            </div>
          ) : inviteInfo ? (
            <div style={{ display: 'grid', gap: 'var(--spacing-5)', width: '100%' }}>
              {inviteStatusNotice ? (
                <InlineNotification
                  lowContrast
                  kind={inviteStatusNotice.kind}
                  title={inviteStatusNotice.title}
                  subtitle={inviteStatusNotice.subtitle}
                  hideCloseButton
                />
              ) : null}

              <div style={{ backgroundColor: 'var(--color-bg-tertiary)', padding: 'var(--spacing-3)', borderRadius: 4, display: 'grid', gap: '0.375rem', textAlign: 'left', justifyItems: 'start' }}>
                <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>Invitation for</div>
                <div style={{ fontWeight: 600 }}>{inviteInfo.email}</div>
              </div>

              {inviteInfo.status === 'expired' ? null : stage === 'redeem' ? (
                <div style={{ display: 'grid', gap: 'var(--spacing-4)', width: '100%' }}>
                  <Button
                    renderIcon={Checkmark}
                    onClick={handleRedeemEmailInvite}
                    disabled={redeeming}
                    className="eg-login-primary-action"
                  >
                    {redeeming ? 'Continuing...' : 'Continue to account setup'}
                  </Button>
                </div>
              ) : stage === 'verify' ? (
                <div style={{ display: 'grid', gap: 'var(--spacing-4)', width: '100%' }}>
                  <TextInput
                    id="invite-one-time-password"
                    labelText="One-time password"
                    placeholder="Enter the one-time password"
                    value={oneTimePassword}
                    onChange={(e) => setOneTimePassword(e.target.value)}
                    disabled={verifying}
                  />
                  <Button
                    renderIcon={Checkmark}
                    onClick={handleVerifyOtp}
                    disabled={verifying || !oneTimePassword.trim()}
                    className="eg-login-primary-action"
                  >
                    {verifying ? 'Verifying...' : 'Verify one-time password'}
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 'var(--spacing-4)', width: '100%' }}>
                  <TextInput
                    id="invite-first-name"
                    labelText="First name"
                    placeholder="Enter your first name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={completing}
                    required
                  />
                  <TextInput
                    id="invite-last-name"
                    labelText="Last name"
                    placeholder="Enter your last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={completing}
                    required
                  />
                  <PasswordInput
                    id="invite-password"
                    labelText="New password"
                    placeholder="Choose a strong password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setPasswordTouched(true)}
                    helperText={PASSWORD_REQUIREMENTS}
                    invalid={Boolean(passwordError)}
                    invalidText={passwordError || undefined}
                    disabled={completing}
                  />
                  <PasswordInput
                    id="invite-confirm-password"
                    labelText="Confirm password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onBlur={() => setConfirmPasswordTouched(true)}
                    helperText="Enter the same password again."
                    invalid={Boolean(confirmPasswordError)}
                    invalidText={confirmPasswordError || undefined}
                    disabled={completing}
                  />
                  <Button
                    renderIcon={Checkmark}
                    onClick={handleComplete}
                    disabled={completing || !firstName.trim() || !lastName.trim() || !password || !confirmPassword}
                    className="eg-login-primary-action"
                  >
                    {completing ? 'Finishing setup...' : 'Finish account setup'}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <InlineNotification
              lowContrast
              kind="warning"
              title="Invitation unavailable"
              subtitle="This invitation is invalid or is no longer available. Ask your administrator to send a new one."
              hideCloseButton
            />
          )}

          {(inviteInfo?.status === 'expired' || !inviteInfo) && <p style={{ marginTop: 'var(--spacing-5)' }}>
            <Link to={loginPath} style={{ color: 'var(--cds-link-01)' }}>
              Go to login
            </Link>
          </p>}
      </>}
    </PublicAuthShell>
  );
}
