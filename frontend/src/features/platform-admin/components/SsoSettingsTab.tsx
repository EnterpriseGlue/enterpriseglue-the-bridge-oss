/**
 * SSO Settings Tab Component
 * Manages SSO identity providers and claims-to-role mappings
 */

import React, { useState } from 'react';
import {
  Tile,
  Button,
  Modal,
  TextInput,
  TextArea,
  Select,
  SelectItem,
  Toggle,
  Tag,
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  InlineNotification,
  SkeletonText,
  OverflowMenu,
  OverflowMenuItem,
  NumberInput,
} from '@carbon/react';
import { Add, Edit, TrashCan, Security, Link as LinkIcon, Information } from '@carbon/icons-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { PlatformGrid, PlatformRow, PlatformCol } from './PlatformGrid';

// Types
interface SsoProvider {
  id: string;
  name: string;
  type: 'microsoft' | 'google' | 'saml' | 'oidc';
  enabled: boolean;
  clientId?: string;
  tenantId?: string;
  issuerUrl?: string;
  callbackUrl?: string;
  buttonLabel?: string;
  buttonColor?: string;
  autoProvision: boolean;
  defaultRole: string;
  hasClientSecret: boolean;
  hasCertificate: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SsoClaimsMapping {
  id: string;
  providerId?: string;
  claimType: string;
  claimKey: string;
  claimValue: string;
  targetRole: string;
  priority: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// Provider type labels
const PROVIDER_TYPES = {
  microsoft: { label: 'Microsoft Entra ID', color: '#00a4ef' },
  google: { label: 'Google', color: '#4285f4' },
  saml: { label: 'SAML 2.0', color: '#6b7280' },
  oidc: { label: 'OpenID Connect', color: '#8a3ffc' },
};

const CLAIM_TYPES = [
  { value: 'group', label: 'Group' },
  { value: 'role', label: 'Role' },
  { value: 'email_domain', label: 'Email Domain' },
  { value: 'custom', label: 'Custom' },
];

const PLATFORM_ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'developer', label: 'Developer' },
  { value: 'user', label: 'User' },
];

