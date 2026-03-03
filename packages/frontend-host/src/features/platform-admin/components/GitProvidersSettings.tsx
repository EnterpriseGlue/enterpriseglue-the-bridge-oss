import React, { useState } from 'react';
import {
  Toggle,
  TextInput,
  Checkbox,
  Button,
  Tag,
  InlineNotification,
  SkeletonText,
  Modal,
} from '@carbon/react';
import { GitProviderIcon } from '../../shared/components/GitProviderIcon';

interface GitProvider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  apiUrl: string;
  customBaseUrl: string | null;
  customApiUrl: string | null;
  isActive: boolean;
  displayOrder: number;
  supportsOAuth: boolean;
  supportsPAT: boolean;
  projectConnectionsCount?: number;
  gitConnectionsCount?: number;
  hasProjectConnections?: boolean;
  hasGitConnections?: boolean;
}

interface GitProvidersSettingsProps {
  providers: GitProvider[];
  isLoading: boolean;
  onUpdateProvider: (id: string, updates: Partial<GitProvider>) => Promise<void>;
}

export default function GitProvidersSettings({
  providers,
  isLoading,
  onUpdateProvider,
}: GitProvidersSettingsProps) {
  const [configProvider, setConfigProvider] = useState<GitProvider | null>(null);
  const [formData, setFormData] = useState<{ useCustomUrl: boolean; customBaseUrl: string; customApiUrl: string }>({
    useCustomUrl: false,
    customBaseUrl: '',
    customApiUrl: '',
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [disableConfirmProvider, setDisableConfirmProvider] = useState<GitProvider | null>(null);
  const [disableConfirmText, setDisableConfirmText] = useState('');
  const [disableSubmitting, setDisableSubmitting] = useState(false);

  const handleToggleProvider = async (provider: GitProvider, enabled: boolean) => {
    if (enabled) {
      try {
        await onUpdateProvider(provider.id, { isActive: true });
      } catch (error) {
        console.error('Failed to toggle provider:', error);
        return false;
      }
      return true;
    }

    const projectConnections = provider.projectConnectionsCount ?? 0;
    const gitConnections = provider.gitConnectionsCount ?? 0;
    const hasUsage =
      projectConnections > 0 ||
      gitConnections > 0 ||
      provider.hasProjectConnections ||
      provider.hasGitConnections;

    if (!hasUsage) {
      try {
        await onUpdateProvider(provider.id, { isActive: false });
      } catch (error) {
        console.error('Failed to toggle provider:', error);
        return false;
      }
      return true;
    }

    setDisableConfirmProvider(provider);
    setDisableConfirmText('');
    return false;
  };

  const handleCloseDisableModal = () => {
    if (disableSubmitting) return;
    setDisableConfirmProvider(null);
    setDisableConfirmText('');
  };

  const handleConfirmDisable = async () => {
    if (!disableConfirmProvider) return;
    if (disableConfirmText.trim().toLowerCase() !== 'disable') return;

    setDisableSubmitting(true);
    try {
      await onUpdateProvider(disableConfirmProvider.id, { isActive: false });
      setDisableConfirmProvider(null);
      setDisableConfirmText('');
    } catch (error) {
      console.error('Failed to disable provider:', error);
    } finally {
      setDisableSubmitting(false);
    }
  };

  const handleOpenConfig = (provider: GitProvider) => {
    setConfigProvider(provider);
    setFormData({
      useCustomUrl: !!provider.customBaseUrl,
      customBaseUrl: provider.customBaseUrl || '',
      customApiUrl: provider.customApiUrl || '',
    });
  };

  const handleSaveProvider = async (providerId: string) => {
    setSaving(providerId);
    try {
      const updates: Partial<GitProvider> = {
        customBaseUrl: formData.useCustomUrl ? formData.customBaseUrl || null : null,
        customApiUrl: formData.useCustomUrl ? formData.customApiUrl || null : null,
      };
      await onUpdateProvider(providerId, updates);
      setConfigProvider(null);
      setFormData({ useCustomUrl: false, customBaseUrl: '', customApiUrl: '' });
    } catch (error) {
      console.error('Failed to save provider:', error);
    } finally {
      setSaving(null);
    }
  };

  const handleCloseConfig = () => {
    if (saving) return;
    setConfigProvider(null);
    setFormData({ useCustomUrl: false, customBaseUrl: '', customApiUrl: '' });
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
        <div>
          <SkeletonText heading width="160px" />
          <div style={{ marginTop: 'var(--spacing-2)' }}>
            <SkeletonText paragraph lineCount={2} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          <SkeletonText width="85%" />
          <SkeletonText width="90%" />
          <SkeletonText width="80%" />
          <SkeletonText width="88%" />
        </div>
      </div>
    );
  }

  const sortedProviders = [...providers].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
      <div>
        <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '16px', fontWeight: 600 }}>
          Git Providers
        </h3>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          Configure which Git providers are available for online project creation. You can enable/disable
          providers and override URLs for self-hosted instances.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sortedProviders.map((provider) => {
          return (
            <div
              key={provider.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-3)',
                padding: 'var(--spacing-3) 0',
                borderBottom: '1px solid var(--cds-border-subtle-01, #e0e0e0)',
              }}
            >
              <GitProviderIcon type={provider.type} size={20} />
              <span style={{ flex: 1, fontWeight: 500 }}>{provider.name}</span>
              <Tag type={provider.isActive ? 'green' : 'gray'} size="sm">
                {provider.isActive ? 'Enabled' : 'Disabled'}
              </Tag>
              {provider.customBaseUrl && (
                <Tag type="blue" size="sm">
                  Custom
                </Tag>
              )}
              <Button kind="tertiary" size="sm" onClick={() => handleOpenConfig(provider)}>
                Configure
              </Button>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!configProvider}
        onRequestClose={handleCloseConfig}
        modalHeading={configProvider ? `${configProvider.name} settings` : 'Git provider settings'}
        primaryButtonText={saving ? 'Saving...' : 'Save changes'}
        secondaryButtonText="Cancel"
        onRequestSubmit={() => {
          if (!configProvider) return;
          handleSaveProvider(configProvider.id);
        }}
        primaryButtonDisabled={!!saving}
      >
        {configProvider && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-4)',
              paddingTop: 'var(--spacing-4)',
            }}
          >
            <div>
              <Toggle
                id={`toggle-${configProvider.id}`}
                labelText="Enable provider"
                labelA="Disabled"
                labelB="Enabled"
                size="sm"
                toggled={configProvider.isActive}
                onToggle={async (checked) => {
                  const applied = await handleToggleProvider(configProvider, checked);
                  if (applied) {
                    setConfigProvider({ ...configProvider, isActive: checked });
                    return;
                  }
                  setConfigProvider(null);
                }}
              />
              <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                {configProvider.isActive
                  ? 'Users can create projects with this Git provider'
                  : 'This provider will not appear in project creation'}
              </p>
            </div>

            <TextInput
              id={`default-url-${configProvider.id}`}
              labelText="Default Base URL"
              value={configProvider.baseUrl}
              readOnly
              helperText="This is the standard URL and cannot be changed"
            />

            <Checkbox
              id={`use-custom-${configProvider.id}`}
              labelText="Use custom URL (for self-hosted instances)"
              checked={formData.useCustomUrl}
              onChange={(_, { checked }) => setFormData({ ...formData, useCustomUrl: checked })}
            />

            {formData.useCustomUrl && (
              <>
                <TextInput
                  id={`custom-base-url-${configProvider.id}`}
                  labelText="Custom Base URL"
                  placeholder="https://github.company.local"
                  value={formData.customBaseUrl}
                  onChange={(e) => setFormData({ ...formData, customBaseUrl: e.target.value })}
                  helperText="Enter your self-hosted instance URL"
                />

                <TextInput
                  id={`custom-api-url-${configProvider.id}`}
                  labelText="Custom API URL"
                  placeholder="https://github.company.local/api"
                  value={formData.customApiUrl}
                  onChange={(e) => setFormData({ ...formData, customApiUrl: e.target.value })}
                  helperText="Enter your self-hosted API endpoint"
                />

                <InlineNotification
                  kind="info"
                  title="Custom URL configured"
                  subtitle="Users will use this URL instead of the default"
                  hideCloseButton
                  lowContrast
                />
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!disableConfirmProvider}
        onRequestClose={handleCloseDisableModal}
        modalHeading={disableConfirmProvider ? `Disable ${disableConfirmProvider.name}` : 'Disable provider'}
        primaryButtonText="Disable"
        secondaryButtonText="Cancel"
        danger
        onRequestSubmit={handleConfirmDisable}
        primaryButtonDisabled={
          disableSubmitting || disableConfirmText.trim().toLowerCase() !== 'disable'
        }
      >
        {disableConfirmProvider && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-4)',
              paddingTop: 'var(--spacing-4)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: '14px',
                color: 'var(--color-text-secondary)',
              }}
            >
              Disabling this Git provider will prevent users from creating new projects or Git
              connections using {disableConfirmProvider.name}. Existing project integrations and
              Git connections will remain, but users will not be able to create new ones with this
              provider.
            </p>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              <div>
                Projects with Git repositories on this provider:{' '}
                <strong>{disableConfirmProvider.projectConnectionsCount ?? 0}</strong>
              </div>
              <div>
                Git connections (stored credentials) for this provider:{' '}
                <strong>{disableConfirmProvider.gitConnectionsCount ?? 0}</strong>
              </div>
            </div>
            <TextInput
              id="disable-provider-confirm"
              labelText='To confirm, type "disable"'
              value={disableConfirmText}
              onChange={(e) => setDisableConfirmText(e.target.value)}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
