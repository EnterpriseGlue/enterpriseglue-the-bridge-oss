import { useState } from 'react';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : 'default';

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess('');

      await apiClient.post(`/api/t/${encodeURIComponent(tenantSlug)}/invitations`, {
        email: email.trim().toLowerCase(),
        resourceType,
        resourceId: resourceType !== 'tenant' ? resourceId : undefined,
        role,
      });

      setSuccess(`Invitation sent to ${email}`);
      setEmail('');
      setRole(defaultRole);

      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
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
    setError('');
    setSuccess('');
    onClose();
  };

  const resourceLabel = resourceType === 'tenant' ? 'workspace' : resourceType;

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      onRequestSubmit={handleSubmit}
      modalHeading={`Invite to ${resourceName || resourceLabel}`}
      primaryButtonText={loading ? 'Sending...' : 'Send Invitation'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={loading || !email.trim()}
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

        <TextInput
          id="invite-email"
          labelText="Email address"
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />

        {availableRoles.length > 1 && (
          <Select
            id="invite-role"
            labelText="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={loading}
          >
            {availableRoles.map((r) => (
              <SelectItem key={r.id} value={r.id} text={r.label} />
            ))}
          </Select>
        )}

        <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          An email will be sent with a link to accept the invitation. The invitation expires in 7 days.
        </p>
        <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginTop: 'var(--spacing-2)' }}>
          <em>Note: Invitations are available in the Enterprise Edition. In OSS, users must register before being added.</em>
        </p>
      </div>
    </Modal>
  );
}