export default function SsoSettingsTab() {
  const queryClient = useQueryClient();
  
  // Queries
  const providersQuery = useQuery({
    queryKey: ['sso-providers'],
    queryFn: () => apiClient.get<SsoProvider[]>('/api/sso/providers'),
  });

  const ssoLoginBehaviorQuery = useQuery({
    queryKey: ['platform-settings', 'sso-login-behavior'],
    queryFn: () =>
      apiClient.get<{ ssoAutoRedirectSingleProvider: boolean }>('/api/admin/settings'),
  });
  
  const mappingsQuery = useQuery({
    queryKey: ['sso-mappings'],
    queryFn: () => apiClient.get<SsoClaimsMapping[]>('/api/authz/sso-mappings'),
  });
  
  // Provider state
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<SsoProvider | null>(null);
  const [providerForm, setProviderForm] = useState({
    name: '',
    type: 'microsoft' as 'microsoft' | 'google' | 'saml' | 'oidc',
    enabled: false,
    clientId: '',
    clientSecret: '',
    tenantId: '',
    issuerUrl: '',
    authorizationUrl: '',
    tokenUrl: '',
    entityId: '',
    ssoUrl: '',
    certificate: '',
    buttonLabel: '',
    defaultRole: 'user',
  });
  
  // Mapping state
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<SsoClaimsMapping | null>(null);
  const [mappingForm, setMappingForm] = useState({
    providerId: '',
    claimType: 'group',
    claimKey: 'groups',
    claimValue: '',
    targetRole: 'user',
    priority: 0,
  });
  
  // Delete confirmation state
  const [deleteProviderConfirm, setDeleteProviderConfirm] = useState<SsoProvider | null>(null);
  const [deleteMappingConfirm, setDeleteMappingConfirm] = useState<SsoClaimsMapping | null>(null);
  
  // Documentation modal state
  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [ssoLoginBehaviorError, setSsoLoginBehaviorError] = useState<string | null>(null);
  const [samlStatusNotice, setSamlStatusNotice] = useState<{
    kind: 'success' | 'warning' | 'error';
    title: string;
    subtitle: string;
  } | null>(null);
  const [isTestingSamlStatus, setIsTestingSamlStatus] = useState(false);
  const [copiedField, setCopiedField] = useState<'acs' | 'metadata' | null>(null);

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const samlAcsUrl =
    editingProvider?.type === 'saml' && editingProvider.callbackUrl
      ? editingProvider.callbackUrl
      : appOrigin
        ? `${appOrigin}/api/auth/saml/callback`
        : '/api/auth/saml/callback';
  const samlMetadataUrl = appOrigin
    ? `${appOrigin}/api/auth/saml/metadata`
    : '/api/auth/saml/metadata';

  const samlAcsOriginMismatch = (() => {
    if (!appOrigin) return false;
    if (!samlAcsUrl.startsWith('http://') && !samlAcsUrl.startsWith('https://')) return false;

    try {
      return new URL(samlAcsUrl).origin !== appOrigin;
    } catch {
      return false;
    }
  })();
  
  // Mutations
  const createProvider = useMutation({
    mutationFn: (data: any) => apiClient.post('/api/sso/providers', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sso-providers'] });
      setProviderFormError(null);
      closeProviderModal();
    },
    onError: (error: unknown) => {
      const parsed = parseApiError(error, 'Failed to create SSO provider');
      setProviderFormError(parsed.message);
    },
  });
  
  const updateProvider = useMutation({
    mutationFn: ({ id, ...data }: any) => apiClient.put(`/api/sso/providers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sso-providers'] });
      setProviderFormError(null);
      closeProviderModal();
    },
    onError: (error: unknown) => {
      const parsed = parseApiError(error, 'Failed to update SSO provider');
      setProviderFormError(parsed.message);
    },
  });
  
  const deleteProvider = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/sso/providers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sso-providers'] });
      setDeleteProviderConfirm(null);
    },
  });
  
  const toggleProvider = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/sso/providers/${id}/toggle`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sso-providers'] });
    },
  });

  const updateSsoLoginBehavior = useMutation({
    mutationFn: (enabled: boolean) =>
      apiClient.put('/api/admin/settings', { ssoAutoRedirectSingleProvider: enabled }),
    onSuccess: () => {
      setSsoLoginBehaviorError(null);
      queryClient.invalidateQueries({ queryKey: ['platform-settings', 'sso-login-behavior'] });
    },
    onError: (error: unknown) => {
      const parsed = parseApiError(error, 'Failed to update SSO login behavior');
      setSsoLoginBehaviorError(parsed.message);
    },
  });
  
  const createMapping = useMutation({
    mutationFn: (data: any) => apiClient.post('/api/authz/sso-mappings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sso-mappings'] });
      closeMappingModal();
    },
  });
  
  const updateMapping = useMutation({
    mutationFn: ({ id, ...data }: any) => apiClient.put(`/api/authz/sso-mappings/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sso-mappings'] });
      closeMappingModal();
    },
  });
  
  const deleteMapping = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/authz/sso-mappings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sso-mappings'] });
      setDeleteMappingConfirm(null);
    },
  });
  
  // Handlers
  const openCreateProvider = () => {
    setEditingProvider(null);
    setProviderForm({
      name: '',
      type: 'microsoft',
      enabled: false,
      clientId: '',
      clientSecret: '',
      tenantId: '',
      issuerUrl: '',
      authorizationUrl: '',
      tokenUrl: '',
      entityId: '',
      ssoUrl: '',
      certificate: '',
      buttonLabel: '',
      defaultRole: 'user',
    });
    setProviderModalOpen(true);
  };
  
  const openEditProvider = (provider: SsoProvider) => {
    setEditingProvider(provider);
    setProviderForm({
      name: provider.name,
      type: provider.type,
      enabled: provider.enabled,
      clientId: provider.clientId || '',
      clientSecret: '', // Don't show existing secret
      tenantId: provider.tenantId || '',
      issuerUrl: provider.issuerUrl || '',
      authorizationUrl: '',
      tokenUrl: '',
      entityId: '',
      ssoUrl: '',
      certificate: '',
      buttonLabel: provider.buttonLabel || '',
      defaultRole: provider.defaultRole,
    });
    setProviderModalOpen(true);
  };
  
  const closeProviderModal = () => {
    setProviderModalOpen(false);
    setEditingProvider(null);
    setProviderFormError(null);
    setSamlStatusNotice(null);
    setCopiedField(null);
  };

  const handleCopySamlValue = async (value: string, field: 'acs' | 'metadata') => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      setCopiedField(field);
      setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current));
      }, 1500);
    } catch {
      setSamlStatusNotice({
        kind: 'error',
        title: 'Copy failed',
        subtitle: 'Could not copy value to clipboard. Please copy it manually.',
      });
    }
  };

  const handleTestSamlConfig = async () => {
    setIsTestingSamlStatus(true);
    setSamlStatusNotice(null);

    try {
      const status = await apiClient.get<{
        enabled: boolean;
        message?: string;
        missingFields?: string[];
        providerConfigured?: boolean;
        providerEnabled?: boolean;
      }>('/api/auth/saml/status');

      if (status.enabled) {
        setSamlStatusNotice({
          kind: 'success',
          title: 'SAML config is reachable',
          subtitle: status.message || 'SAML authentication endpoint is configured and available.',
        });
      } else {
        const missingSummary = Array.isArray(status.missingFields) && status.missingFields.length > 0
          ? ` Missing fields: ${status.missingFields.join(', ')}.`
          : '';
        setSamlStatusNotice({
          kind: 'warning',
          title: 'SAML is not enabled yet',
          subtitle:
            (status.message || 'Complete provider fields and enable the provider before testing login.') +
            missingSummary,
        });
      }
    } catch (error: unknown) {
      const parsed = parseApiError(error, 'Failed to test SAML configuration');
      setSamlStatusNotice({
        kind: 'error',
        title: 'SAML check failed',
        subtitle: parsed.message,
      });
    } finally {
      setIsTestingSamlStatus(false);
    }
  };

  const getMissingRequiredSamlFieldsForEnable = (): string[] => {
    if (providerForm.type !== 'saml' || !providerForm.enabled) return [];

    const missing: string[] = [];
    if (!providerForm.entityId.trim()) missing.push('Entity ID');
    if (!providerForm.ssoUrl.trim()) missing.push('SSO URL');

    const hasCertificate =
      Boolean(providerForm.certificate.trim()) || Boolean(editingProvider?.hasCertificate);
    if (!hasCertificate) missing.push('IdP Certificate');

    return missing;
  };
  
  const handleSaveProvider = () => {
    setProviderFormError(null);

    const missingSamlFields = getMissingRequiredSamlFieldsForEnable();
    if (missingSamlFields.length > 0) {
      setProviderFormError(
        `Cannot enable SAML provider. Missing required fields: ${missingSamlFields.join(', ')}`
      );
      return;
    }

    const data: any = {
      name: providerForm.name,
      type: providerForm.type,
      enabled: providerForm.enabled,
      clientId: providerForm.clientId || undefined,
      tenantId: providerForm.tenantId || undefined,
      issuerUrl: providerForm.issuerUrl || undefined,
      buttonLabel: providerForm.buttonLabel || undefined,
      autoProvision: true,
      defaultRole: providerForm.defaultRole,
    };
    
    // Only include secret if provided (for updates, empty means keep existing)
    if (providerForm.clientSecret) {
      data.clientSecret = providerForm.clientSecret;
    }
    
    // SAML-specific fields
    if (providerForm.type === 'saml') {
      data.entityId = providerForm.entityId || undefined;
      data.ssoUrl = providerForm.ssoUrl || undefined;
      if (providerForm.certificate) {
        data.certificate = providerForm.certificate;
      }
    }
    
    if (editingProvider) {
      updateProvider.mutate({ id: editingProvider.id, ...data });
    } else {
      createProvider.mutate(data);
    }
  };
  
  const openCreateMapping = () => {
    setEditingMapping(null);
    setMappingForm({
      providerId: '',
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '',
      targetRole: 'user',
      priority: 0,
    });
    setMappingModalOpen(true);
  };
  
  const openEditMapping = (mapping: SsoClaimsMapping) => {
    setEditingMapping(mapping);
    setMappingForm({
      providerId: mapping.providerId || '',
      claimType: mapping.claimType,
      claimKey: mapping.claimKey,
      claimValue: mapping.claimValue,
      targetRole: mapping.targetRole,
      priority: mapping.priority,
    });
    setMappingModalOpen(true);
  };
  
  const closeMappingModal = () => {
    setMappingModalOpen(false);
    setEditingMapping(null);
  };
  
  const handleSaveMapping = () => {
    const data = {
      providerId: mappingForm.providerId || null,
      claimType: mappingForm.claimType,
      claimKey: mappingForm.claimKey,
      claimValue: mappingForm.claimValue,
      targetRole: mappingForm.targetRole,
      priority: mappingForm.priority,
    };
    
    if (editingMapping) {
      updateMapping.mutate({ id: editingMapping.id, ...data });
    } else {
      createMapping.mutate(data);
    }
  };
  
  // Update claimKey when claimType changes
  const handleClaimTypeChange = (type: string) => {
    let key = 'groups';
    switch (type) {
      case 'group': key = 'groups'; break;
      case 'role': key = 'roles'; break;
      case 'email_domain': key = 'email'; break;
      case 'custom': key = ''; break;
    }
    setMappingForm({ ...mappingForm, claimType: type, claimKey: key });
  };
  
  const providers = providersQuery.data || [];
  const mappings = mappingsQuery.data || [];
  
  const isLoading = providersQuery.isLoading || mappingsQuery.isLoading;
  const error = providersQuery.error || mappingsQuery.error;
  
  if (isLoading) {
    return (
      <PlatformGrid style={{ paddingInline: 0 }}>
        <PlatformRow>
          <PlatformCol sm={4} md={8} lg={16}>
            <SkeletonText heading width="200px" />
            <SkeletonText paragraph lineCount={4} />
          </PlatformCol>
        </PlatformRow>
      </PlatformGrid>
    );
  }
  
  if (error) {
    return (
      <InlineNotification
        kind="error"
        title="Error loading SSO settings"
        subtitle={(error as Error).message}
      />
    );
  }
  
  return (
    <PlatformGrid style={{ paddingInline: 0, alignItems: 'stretch' }}>
      {/* SSO Providers Section */}
      <PlatformRow>
        <PlatformCol sm={4} md={8} lg={16}>
          <Tile>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                  SSO Identity Providers
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  Configure SSO providers for user authentication
                </p>
              </div>
              <Button
                kind="primary"
                size="sm"
                renderIcon={Add}
                onClick={openCreateProvider}
              >
                Add Provider
              </Button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--spacing-4)',
                marginBottom: 'var(--spacing-4)',
                padding: 'var(--spacing-3)',
                borderRadius: '4px',
                background: 'var(--cds-layer-01)',
              }}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>
                  Auto-redirect login when exactly one SSO provider is enabled
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Users can bypass by opening login with <code>?local=1</code>.
                </div>
              </div>
              <Toggle
                id="sso-auto-redirect-single-provider"
                labelText=""
                hideLabel
                labelA="Off"
                labelB="On"
                toggled={Boolean(ssoLoginBehaviorQuery.data?.ssoAutoRedirectSingleProvider)}
                disabled={ssoLoginBehaviorQuery.isLoading || updateSsoLoginBehavior.isPending}
                onToggle={(checked) => updateSsoLoginBehavior.mutate(checked)}
              />
            </div>

            {ssoLoginBehaviorError && (
              <InlineNotification
                kind="error"
                title="Unable to update login redirect setting"
                subtitle={ssoLoginBehaviorError}
                onCloseButtonClick={() => setSsoLoginBehaviorError(null)}
              />
            )}
            
            {providers.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>
                No SSO providers configured. Add a provider to enable SSO authentication.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                {providers.map(provider => (
                  <div
                    key={provider.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--spacing-3)',
                      background: 'var(--cds-layer-02)',
                      borderRadius: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '4px',
                          background: PROVIDER_TYPES[provider.type]?.color || '#6b7280',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Security size={16} style={{ color: 'white' }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{provider.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                          {PROVIDER_TYPES[provider.type]?.label || provider.type}
                          {provider.clientId && ` • ${provider.clientId.slice(0, 8)}...`}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
                      <Tag type={provider.enabled ? 'green' : 'gray'}>
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                      </Tag>
                      <Toggle
                        id={`toggle-${provider.id}`}
                        size="sm"
                        toggled={provider.enabled}
                        onToggle={() => toggleProvider.mutate(provider.id)}
                        labelA=""
                        labelB=""
                        hideLabel
                      />
                      <OverflowMenu size="sm" flipped>
                        <OverflowMenuItem itemText="Edit" onClick={() => openEditProvider(provider)} />
                        <OverflowMenuItem
                          itemText="Delete"
                          isDelete
                          onClick={() => setDeleteProviderConfirm(provider)}
                        />
                      </OverflowMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Tile>
        </PlatformCol>
      </PlatformRow>
      
      {/* Claims Mapping Section */}
      <PlatformRow style={{ marginTop: 'var(--spacing-5)' }}>
        <PlatformCol sm={4} md={8} lg={16}>
          <Tile>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                  SSO Role Mappings
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  Map SSO claims (groups, roles, domains) to platform roles
                </p>
              </div>
              <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={Information}
                  onClick={() => setDocsModalOpen(true)}
                >
                  How it works
                </Button>
                <Button
                  kind="primary"
                  size="sm"
                  renderIcon={Add}
                  onClick={openCreateMapping}
                >
                  Add Mapping
                </Button>
              </div>
            </div>
            
            {mappings.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>
                No role mappings configured. Users will receive the default role from the provider.
              </p>
            ) : (
              <DataTable
                rows={mappings.map(m => ({ id: m.id }))}
                headers={[
                  { key: 'claimType', header: 'Claim Type' },
                  { key: 'claimValue', header: 'Claim Value' },
                  { key: 'targetRole', header: 'Platform Role' },
                  { key: 'priority', header: 'Priority' },
                  { key: 'actions', header: '' },
                ]}
              >
                {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
                  <TableContainer>
                    <Table {...getTableProps()} size="sm">
                      <TableHead>
                        <TableRow>
                          {headers.map(header => {
                            const { key, ...headerProps } = getHeaderProps({ header });
                            return (
                              <TableHeader key={key} {...headerProps}>
                                {header.header}
                              </TableHeader>
                            );
                          })}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map(row => {
                          const mapping = mappings.find(m => m.id === row.id)!;
                          const rowProps = getRowProps({ row });
                          const { key, ...otherRowProps } = rowProps;
                          return (
                            <TableRow key={key} {...otherRowProps}>
                              <TableCell>
                                <Tag type="blue">
                                  {CLAIM_TYPES.find(c => c.value === mapping.claimType)?.label || mapping.claimType}
                                </Tag>
                              </TableCell>
                              <TableCell>
                                <code style={{ fontSize: '12px' }}>{mapping.claimValue}</code>
                              </TableCell>
                              <TableCell>
                                <Tag type={mapping.targetRole === 'admin' ? 'purple' : mapping.targetRole === 'developer' ? 'teal' : 'gray'}>
                                  {mapping.targetRole}
                                </Tag>
                              </TableCell>
                              <TableCell>{mapping.priority}</TableCell>
                              <TableCell>
                                <OverflowMenu size="sm" flipped>
                                  <OverflowMenuItem itemText="Edit" onClick={() => openEditMapping(mapping)} />
                                  <OverflowMenuItem
                                    itemText="Delete"
                                    isDelete
                                    onClick={() => setDeleteMappingConfirm(mapping)}
                                  />
                                </OverflowMenu>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            )}
          </Tile>
        </PlatformCol>
      </PlatformRow>
      
      {/* Provider Modal */}
      <Modal
        open={providerModalOpen}
        onRequestClose={closeProviderModal}
        modalHeading={editingProvider ? `Edit ${editingProvider.name}` : 'Add SSO Provider'}
        primaryButtonText={createProvider.isPending || updateProvider.isPending ? 'Saving...' : 'Save'}
        secondaryButtonText="Cancel"
        onRequestSubmit={handleSaveProvider}
        primaryButtonDisabled={!providerForm.name || createProvider.isPending || updateProvider.isPending}
        size="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-4)' }}>
          {providerFormError && (
            <InlineNotification
              kind="error"
              title="Unable to save SSO provider"
              subtitle={providerFormError}
              onCloseButtonClick={() => setProviderFormError(null)}
            />
          )}

          <TextInput
            id="provider-name"
            labelText="Display Name"
            placeholder="e.g., Microsoft Entra ID"
            value={providerForm.name}
            onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
          />
          
          <Select
            id="provider-type"
            labelText="Provider Type"
            value={providerForm.type}
            onChange={(e) => setProviderForm({ ...providerForm, type: e.target.value as any })}
            disabled={!!editingProvider}
          >
            <SelectItem value="microsoft" text="Microsoft Entra ID" />
            <SelectItem value="google" text="Google" />
            <SelectItem value="saml" text="SAML 2.0" />
            <SelectItem value="oidc" text="OpenID Connect" />
          </Select>
          
          {(providerForm.type === 'microsoft' || providerForm.type === 'google' || providerForm.type === 'oidc') && (
            <>
              <TextInput
                id="provider-client-id"
                labelText="Client ID"
                placeholder="Application (client) ID"
                value={providerForm.clientId}
                onChange={(e) => setProviderForm({ ...providerForm, clientId: e.target.value })}
              />
              
              <TextInput
                id="provider-client-secret"
                labelText={editingProvider ? 'Client Secret (leave empty to keep existing)' : 'Client Secret'}
                placeholder="Client secret"
                type="password"
                value={providerForm.clientSecret}
                onChange={(e) => setProviderForm({ ...providerForm, clientSecret: e.target.value })}
              />
              
              {providerForm.type === 'microsoft' && (
                <TextInput
                  id="provider-tenant-id"
                  labelText="Tenant ID"
                  placeholder="Directory (tenant) ID"
                  value={providerForm.tenantId}
                  onChange={(e) => setProviderForm({ ...providerForm, tenantId: e.target.value })}
                />
              )}
              
              {providerForm.type === 'oidc' && (
                <TextInput
                  id="provider-issuer"
                  labelText="Issuer URL"
                  placeholder="https://example.com/.well-known/openid-configuration"
                  value={providerForm.issuerUrl}
                  onChange={(e) => setProviderForm({ ...providerForm, issuerUrl: e.target.value })}
                />
              )}
            </>
          )}
          
          {providerForm.type === 'saml' && (
            <>
              <InlineNotification
                kind="info"
                title="Operational checks"
                subtitle="Ensure Entra Identifier exactly matches Entity ID, and ACS URL is /api/auth/saml/callback on your app domain."
              />

              {samlAcsOriginMismatch && (
                <InlineNotification
                  kind="warning"
                  title="Callback URL origin differs from current app origin"
                  subtitle={`Current app origin: ${appOrigin}. Configured ACS URL: ${samlAcsUrl}. Ensure Entra Reply URL matches the ACS URL exactly.`}
                />
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={handleTestSamlConfig}
                  disabled={isTestingSamlStatus}
                >
                  {isTestingSamlStatus ? 'Testing...' : 'Test SAML Config'}
                </Button>
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Checks <code>/api/auth/saml/status</code> availability.
                </span>
              </div>

              {samlStatusNotice && (
                <InlineNotification
                  kind={samlStatusNotice.kind}
                  title={samlStatusNotice.title}
                  subtitle={samlStatusNotice.subtitle}
                  onCloseButtonClick={() => setSamlStatusNotice(null)}
                />
              )}

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--spacing-3)' }}>
                <div style={{ flex: 1 }}>
                  <TextInput
                    id="provider-acs-url"
                    labelText="ACS URL (Reply URL in Entra)"
                    helperText="Use this exact URL as the Reply URL / Assertion Consumer Service URL in Entra."
                    value={samlAcsUrl}
                    readOnly
                  />
                </div>
                <Button kind="secondary" size="sm" onClick={() => handleCopySamlValue(samlAcsUrl, 'acs')}>
                  {copiedField === 'acs' ? 'Copied' : 'Copy'}
                </Button>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--spacing-3)' }}>
                <div style={{ flex: 1 }}>
                  <TextInput
                    id="provider-metadata-url"
                    labelText="SP Metadata URL"
                    helperText="Share this with your identity team if they want to import Service Provider metadata."
                    value={samlMetadataUrl}
                    readOnly
                  />
                </div>
                <Button kind="secondary" size="sm" onClick={() => handleCopySamlValue(samlMetadataUrl, 'metadata')}>
                  {copiedField === 'metadata' ? 'Copied' : 'Copy'}
                </Button>
              </div>

              <div
                style={{
                  padding: 'var(--spacing-3)',
                  background: 'var(--cds-layer-01)',
                  borderRadius: '4px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: 'var(--spacing-2)' }}>
                  SAML glossary (quick)
                </div>
                <ul style={{ margin: 0, paddingLeft: 'var(--spacing-5)', fontSize: '12px', lineHeight: 1.5 }}>
                  <li><strong>Entity ID</strong>: unique ID of your app (Service Provider) in SAML.</li>
                  <li><strong>ACS URL</strong>: endpoint where Entra posts the signed SAML response.</li>
                  <li><strong>IdP Certificate</strong>: Entra signing cert used to verify SAML assertions.</li>
                </ul>
              </div>

              <TextInput
                id="provider-entity-id"
                labelText="Entity ID (SP)"
                placeholder="Service Provider Entity ID"
                helperText="Must exactly match Microsoft Entra Identifier (Entity ID)."
                value={providerForm.entityId}
                onChange={(e) => setProviderForm({ ...providerForm, entityId: e.target.value })}
              />
              
              <TextInput
                id="provider-sso-url"
                labelText="SSO URL (IdP)"
                placeholder="Identity Provider SSO URL"
                helperText="Use the Microsoft Entra Login URL (HTTPS)."
                value={providerForm.ssoUrl}
                onChange={(e) => setProviderForm({ ...providerForm, ssoUrl: e.target.value })}
              />
              
              <TextArea
                id="provider-certificate"
                labelText={editingProvider ? 'IdP Certificate (leave empty to keep existing)' : 'IdP Certificate'}
                placeholder="-----BEGIN CERTIFICATE-----..."
                helperText="Paste the X.509 signing certificate from Microsoft Entra."
                value={providerForm.certificate}
                onChange={(e) => setProviderForm({ ...providerForm, certificate: e.target.value })}
                rows={4}
              />
            </>
          )}
          
          <TextInput
            id="provider-button-label"
            labelText="Button Label (optional)"
            placeholder={`Sign in with ${PROVIDER_TYPES[providerForm.type]?.label}`}
            value={providerForm.buttonLabel}
            onChange={(e) => setProviderForm({ ...providerForm, buttonLabel: e.target.value })}
          />
          
          <Select
            id="provider-default-role"
            labelText="Default Role"
            value={providerForm.defaultRole}
            onChange={(e) => setProviderForm({ ...providerForm, defaultRole: e.target.value })}
          >
            <SelectItem value="user" text="User" />
            <SelectItem value="developer" text="Developer" />
            <SelectItem value="admin" text="Admin" />
          </Select>
          
          <Toggle
            id="provider-enabled"
            labelText="Enable Provider"
            labelA="Disabled"
            labelB="Enabled"
            toggled={providerForm.enabled}
            onToggle={(checked) => setProviderForm({ ...providerForm, enabled: checked })}
          />
        </div>
      </Modal>
      
      {/* Mapping Modal */}
      <Modal
        open={mappingModalOpen}
        onRequestClose={closeMappingModal}
        modalHeading={editingMapping ? 'Edit Role Mapping' : 'Add Role Mapping'}
        primaryButtonText={createMapping.isPending || updateMapping.isPending ? 'Saving...' : 'Save'}
        secondaryButtonText="Cancel"
        onRequestSubmit={handleSaveMapping}
        primaryButtonDisabled={!mappingForm.claimValue || createMapping.isPending || updateMapping.isPending}
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-4)' }}>
          <Select
            id="mapping-provider"
            labelText="Provider (optional)"
            helperText="Leave empty to apply to all providers"
            value={mappingForm.providerId}
            onChange={(e) => setMappingForm({ ...mappingForm, providerId: e.target.value })}
          >
            <SelectItem value="" text="All Providers" />
            {providers.map(p => (
              <SelectItem key={p.id} value={p.id} text={p.name} />
            ))}
          </Select>
          
          <Select
            id="mapping-claim-type"
            labelText="Claim Type"
            value={mappingForm.claimType}
            onChange={(e) => handleClaimTypeChange(e.target.value)}
          >
            {CLAIM_TYPES.map(ct => (
              <SelectItem key={ct.value} value={ct.value} text={ct.label} />
            ))}
          </Select>
          
          {mappingForm.claimType === 'custom' && (
            <TextInput
              id="mapping-claim-key"
              labelText="Claim Key"
              placeholder="e.g., department"
              value={mappingForm.claimKey}
              onChange={(e) => setMappingForm({ ...mappingForm, claimKey: e.target.value })}
            />
          )}
          
          <TextInput
            id="mapping-claim-value"
            labelText="Claim Value"
            placeholder={
              mappingForm.claimType === 'group' ? 'e.g., Platform-Admins' :
              mappingForm.claimType === 'email_domain' ? 'e.g., *@company.com' :
              'Value to match'
            }
            helperText="Use * for wildcard matching"
            value={mappingForm.claimValue}
            onChange={(e) => setMappingForm({ ...mappingForm, claimValue: e.target.value })}
          />
          
          <Select
            id="mapping-target-role"
            labelText="Assign Platform Role"
            value={mappingForm.targetRole}
            onChange={(e) => setMappingForm({ ...mappingForm, targetRole: e.target.value })}
          >
            {PLATFORM_ROLES.map(r => (
              <SelectItem key={r.value} value={r.value} text={r.label} />
            ))}
          </Select>
          
          <NumberInput
            id="mapping-priority"
            label="Priority"
            helperText="Higher priority mappings are evaluated first"
            min={0}
            max={1000}
            value={mappingForm.priority}
            onChange={(e, { value }) => setMappingForm({ ...mappingForm, priority: Number(value) || 0 })}
          />
        </div>
      </Modal>
      
      {/* Delete Provider Confirmation */}
      <Modal
        open={!!deleteProviderConfirm}
        onRequestClose={() => setDeleteProviderConfirm(null)}
        modalHeading="Delete SSO Provider"
        primaryButtonText={deleteProvider.isPending ? 'Deleting...' : 'Delete'}
        secondaryButtonText="Cancel"
        danger
        onRequestSubmit={() => deleteProviderConfirm && deleteProvider.mutate(deleteProviderConfirm.id)}
        primaryButtonDisabled={deleteProvider.isPending}
      >
        <p>
          Are you sure you want to delete <strong>{deleteProviderConfirm?.name}</strong>?
          Users will no longer be able to sign in using this provider.
        </p>
      </Modal>
      
      {/* Delete Mapping Confirmation */}
      <Modal
        open={!!deleteMappingConfirm}
        onRequestClose={() => setDeleteMappingConfirm(null)}
        modalHeading="Delete Role Mapping"
        primaryButtonText={deleteMapping.isPending ? 'Deleting...' : 'Delete'}
        secondaryButtonText="Cancel"
        danger
        onRequestSubmit={() => deleteMappingConfirm && deleteMapping.mutate(deleteMappingConfirm.id)}
        primaryButtonDisabled={deleteMapping.isPending}
      >
        <p>
          Are you sure you want to delete this role mapping?
          Users matching this rule will no longer be assigned the <strong>{deleteMappingConfirm?.targetRole}</strong> role.
        </p>
      </Modal>
      
      {/* Documentation Modal */}
      <Modal
        open={docsModalOpen}
        onRequestClose={() => setDocsModalOpen(false)}
        modalHeading="SSO Role Mapping Guide"
        passiveModal
        size="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
          <section>
            <h4 style={{ margin: '0 0 var(--spacing-3) 0', fontSize: '14px', fontWeight: 600 }}>
              How Role Mapping Works
            </h4>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              When a user signs in via SSO, the platform checks their claims (groups, roles, email domain) 
              against your configured mappings. The first matching rule determines their platform role.
            </p>
          </section>
          
          <section>
            <h4 style={{ margin: '0 0 var(--spacing-3) 0', fontSize: '14px', fontWeight: 600 }}>
              Claim Types
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
              <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-start' }}>
                <Tag type="blue" size="sm" style={{ flexShrink: 0 }}>Group</Tag>
                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Match users by their SSO group membership (e.g., <code>Platform-Admins</code>)
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-start' }}>
                <Tag type="blue" size="sm" style={{ flexShrink: 0 }}>Role</Tag>
                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Match users by their SSO role claim (e.g., <code>developer</code>)
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-start' }}>
                <Tag type="blue" size="sm" style={{ flexShrink: 0 }}>Email Domain</Tag>
                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Match users by email domain (e.g., <code>*@company.com</code>)
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-start' }}>
                <Tag type="blue" size="sm" style={{ flexShrink: 0 }}>Custom</Tag>
                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Match any custom claim from the SSO provider
                </span>
              </div>
            </div>
          </section>
          
          <section>
            <h4 style={{ margin: '0 0 var(--spacing-3) 0', fontSize: '14px', fontWeight: 600 }}>
              Priority
            </h4>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              Rules with higher priority numbers are evaluated first. If a user matches multiple rules, 
              the highest priority match wins. Use this to ensure admin mappings take precedence over general rules.
            </p>
          </section>
          
          <section>
            <h4 style={{ margin: '0 0 var(--spacing-3) 0', fontSize: '14px', fontWeight: 600 }}>
              Wildcards
            </h4>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              Use <code>*</code> for wildcard matching. For example, <code>*@company.com</code> matches 
              all emails from that domain, or <code>Dev-*</code> matches all groups starting with "Dev-".
            </p>
          </section>
          
          <section style={{ background: 'var(--cds-layer-02)', padding: 'var(--spacing-4)', borderRadius: '4px' }}>
            <h4 style={{ margin: '0 0 var(--spacing-3) 0', fontSize: '14px', fontWeight: 600 }}>
              Example Configuration
            </h4>
            <div style={{ fontSize: '13px', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
              <div><strong>Priority 100:</strong> Group = "IT-Admins" → Admin</div>
              <div><strong>Priority 50:</strong> Group = "Developers" → Developer</div>
              <div><strong>Priority 10:</strong> Email = "*@company.com" → User</div>
            </div>
          </section>
        </div>
      </Modal>
    </PlatformGrid>
  );
}
