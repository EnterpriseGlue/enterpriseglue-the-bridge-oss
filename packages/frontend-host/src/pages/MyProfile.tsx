import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Button,
  TextInput,
  Tile,
  Tag,
} from '@carbon/react';
import { User, Save, Link as LinkIcon } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../shared/components/PageLayout';
import { useAuth } from '../shared/hooks/useAuth';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useToast } from '../shared/notifications/ToastProvider';

export default function MyProfile() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const { notify } = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
    }
  }, [user]);

  const handleSave = async () => {
    try {
      setSaving(true);

      await apiClient.patch('/api/auth/me', { firstName, lastName });
      notify({ kind: 'success', title: 'Profile updated', subtitle: 'Profile updated successfully!' });
      
      // Refresh user context
      if (refreshUser) {
        await refreshUser();
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to update profile');
      notify({ kind: 'error', title: 'Failed to update profile', subtitle: parsed.message });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = 
    firstName !== (user?.firstName || '') || 
    lastName !== (user?.lastName || '');

  return (
    <PageLayout>
      <PageHeader
        icon={User}
        title="My Profile"
        subtitle="Manage your account settings"
        gradient={PAGE_GRADIENTS.teal}
      />

      <div style={{ padding: 'var(--spacing-5)', maxWidth: '600px' }}>
        <Tile style={{ padding: 'var(--spacing-5)' }}>
          <h3 style={{ marginBottom: 'var(--spacing-5)', fontSize: '18px', fontWeight: 600 }}>
            Account Information
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: 'var(--spacing-2)' }}>
                Email
              </label>
              <span style={{ fontSize: '14px' }}>{user?.email}</span>
            </div>

            <div>
              <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: 'var(--spacing-2)' }}>
                Role
              </label>
              <Tag type={user?.capabilities?.canAccessAdminRoutes ? 'purple' : 'gray'} size="sm">
                {user?.capabilities?.canAccessAdminRoutes ? 'Platform Admin' : 'User'}
              </Tag>
            </div>

            <TextInput
              id="firstName"
              labelText="First Name"
              placeholder="Enter your first name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />

            <TextInput
              id="lastName"
              labelText="Last Name"
              placeholder="Enter your last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />

            <div style={{ display: 'flex', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-3)' }}>
              <Button
                kind="primary"
                renderIcon={Save}
                onClick={handleSave}
                disabled={saving || !hasChanges}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              {/* Git Connections moved to Project Settings → Git tab */}
            </div>
          </div>
        </Tile>

        <Tile style={{ padding: 'var(--spacing-5)', marginTop: 'var(--spacing-5)' }}>
          <h3 style={{ marginBottom: 'var(--spacing-4)', fontSize: '18px', fontWeight: 600 }}>
            Account Details
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', fontSize: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Account created</span>
              <span>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Last login</span>
              <span>{user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'N/A'}</span>
            </div>
          </div>
        </Tile>
      </div>
    </PageLayout>
  );
}
