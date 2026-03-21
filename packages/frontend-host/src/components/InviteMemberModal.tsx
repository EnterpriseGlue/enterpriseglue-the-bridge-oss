import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Modal,
  TextInput,
  Select,
  SelectItem,
  InlineNotification,
} from '@carbon/react';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';

interface InviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  resourceType: 'tenant' | 'project' | 'engine';
  resourceId?: string;
  resourceName?: string;
  availableRoles?: { id: string; label: string }[];
  defaultRole?: string;
}

interface InvitationResponse {
  invited: boolean;
  emailSent: boolean;
  emailError?: string;
  inviteUrl?: string;
  oneTimePassword?: string;
}

interface InvitationCapabilitiesResponse {
  ssoRequired: boolean;
  emailConfigured: boolean;
}

export default function InviteMemberModal({
  open,
  onClose,
  onSuccess,
  resourceType,
  resourceId,
  resourceName,
  availableRoles = [{ id: 'member', label: 'Member' }],
  defaultRole = 'member',
}: InviteMemberModalProps) {
  const { pathname } = useLocation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(defaultRole);
  const [deliveryMethod, setDeliveryMethod] = useState<'email' | 'manual'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [oneTimePassword, setOneTimePassword] = useState('');
  const [localLoginDisabled, setLocalLoginDisabled] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : 'default';

  useEffect(() => {
    if (!open) {
      return;
    }

    setCapabilitiesLoading(true);

    apiClient.get<InvitationCapabilitiesResponse>(`/api/t/${encodeURIComponent(tenantSlug)}/invitations/capabilities`)
      .then((data) => {
        const disabled = Boolean(data?.ssoRequired);
        const nextEmailConfigured = Boolean(data?.emailConfigured);
        setLocalLoginDisabled(disabled);
        setEmailConfigured(nextEmailConfigured);
        if (disabled && nextEmailConfigured) {
          setDeliveryMethod('email');
        } else if (!disabled) {
          setDeliveryMethod(nextEmailConfigured ? 'email' : 'manual');
        } else {
          setDeliveryMethod('manual');
        }
      })
      .catch(() => {
        setLocalLoginDisabled(false);
        setEmailConfigured(true);
      })
      .finally(() => setCapabilitiesLoading(false));
  }, [open, tenantSlug]);

  const deliveryOptions = [
    ...(emailConfigured ? [{ value: 'email' as const, text: 'Email invite link and one-time password' }] : []),
    ...(!localLoginDisabled ? [{ value: 'manual' as const, text: 'Reveal invite link and one-time password here' }] : []),
  ];
  const noDeliveryOptions = deliveryOptions.length === 0;

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    if (noDeliveryOptions) {
      setError('No invitation delivery method is available. Configure email delivery or disable SSO enforcement.');
      return;
    }

    if (deliveryMethod === 'manual' && localLoginDisabled) {
      setError('Local sign-in is disabled while SSO is enabled. One-time password invites are unavailable.');
      return;
    }

    if (deliveryMethod === 'email' && !emailConfigured) {
      setError('Email delivery is not configured. Configure a provider in Admin UI → Platform Settings → Email.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess('');
      setInviteUrl('');
      setOneTimePassword('');

      const result = await apiClient.post<InvitationResponse>(`/api/t/${encodeURIComponent(tenantSlug)}/invitations`, {
        email: email.trim().toLowerCase(),
        resourceType,
        resourceId: resourceType !== 'tenant' ? resourceId : undefined,
        resourceName,
        role,
        deliveryMethod,
      });

      if (result.emailSent) {
        setSuccess(`Invitation emailed to ${email.trim().toLowerCase()}`);
        setEmail('');
        setRole(defaultRole);
      } else {
        setSuccess(`Invitation created for ${email.trim().toLowerCase()}. Copy the link and one-time password now.`);
        setInviteUrl(result.inviteUrl || '');
        setOneTimePassword(result.oneTimePassword || '');
      }

      if (onSuccess) {
        onSuccess();
      }

      if (result.emailSent) {
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to send invitation');
      setError(parsed.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setRole(defaultRole);
    setDeliveryMethod('email');
    setError('');
    setSuccess('');
    setInviteUrl('');
    setOneTimePassword('');
    setLocalLoginDisabled(false);
    setEmailConfigured(true);
    setCapabilitiesLoading(false);
    onClose();
  };

  const resourceLabel = resourceType === 'tenant' ? 'workspace' : resourceType;

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      onRequestSubmit={handleSubmit}
      modalHeading={`Invite to ${resourceName || resourceLabel}`}
      primaryButtonText={loading ? 'Creating...' : 'Create Invitation'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={loading || capabilitiesLoading || !email.trim() || noDeliveryOptions}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
        {error && (
          <InlineNotification
            kind="error"
            title="Error"
            subtitle={error}
            hideCloseButton
          />
        )}

        {success && (
          <InlineNotification
            kind="success"
            title="Success"
            subtitle={success}
            hideCloseButton
          />
        )}

        {localLoginDisabled && (
          <InlineNotification
            kind="info"
            title="Local sign-in disabled"
            subtitle="One-time password invitations are unavailable while SSO is enforced."
            hideCloseButton
          />
        )}

        {!emailConfigured && !localLoginDisabled && (
          <InlineNotification
            kind="info"
            title="Email delivery unavailable"
            subtitle="Email is not configured in Admin UI → Platform Settings → Email, so invitations must be delivered manually."
            hideCloseButton
          />
        )}

        {noDeliveryOptions && (
          <InlineNotification
            kind="warning"
            title="No delivery method available"
            subtitle="Email is not configured and manual one-time password onboarding is unavailable while SSO is enforced."
            hideCloseButton
          />
        )}

        <TextInput
          id="invite-email"
          labelText="Email address"
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading || capabilitiesLoading}
        />

        {availableRoles.length > 1 && (
          <Select
            id="invite-role"
            labelText="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={loading || capabilitiesLoading}
          >
            {availableRoles.map((r) => (
              <SelectItem key={r.id} value={r.id} text={r.label} />
            ))}
          </Select>
        )}

        {!noDeliveryOptions && (
          <Select
            id="invite-delivery-method"
            labelText="Delivery Method"
            value={deliveryMethod}
            onChange={(e) => setDeliveryMethod(e.target.value as 'email' | 'manual')}
            disabled={loading || capabilitiesLoading}
          >
            {deliveryOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} text={option.text} />
            ))}
          </Select>
        )}

        {inviteUrl && oneTimePassword && (
          <>
            <TextInput
              id="invite-url"
              labelText="Invite Link"
              value={inviteUrl}
              readOnly
            />
            <TextInput
              id="invite-one-time-password"
              labelText="One-Time Password"
              value={oneTimePassword}
              readOnly
            />
          </>
        )}

        <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          The invite link and one-time password expire after 24 hours. The invited user must set a permanent password before access is activated.
        </p>
      </div>
    </Modal>
  );
}
