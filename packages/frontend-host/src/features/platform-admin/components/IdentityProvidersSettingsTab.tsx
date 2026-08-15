import React, { useCallback, useMemo, useState } from 'react';
import {
  ActionableNotification, Button, Callout, DataTable, InlineNotification, Modal, NumberInput, Select, SelectItem, SkeletonText, Table, TableBody,
  ProgressIndicator, ProgressStep, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextInput, Tile, Toggle,
} from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import { useUnsavedChangesGuard } from '../../../shared/hooks/useUnsavedChangesGuard';
import { GuardedAction, GuardedOverflowMenu, GuardedOverflowMenuItem, UnauthorizedEmptyState, useActionDecision } from '../../../shared/auth/guards';
import { authzQueryKeys, useIdentityProviders } from '../hooks/useAuthzApi';
import {
  configurationOwnershipDescription,
  configurationOwnershipLabel,
  configurationSourceName,
  countPhrase,
  identityProviderName,
  MAX_LOGIN_LABEL_LENGTH,
  providerLoginLabel,
  savedMembershipApplicationCopy,
  syncRunStatusLabel,
  syncRunTriggerLabel,
} from '../identityAccessCopy';
import type {
  IdentityProvider,
  IdentityProviderConnectionTestResult,
  IdentityProviderExternalIdentityUnlinkResult,
  IdentityProviderMembershipPreviewResult,
  IdentityProviderMembershipReplayResult,
  IdentityProviderProtocol,
  SsoSyncRun,
} from '../hooks/useAuthzApi';
import type {
  LocalPasswordLoginMode,
  SsoProviderSelectionMode,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

type Protocol = IdentityProviderProtocol;
type AuthenticationMode = 'direct' | 'claims_only';

export function isConfigLockedIdentityProvider(provider: { ownershipMode?: string | null } | null | undefined): boolean {
  return provider?.ownershipMode === 'config_locked';
}

export function isConfigWarnIdentityProvider(provider: { ownershipMode?: string | null } | null | undefined): boolean {
  return provider?.ownershipMode === 'config_warn';
}
type MembershipReplayResult = IdentityProviderMembershipReplayResult;
type MembershipPreviewResult = IdentityProviderMembershipPreviewResult;
type ConnectionTestResult = IdentityProviderConnectionTestResult;
type ProviderActionError = { title: string; message: string };

interface IdentityProvidersSettingsTabProps {
  loginPolicy?: {
    localPasswordLoginMode: LocalPasswordLoginMode;
    ssoProviderSelectionMode: SsoProviderSelectionMode;
  } | null;
  canManageLoginPolicy?: boolean;
  loginPolicyUnavailableReason?: string | null;
  onLoginPolicyChange?: (update: Partial<{
    localPasswordLoginMode: LocalPasswordLoginMode;
    ssoProviderSelectionMode: SsoProviderSelectionMode;
  }>) => void;
}

type FormState = {
  key: string; displayName: string; organization: string; displayOrder: string; isPreferred: boolean; loginDomains: string;
  protocol: Protocol; isEnabled: boolean; authenticationMode: AuthenticationMode; directoryTenantId: string;
  allowVerifiedEmailLinking: boolean;
  authorizationAttributeKeys: string;
  issuerUrl: string; clientId: string; clientSecretRef: string; callbackUrl: string; scopes: string; groupClaim: string; expectedAudience: string; requestedAcrValues: string; mfaAmrValues: string; mfaAcrValues: string; postLogoutRedirectUrl: string;
  entityId: string; idpEntityId: string; metadataUrl: string; metadataXmlRef: string; ssoUrl: string; signingCertificateRef: string; nameIdAttribute: string; emailAttribute: string; groupAttribute: string; signatureAlgorithm: 'sha256' | 'sha512'; sloUrl: string; logoutCallbackUrl: string; requestSigningPrivateKeyRef: string; requestSigningCertificateRef: string; requestedAuthnContext: string; mfaAuthnContextValues: string; ldapUrl: string;
  ldapBindDn: string; ldapBindPasswordRef: string; ldapUserBaseDn: string; ldapUserSearchFilter: string; ldapUserEnumerationFilter: string; ldapPageSize: string; ldapSubjectAttribute: string; ldapEmailAttribute: string; ldapGroupBaseDn: string; ldapGroupIdAttribute: string; ldapMembershipMode: 'memberOf' | 'group_search'; ldapNestedGroups: boolean; ldapTlsTrustRef: string;
  syncOnManual: boolean; syncScheduled: boolean; syncIntervalSeconds: string; syncConnectorCapability: 'claim_only' | 'ldap_directory';
};

const emptyForm = (): FormState => ({ key: '', displayName: '', organization: '', displayOrder: '0', isPreferred: false, loginDomains: '', protocol: 'oidc', isEnabled: false, authenticationMode: 'claims_only', directoryTenantId: '', allowVerifiedEmailLinking: false, authorizationAttributeKeys: '', issuerUrl: '', clientId: '', clientSecretRef: '', callbackUrl: '', scopes: 'openid profile email', groupClaim: '', expectedAudience: '', requestedAcrValues: '', mfaAmrValues: 'mfa, otp, hwk, swk, fido', mfaAcrValues: '', postLogoutRedirectUrl: '', entityId: '', idpEntityId: '', metadataUrl: '', metadataXmlRef: '', ssoUrl: '', signingCertificateRef: '', nameIdAttribute: 'nameID', emailAttribute: 'email', groupAttribute: 'groups', signatureAlgorithm: 'sha256', sloUrl: '', logoutCallbackUrl: '', requestSigningPrivateKeyRef: '', requestSigningCertificateRef: '', requestedAuthnContext: '', mfaAuthnContextValues: '', ldapUrl: '', ldapBindDn: '', ldapBindPasswordRef: '', ldapUserBaseDn: '', ldapUserSearchFilter: '(uid={username})', ldapUserEnumerationFilter: '(objectClass=person)', ldapPageSize: '200', ldapSubjectAttribute: 'entryUUID', ldapEmailAttribute: 'mail', ldapGroupBaseDn: '', ldapGroupIdAttribute: 'cn', ldapMembershipMode: 'memberOf', ldapNestedGroups: false, ldapTlsTrustRef: '', syncOnManual: false, syncScheduled: false, syncIntervalSeconds: '300', syncConnectorCapability: 'claim_only' });

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function parseConfiguration(provider: IdentityProvider): Record<string, unknown> {
  try { return JSON.parse(provider.configurationJson) as Record<string, unknown>; } catch { return {}; }
}

function parseSync(provider: IdentityProvider): Record<string, unknown> {
  try { return JSON.parse(provider.syncJson) as Record<string, unknown>; } catch { return {}; }
}

function parseLoginDomains(provider: IdentityProvider): string[] {
  try {
    const domains = JSON.parse(provider.loginDomainsJson || '[]');
    return Array.isArray(domains) ? domains.map(String) : [];
  } catch {
    return [];
  }
}

function formForProvider(provider: IdentityProvider): FormState {
  const config = parseConfiguration(provider);
  const sync = parseSync(provider);
  return {
    ...emptyForm(), key: provider.key, displayName: provider.displayName || provider.key, organization: provider.organization || '', displayOrder: String(provider.displayOrder || 0), isPreferred: provider.isPreferred, loginDomains: parseLoginDomains(provider).join(', '), protocol: provider.protocol, isEnabled: provider.isEnabled, authenticationMode: provider.authenticationMode,
    directoryTenantId: provider.directoryTenantId || '', allowVerifiedEmailLinking: config.allowVerifiedEmailLinking === true, authorizationAttributeKeys: Array.isArray(config.authorizationAttributeKeys) ? config.authorizationAttributeKeys.join(', ') : '', issuerUrl: String(config.issuerUrl || ''), clientId: String(config.clientId || ''), clientSecretRef: String(config.clientSecretRef || ''), callbackUrl: String(config.callbackUrl || ''), scopes: Array.isArray(config.scopes) ? config.scopes.join(' ') : 'openid profile email', groupClaim: String(config.groupClaim || ''), expectedAudience: String(config.expectedAudience || ''), requestedAcrValues: Array.isArray(config.requestedAcrValues) ? config.requestedAcrValues.join(', ') : '', mfaAmrValues: Array.isArray(config.mfaAmrValues) ? config.mfaAmrValues.join(', ') : 'mfa, otp, hwk, swk, fido', mfaAcrValues: Array.isArray(config.mfaAcrValues) ? config.mfaAcrValues.join(', ') : '', postLogoutRedirectUrl: String(config.postLogoutRedirectUrl || ''), entityId: String(config.entityId || ''), idpEntityId: String(config.idpEntityId || ''), metadataUrl: String(config.metadataUrl || ''), metadataXmlRef: String(config.metadataXmlRef || ''), ssoUrl: String(config.ssoUrl || ''), signingCertificateRef: String(config.signingCertificateRef || ''), nameIdAttribute: String(config.nameIdAttribute || 'nameID'), emailAttribute: String(config.emailAttribute || 'email'), groupAttribute: String(config.groupAttribute || 'groups'), signatureAlgorithm: config.signatureAlgorithm === 'sha512' ? 'sha512' : 'sha256', sloUrl: String(config.sloUrl || ''), logoutCallbackUrl: String(config.logoutCallbackUrl || ''), requestSigningPrivateKeyRef: String(config.requestSigningPrivateKeyRef || ''), requestSigningCertificateRef: String(config.requestSigningCertificateRef || ''), requestedAuthnContext: Array.isArray(config.requestedAuthnContext) ? config.requestedAuthnContext.join(', ') : '', mfaAuthnContextValues: Array.isArray(config.mfaAuthnContextValues) ? config.mfaAuthnContextValues.join(', ') : '', ldapUrl: String(config.url || ''), ldapBindDn: String(config.bindDn || ''), ldapBindPasswordRef: String(config.bindPasswordRef || ''), ldapUserBaseDn: String(config.userBaseDn || ''), ldapUserSearchFilter: String(config.userSearchFilter || '(uid={username})'), ldapUserEnumerationFilter: String(config.userEnumerationFilter || '(objectClass=person)'), ldapPageSize: String(config.pageSize || 200), ldapSubjectAttribute: String(config.subjectAttribute || 'entryUUID'), ldapEmailAttribute: String(config.emailAttribute || 'mail'), ldapGroupBaseDn: String(config.groupBaseDn || ''), ldapGroupIdAttribute: String(config.groupIdAttribute || 'cn'), ldapMembershipMode: config.membershipMode === 'group_search' ? 'group_search' : 'memberOf', ldapNestedGroups: config.nestedGroups === true, ldapTlsTrustRef: String(config.tlsTrustRef || ''), syncOnManual: Array.isArray(sync.triggers) && sync.triggers.includes('manual'), syncScheduled: sync.scheduled === true || (Array.isArray(sync.triggers) && sync.triggers.includes('scheduled')), syncIntervalSeconds: String(sync.intervalSeconds || 300), syncConnectorCapability: sync.connectorCapability === 'ldap_directory' ? 'ldap_directory' : 'claim_only',
  };
}

function configuration(form: FormState): Record<string, unknown> {
  const authorizationAttributeKeys = Array.from(new Set(form.authorizationAttributeKeys.split(/[\n,]/).map((key) => key.trim()).filter(Boolean)));
  const list = (value: string) => Array.from(new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean)));
  const common = { allowVerifiedEmailLinking: form.allowVerifiedEmailLinking, ...(authorizationAttributeKeys.length > 0 ? { authorizationAttributeKeys } : {}) };
  if (form.protocol === 'oidc') return { ...common, issuerUrl: form.issuerUrl.trim(), clientId: form.clientId.trim(), callbackUrl: form.callbackUrl.trim(), scopes: form.scopes.split(/\s+/).filter(Boolean), ...(form.clientSecretRef.trim() ? { clientSecretRef: form.clientSecretRef.trim() } : {}), ...(form.groupClaim.trim() ? { groupClaim: form.groupClaim.trim() } : {}), ...(form.expectedAudience.trim() ? { expectedAudience: form.expectedAudience.trim() } : {}), ...(list(form.requestedAcrValues).length ? { requestedAcrValues: list(form.requestedAcrValues) } : {}), ...(list(form.mfaAmrValues).length ? { mfaAmrValues: list(form.mfaAmrValues) } : {}), ...(list(form.mfaAcrValues).length ? { mfaAcrValues: list(form.mfaAcrValues) } : {}), ...(form.postLogoutRedirectUrl.trim() ? { postLogoutRedirectUrl: form.postLogoutRedirectUrl.trim() } : {}) };
  if (form.protocol === 'saml') return { ...common, entityId: form.entityId.trim(), idpEntityId: form.idpEntityId.trim(), callbackUrl: form.callbackUrl.trim(), ssoUrl: form.ssoUrl.trim(), signingCertificateRef: form.signingCertificateRef.trim(), nameIdAttribute: form.nameIdAttribute.trim(), emailAttribute: form.emailAttribute.trim(), groupAttribute: form.groupAttribute.trim(), signatureAlgorithm: form.signatureAlgorithm, ...(form.metadataUrl.trim() ? { metadataUrl: form.metadataUrl.trim() } : {}), ...(form.metadataXmlRef.trim() ? { metadataXmlRef: form.metadataXmlRef.trim() } : {}), ...(form.sloUrl.trim() ? { sloUrl: form.sloUrl.trim(), logoutCallbackUrl: form.logoutCallbackUrl.trim(), requestSigningPrivateKeyRef: form.requestSigningPrivateKeyRef.trim() } : {}), ...(form.requestSigningCertificateRef.trim() ? { requestSigningCertificateRef: form.requestSigningCertificateRef.trim() } : {}), ...(list(form.requestedAuthnContext).length ? { requestedAuthnContext: list(form.requestedAuthnContext) } : {}), ...(list(form.mfaAuthnContextValues).length ? { mfaAuthnContextValues: list(form.mfaAuthnContextValues) } : {}) };
  return { ...common, url: form.ldapUrl.trim(), bindDn: form.ldapBindDn.trim(), bindPasswordRef: form.ldapBindPasswordRef.trim(), userBaseDn: form.ldapUserBaseDn.trim(), userSearchFilter: form.ldapUserSearchFilter.trim(), userEnumerationFilter: form.ldapUserEnumerationFilter.trim(), pageSize: Number(form.ldapPageSize), subjectAttribute: form.ldapSubjectAttribute.trim(), emailAttribute: form.ldapEmailAttribute.trim(), groupBaseDn: form.ldapGroupBaseDn.trim(), groupIdAttribute: form.ldapGroupIdAttribute.trim(), membershipMode: form.ldapMembershipMode, nestedGroups: form.ldapNestedGroups, ...(form.ldapTlsTrustRef.trim() ? { tlsTrustRef: form.ldapTlsTrustRef.trim() } : {}) };
}

type ProviderFormErrors = Partial<Record<keyof FormState, string>>;

const providerFieldIds: Partial<Record<keyof FormState, string>> = {
  displayName: 'identity-provider-display-name',
  key: 'identity-provider-key',
  displayOrder: 'identity-provider-display-order',
  loginDomains: 'identity-provider-login-domains',
  issuerUrl: 'identity-provider-issuer',
  clientId: 'identity-provider-client-id',
  callbackUrl: 'identity-provider-callback',
  postLogoutRedirectUrl: 'identity-provider-post-logout-redirect',
  entityId: 'identity-provider-entity-id',
  idpEntityId: 'identity-provider-idp-entity-id',
  ssoUrl: 'identity-provider-saml-sso-url',
  signingCertificateRef: 'identity-provider-saml-certificate-ref',
  sloUrl: 'identity-provider-saml-slo-url',
  logoutCallbackUrl: 'identity-provider-saml-logout-callback',
  requestSigningPrivateKeyRef: 'identity-provider-saml-request-signing-key-ref',
  ldapUrl: 'identity-provider-ldap-url',
  ldapBindDn: 'identity-provider-ldap-bind-dn',
  ldapBindPasswordRef: 'identity-provider-ldap-bind-password-ref',
  ldapUserBaseDn: 'identity-provider-ldap-user-base',
  ldapUserSearchFilter: 'identity-provider-ldap-user-filter',
  ldapGroupBaseDn: 'identity-provider-ldap-group-base',
  ldapPageSize: 'identity-provider-ldap-page-size',
  syncIntervalSeconds: 'identity-provider-ldap-sync-interval',
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
  } catch {
    return false;
  }
}

function validateProviderForm(form: FormState): ProviderFormErrors {
  const errors: ProviderFormErrors = {};
  if (!form.displayName.trim()) errors.displayName = 'Enter the provider name users will recognize on the sign-in screen.';
  else if (form.displayName.trim().length > MAX_LOGIN_LABEL_LENGTH) errors.displayName = `Use ${MAX_LOGIN_LABEL_LENGTH} characters or fewer. This text appears on the sign-in button.`;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(form.key.trim())) errors.key = 'Use a stable lowercase key with letters, numbers, dots, dashes, or underscores.';
  if (!Number.isInteger(Number(form.displayOrder)) || Number(form.displayOrder) < 0 || Number(form.displayOrder) > 10000) errors.displayOrder = 'Display order must be a whole number between 0 and 10000.';
  const loginDomains = form.loginDomains.split(/[\n,]/).map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  if (loginDomains.some((domain) => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))) errors.loginDomains = 'Use comma-separated DNS domains such as example.com.';
  if (form.protocol === 'oidc') {
    if (!isHttpUrl(form.issuerUrl.trim())) errors.issuerUrl = 'Enter an HTTPS issuer URL. HTTP is accepted only for localhost testing.';
    if (!form.clientId.trim()) errors.clientId = 'Client ID is required.';
    if (!isHttpUrl(form.callbackUrl.trim())) errors.callbackUrl = 'Enter a valid HTTPS callback URL. HTTP is accepted only for localhost testing.';
    if (form.postLogoutRedirectUrl.trim() && !isHttpUrl(form.postLogoutRedirectUrl.trim())) errors.postLogoutRedirectUrl = 'Enter the canonical HTTPS EnterpriseGlue login URL.';
  }
  if (form.protocol === 'saml') {
    if (!form.entityId.trim()) errors.entityId = 'Service provider entity ID is required.';
    if (!form.idpEntityId.trim()) errors.idpEntityId = 'Expected identity provider entity ID is required.';
    if (!isHttpUrl(form.callbackUrl.trim())) errors.callbackUrl = 'Enter a valid HTTPS assertion consumer URL. HTTP is accepted only for localhost testing.';
    if (!isHttpUrl(form.ssoUrl.trim())) errors.ssoUrl = 'Enter a valid HTTPS identity-provider SSO URL. HTTP is accepted only for localhost testing.';
    if (!form.signingCertificateRef.trim()) errors.signingCertificateRef = 'A signing certificate reference is required.';
    if (form.sloUrl.trim()) {
      if (!isHttpUrl(form.sloUrl.trim())) errors.sloUrl = 'Enter a valid HTTPS identity-provider single logout URL.';
      if (!isHttpUrl(form.logoutCallbackUrl.trim())) errors.logoutCallbackUrl = 'Enter the provider-specific EnterpriseGlue SAML logout callback URL.';
      if (!form.requestSigningPrivateKeyRef.trim()) errors.requestSigningPrivateKeyRef = 'A request-signing private key reference is required for single logout.';
    }
  }
  if (form.protocol === 'ldap') {
    if (!form.ldapUrl.trim().startsWith('ldaps://')) errors.ldapUrl = 'Use an ldaps:// directory endpoint.';
    if (!form.ldapBindDn.trim()) errors.ldapBindDn = 'Service bind DN is required.';
    if (!form.ldapBindPasswordRef.trim()) errors.ldapBindPasswordRef = 'Service bind password reference is required.';
    if (!form.ldapUserBaseDn.trim()) errors.ldapUserBaseDn = 'User base DN is required.';
    if (!form.ldapUserSearchFilter.includes('{username}')) errors.ldapUserSearchFilter = 'User search filter must include {username}.';
    if (!form.ldapGroupBaseDn.trim()) errors.ldapGroupBaseDn = 'Group base DN is required.';
    if (!Number.isInteger(Number(form.ldapPageSize)) || Number(form.ldapPageSize) < 1 || Number(form.ldapPageSize) > 1000) errors.ldapPageSize = 'Page size must be between 1 and 1000.';
    if (form.syncScheduled && (!Number.isInteger(Number(form.syncIntervalSeconds)) || Number(form.syncIntervalSeconds) < 60)) errors.syncIntervalSeconds = 'Scheduled reconciliation interval must be at least 60 seconds.';
  }
  return errors;
}

export function LoginExperiencePreview({
  loginPolicy,
  providers,
}: {
  loginPolicy: NonNullable<IdentityProvidersSettingsTabProps['loginPolicy']>;
  providers: IdentityProvider[];
}) {
  const directProviders = providers
    .filter((provider) => provider.isEnabled && provider.authenticationMode === 'direct')
    .sort((left, right) => (
      Number(Boolean(right.isPreferred)) - Number(Boolean(left.isPreferred))
      || Number(left.displayOrder || 0) - Number(right.displayOrder || 0)
    ));
  const localPasswordEnabled = loginPolicy.localPasswordLoginMode === 'enabled'
    || (loginPolicy.localPasswordLoginMode === 'auto' && directProviders.length === 0);
  const redirectProvider = !localPasswordEnabled
    && loginPolicy.ssoProviderSelectionMode === 'auto_redirect_single'
    && directProviders.length === 1
    && directProviders[0].protocol !== 'ldap'
    ? directProviders[0]
    : null;
  const progressive = loginPolicy.ssoProviderSelectionMode === 'progressive' && directProviders.length > 0;
  const modeLabel = redirectProvider
    ? 'Automatic redirect'
    : progressive
      ? 'Work email first'
      : directProviders.length > 0
        ? 'Provider chooser'
        : localPasswordEnabled
          ? 'Local password'
          : 'No sign-in method available';

  return <section className="eg-login-experience-preview" aria-label="Login experience preview">
    <div className="eg-login-experience-preview__heading">
      <div>
        <h4>What users will see</h4>
        <p>Preview based on the current policy and saved, enabled direct sign-in providers.</p>
      </div>
      <Tag type={redirectProvider ? 'blue' : modeLabel === 'No sign-in method available' ? 'red' : 'cool-gray'}>{modeLabel}</Tag>
    </div>
    {redirectProvider ? <p className="eg-login-experience-preview__summary">
      Users are sent directly to <strong>{providerLoginLabel(redirectProvider)}</strong>
      {redirectProvider.organization ? ` for ${redirectProvider.organization}` : ''}.
    </p> : progressive ? <>
      <div className="eg-login-experience-preview__input" aria-hidden="true">name@example.com</div>
      <p className="eg-login-experience-preview__summary">A work-email domain suggests matching providers without checking whether an account exists.</p>
    </> : <div className="eg-login-experience-preview__methods">
      {localPasswordEnabled && <div className="eg-login-experience-preview__method">Sign in with a local password</div>}
      {directProviders.map((provider) => <div key={provider.id} className="eg-login-experience-preview__method">
        <span>Continue with {providerLoginLabel(provider)}</span>
        {provider.organization && <small>{provider.organization}</small>}
      </div>)}
      {!localPasswordEnabled && directProviders.length === 0 && <p className="eg-login-experience-preview__summary">Users cannot sign in until a method is enabled. Administrator recovery remains separate.</p>}
    </div>}
  </section>;
}

export default function IdentityProvidersSettingsTab({
  loginPolicy,
  canManageLoginPolicy = false,
  loginPolicyUnavailableReason,
  onLoginPolicyChange,
}: IdentityProvidersSettingsTabProps = {}) {
  const queryClient = useQueryClient();
  const resource = useMemo(() => ({ type: 'platform' as const }), []);
  const read = useActionDecision('platform.sso.providers.read', resource);
  const manage = useActionDecision('platform.sso.providers.manage', resource);
  const providersQuery = useIdentityProviders({ enabled: read.allowed });
  const [open, setOpen] = useState(false);
  const [providerStep, setProviderStep] = useState(1);
  const [editing, setEditing] = useState<IdentityProvider | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm);
  const [touchedFields, setTouchedFields] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState<ProviderActionError | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<IdentityProvider | null>(null);
  const [replayTarget, setReplayTarget] = useState<{ provider: IdentityProvider; cursor?: string } | null>(null);
  const [replayResult, setReplayResult] = useState<{ providerKey: string; result: MembershipReplayResult } | null>(null);
  const [replayCursors, setReplayCursors] = useState<Record<string, string | undefined>>({});
  const [previewResult, setPreviewResult] = useState<{ providerKey: string; result: MembershipPreviewResult } | null>(null);
  const [previewCursors, setPreviewCursors] = useState<Record<string, string | undefined>>({});
  const [historyProvider, setHistoryProvider] = useState<IdentityProvider | null>(null);
  const [connectionResult, setConnectionResult] = useState<{ providerKey: string; result: ConnectionTestResult } | null>(null);
  const [externalIdentityConflict, setExternalIdentityConflict] = useState<{ provider: IdentityProvider; subjectId: string; userId: string } | null>(null);
  const [externalIdentityUnlinkResult, setExternalIdentityUnlinkResult] = useState<{ providerKey: string; result: IdentityProviderExternalIdentityUnlinkResult } | null>(null);
  const providerViewOnly = isConfigLockedIdentityProvider(editing);
  const clearActionFeedback = () => {
    setPreviewResult(null);
    setReplayResult(null);
    setConnectionResult(null);
    setExternalIdentityUnlinkResult(null);
  };
  const syncRunsQuery = useQuery({ queryKey: ['identity-provider-sync-runs', historyProvider?.key], queryFn: () => apiClient.get<SsoSyncRun[]>(`/api/identity/providers/${encodeURIComponent(historyProvider!.key)}/sync-runs?limit=10`), enabled: Boolean(historyProvider) && read.allowed });

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      if (isConfigLockedIdentityProvider(editing)) throw new Error('Config-locked identity providers must be changed through their configuration bundle.');
      if (payload.protocol === 'ldap' && (!Number.isInteger(Number(payload.ldapPageSize)) || Number(payload.ldapPageSize) < 1 || Number(payload.ldapPageSize) > 1000)) throw new Error('LDAP directory page size must be between 1 and 1000.');
      if (payload.protocol === 'ldap' && payload.syncScheduled && (!Number.isInteger(Number(payload.syncIntervalSeconds)) || Number(payload.syncIntervalSeconds) < 60)) throw new Error('Scheduled LDAP reconciliation interval must be at least 60 seconds.');
      const scheduled = payload.protocol === 'ldap' && payload.syncScheduled;
      const triggers = [
        'login' as const,
        ...(scheduled ? ['scheduled' as const] : []),
        ...(payload.syncOnManual ? ['manual' as const] : []),
      ];
      const body = { ...(editing ? {} : { key: payload.key.trim() }), ...(editing ? {} : { protocol: payload.protocol }), displayName: payload.displayName.trim(), organization: payload.organization.trim() || null, displayOrder: Number(payload.displayOrder), isPreferred: payload.isPreferred, loginDomains: Array.from(new Set(payload.loginDomains.split(/[\n,]/).map((domain) => domain.trim().toLowerCase()).filter(Boolean))), isEnabled: payload.isEnabled, authenticationMode: payload.authenticationMode, directoryTenantId: payload.directoryTenantId.trim() || null, configuration: configuration(payload), sync: { triggers, requiredForLogin: true, incompleteEntitlements: 'fail_closed', connectorCapability: payload.syncConnectorCapability, scheduled, ...(scheduled ? { intervalSeconds: Number(payload.syncIntervalSeconds) } : {}) }, ownershipMode: isConfigWarnIdentityProvider(editing) ? 'config_warn' : 'manual' };
      return editing ? apiClient.put(`/api/identity/providers/${encodeURIComponent(editing.key)}`, body) : apiClient.post('/api/identity/providers', body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: authzQueryKeys.identityProviders }); setOpen(false); setEditing(null); setError(null); setSaveError(null); },
    onError: (value: unknown) => setSaveError(parseApiError(value, 'Unable to save identity provider').message),
  });
  const archive = useMutation({ mutationFn: (key: string) => apiClient.delete(`/api/identity/providers/${encodeURIComponent(key)}`), onSuccess: () => { queryClient.invalidateQueries({ queryKey: authzQueryKeys.identityProviders }); setArchiveTarget(null); } });
  const reconcile = useMutation({ mutationFn: (key: string) => apiClient.post(`/api/identity/providers/${encodeURIComponent(key)}/reconcile`, {}), onError: (value: unknown) => setError({ title: 'Membership refresh failed', message: parseApiError(value, 'EnterpriseGlue could not refresh directory memberships').message }) });
  const previewMemberships = useMutation({ mutationFn: ({ key, cursor }: { key: string; cursor?: string }) => apiClient.post<MembershipPreviewResult>(`/api/identity/providers/${encodeURIComponent(key)}/reconciliation-preview`, cursor ? { cursor } : {}), onSuccess: (result, input) => { clearActionFeedback(); setPreviewResult({ providerKey: input.key, result }); setPreviewCursors((current) => ({ ...current, [input.key]: result.nextCursor || undefined })); setError(null); }, onError: (value: unknown) => { clearActionFeedback(); setError({ title: 'Membership preview failed', message: parseApiError(value, 'EnterpriseGlue could not preview saved membership data').message }); } });
  const replayMemberships = useMutation({ mutationFn: ({ key, cursor }: { key: string; cursor?: string }) => apiClient.post<MembershipReplayResult>(`/api/identity/providers/${encodeURIComponent(key)}/replay-memberships`, cursor ? { cursor } : {}), onSuccess: (result, input) => { clearActionFeedback(); setReplayResult({ providerKey: input.key, result }); setReplayCursors((current) => ({ ...current, [input.key]: result.nextCursor || undefined })); setReplayTarget(null); setError(null); }, onError: (value: unknown) => { clearActionFeedback(); setReplayTarget(null); setError({ title: 'Saved membership data was not applied', message: parseApiError(value, 'EnterpriseGlue could not apply saved membership data').message }); } });
  const testConnection = useMutation({ mutationFn: (key: string) => apiClient.post<ConnectionTestResult>(`/api/identity/providers/${encodeURIComponent(key)}/test-connection`, {}), onSuccess: (result, key) => { clearActionFeedback(); setConnectionResult({ providerKey: key, result }); setError(null); }, onError: (value: unknown) => { clearActionFeedback(); setError({ title: 'Connection test failed', message: parseApiError(value, 'EnterpriseGlue could not verify the provider connection').message }); } });
  const unlinkExternalIdentity = useMutation({
    mutationFn: (input: { key: string; subjectId: string; userId: string }) => apiClient.post<IdentityProviderExternalIdentityUnlinkResult>(`/api/identity/providers/${encodeURIComponent(input.key)}/external-identities/unlink`, {
      subjectId: input.subjectId.trim(), userId: input.userId.trim(), confirmation: 'UNLINK_EXTERNAL_IDENTITY',
    }),
    onSuccess: (result, input) => {
      clearActionFeedback();
      setExternalIdentityUnlinkResult({ providerKey: input.key, result });
      setExternalIdentityConflict(null);
      setError(null);
    },
    onError: (value: unknown) => { clearActionFeedback(); setError({ title: 'External identity was not unlinked', message: parseApiError(value, 'EnterpriseGlue could not unlink the external identity').message }); },
  });
  const resetFormInteraction = () => {
    setTouchedFields({});
    setSubmitAttempted(false);
  };
  const closeProviderWorkflow = useCallback(() => {
    setOpen(false);
    setEditing(null);
  }, []);
  const startCreate = () => {
    const nextForm = emptyForm();
    setEditing(null); setProviderStep(1); setForm(nextForm); setInitialForm(nextForm); resetFormInteraction(); setError(null); setSaveError(null); setOpen(true);
  };
  const startEdit = (provider: IdentityProvider) => {
    const nextForm = formForProvider(provider);
    setEditing(provider); setProviderStep(1); setForm(nextForm); setInitialForm(nextForm); resetFormInteraction(); setError(null); setSaveError(null); setOpen(true);
  };
  const providerWorkflowDirty = open && !providerViewOnly
    && JSON.stringify(form) !== JSON.stringify(initialForm);
  const unsavedChanges = useUnsavedChangesGuard(providerWorkflowDirty, closeProviderWorkflow);
  React.useEffect(() => {
    if (!open) return;
    const animationFrame = window.requestAnimationFrame(() => {
      const target = document.getElementById('identity-provider-step-heading')
        || document.getElementById('identity-provider-workflow-title');
      const workflow = target?.closest<HTMLElement>('.eg-settings-workflow');
      const workflowBody = target?.closest<HTMLElement>('.eg-settings-workflow__body');
      if (workflow) {
        workflow.scrollTop = 0;
        workflow.scrollLeft = 0;
      }
      if (workflowBody) {
        workflowBody.scrollTop = 0;
        workflowBody.scrollLeft = 0;
      }
      target?.focus({ preventScroll: true });
      let ancestor = target?.parentElement;
      while (ancestor) {
        ancestor.scrollLeft = 0;
        ancestor = ancestor.parentElement;
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [open, providerStep]);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const formErrors = validateProviderForm(form);
  const formIsValid = Object.keys(formErrors).length === 0;
  const connectionFields: Array<keyof FormState> = form.protocol === 'oidc'
    ? ['issuerUrl', 'clientId', 'callbackUrl', 'postLogoutRedirectUrl']
    : form.protocol === 'saml'
      ? ['entityId', 'idpEntityId', 'callbackUrl', 'ssoUrl', 'signingCertificateRef', 'sloUrl', 'logoutCallbackUrl', 'requestSigningPrivateKeyRef']
      : ['ldapUrl', 'ldapBindDn', 'ldapBindPasswordRef', 'ldapUserBaseDn', 'ldapUserSearchFilter', 'ldapGroupBaseDn', 'ldapPageSize'];
  const providerStepFields: Record<number, Array<keyof FormState>> = {
    1: ['displayName', 'key', 'displayOrder', 'loginDomains'],
    2: connectionFields,
    3: ['syncIntervalSeconds'],
    4: [],
  };
  const currentStepErrors = providerStepFields[providerStep].filter((key) => Boolean(formErrors[key]));
  const currentStepValid = currentStepErrors.length === 0;
  const fieldValidation = <K extends keyof FormState>(key: K) => {
    const invalidText = submitAttempted || touchedFields[key] ? formErrors[key] : undefined;
    return {
      invalid: Boolean(invalidText),
      invalidText,
      onBlur: () => setTouchedFields((current) => ({ ...current, [key]: true })),
    };
  };
  const submitProvider = () => {
    if (providerViewOnly) return;
    if (!formIsValid) {
      setSubmitAttempted(true);
      const firstInvalidField = Object.keys(formErrors).find((key) => providerFieldIds[key as keyof FormState]);
      const firstInvalidId = firstInvalidField ? providerFieldIds[firstInvalidField as keyof FormState] : undefined;
      if (firstInvalidId) window.setTimeout(() => document.getElementById(firstInvalidId)?.focus(), 0);
      return;
    }
    save.mutate(form);
  };
  const continueProvider = () => {
    if (!currentStepValid) {
      setSubmitAttempted(true);
      const firstInvalidField = currentStepErrors[0];
      const firstInvalidId = firstInvalidField === 'callbackUrl' && form.protocol === 'saml'
        ? 'identity-provider-saml-callback'
        : providerFieldIds[firstInvalidField];
      if (firstInvalidId) window.setTimeout(() => document.getElementById(firstInvalidId)?.focus(), 0);
      return;
    }
    setProviderStep((step) => Math.min(4, step + 1));
  };

  if (!read.allowed) return <UnauthorizedEmptyState title="Identity providers unavailable" reason={read.reason || 'Missing identity provider read permission.'} />;
  if (providersQuery.isLoading) return <SkeletonText paragraph lineCount={5} />;
  if (providersQuery.error) return <Callout
    role="alert"
    kind="warning"
    title="Identity providers could not be loaded"
    subtitle={`${parseApiError(providersQuery.error, 'Request failed').message} Try the request again or check the identity service.`}
    actionButtonLabel="Retry"
    onActionButtonClick={() => providersQuery.refetch()}
  />;

  const rows = providersQuery.data || [];
  const replayProvider = replayResult
    ? rows.find((provider) => provider.key === replayResult.providerKey)
    : undefined;
  const replayCopy = replayResult
    ? savedMembershipApplicationCopy(identityProviderName(replayProvider), replayResult.result)
    : null;
  const providerReviewItems = [
    ['Sign-in name', form.displayName || 'Not entered'],
    ['Provider key', form.key || 'Not entered'],
    ['Protocol', form.protocol === 'oidc' ? 'OpenID Connect' : form.protocol === 'saml' ? 'SAML 2.0' : 'LDAP'],
    ['Sign-in use', form.authenticationMode === 'direct' ? 'Users sign in through this provider' : 'Managed by a verified host integration'],
    ['Discovery domains', form.loginDomains || 'None'],
    ['Membership refresh', form.syncConnectorCapability === 'ldap_directory' ? 'LDAP directory query' : 'Sign-in claims'],
    ['Initial status', form.isEnabled ? 'Enabled' : 'Disabled'],
  ];
  return <>
    {!open && <>
    {loginPolicy && <Tile style={{ marginBottom: 'var(--spacing-5)' }}>
      <h3 style={{ margin: 0, fontSize: '1rem' }}>Sign-in policy</h3>
      <p style={{ margin: 'var(--spacing-2) 0 var(--spacing-5)', color: 'var(--cds-text-secondary)' }}>Control how users reach organization sign-in. Platform administrator recovery remains a separate restricted route.</p>
      {!canManageLoginPolicy && loginPolicyUnavailableReason && <Callout kind="info" lowContrast title="Sign-in policy is read-only" subtitle={loginPolicyUnavailableReason} style={{ marginBottom: 'var(--spacing-5)' }} />}
      <div className="eg-login-policy-grid">
        <div>
        <Select id="local-password-login-mode" labelText="Local password sign-in" value={loginPolicy.localPasswordLoginMode} disabled={!canManageLoginPolicy} onChange={(event) => onLoginPolicyChange?.({ localPasswordLoginMode: event.target.value as LocalPasswordLoginMode })}>
          <SelectItem value="auto" text="Automatic" />
          <SelectItem value="enabled" text="Always available" />
          <SelectItem value="disabled" text="SSO only" />
        </Select>
        <p className="eg-settings-field-description">{loginPolicy.localPasswordLoginMode === 'auto' ? 'Hidden when a direct SSO provider is available.' : loginPolicy.localPasswordLoginMode === 'enabled' ? 'Offered alongside configured SSO providers.' : 'Only configured SSO providers can be used.'}</p>
        </div>
        <div>
        <Select id="sso-provider-selection-mode" labelText="SSO provider selection" value={loginPolicy.ssoProviderSelectionMode} disabled={!canManageLoginPolicy} onChange={(event) => onLoginPolicyChange?.({ ssoProviderSelectionMode: event.target.value as SsoProviderSelectionMode })}>
          <SelectItem value="auto_redirect_single" text="Automatic redirect" />
          <SelectItem value="chooser" text="Provider chooser" />
          <SelectItem value="progressive" text="Work email first" />
        </Select>
        <p className="eg-settings-field-description">{loginPolicy.ssoProviderSelectionMode === 'auto_redirect_single' ? 'Redirects automatically only when exactly one direct provider is available.' : loginPolicy.ssoProviderSelectionMode === 'chooser' ? 'Always lets users choose among the available providers.' : 'Uses the work-email domain to suggest matching providers.'}</p>
        </div>
      </div>
      <LoginExperiencePreview loginPolicy={loginPolicy} providers={providersQuery.data || []} />
    </Tile>}
    <Tile>
      <div className="eg-settings-section-header">
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Identity providers</h3>
          <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Provider-neutral OIDC, SAML, and LDAP definitions used by identity mappings and sign-in flows.</p>
        </div>
        {rows.length > 0 && <GuardedAction actionId="platform.sso.providers.manage" resource={resource}><Button kind="primary" size="sm" renderIcon={Add} onClick={startCreate}>Create provider</Button></GuardedAction>}
      </div>
      {error && <InlineNotification kind="error" title={error.title} subtitle={`${sentence(error.message)} Review the relevant settings, then try again.`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {previewResult && <InlineNotification
        kind={previewResult.result.failed > 0 || previewResult.result.warnings.includes('no_active_snapshots') ? 'warning' : 'info'}
        title={`Preview from saved provider data: ${identityProviderName(rows.find((provider) => provider.key === previewResult.providerKey))}`}
        subtitle={`Checked ${countPhrase(previewResult.result.scanned, 'saved identity record')}. ${countPhrase(previewResult.result.additions, 'membership')} would be added and ${countPhrase(previewResult.result.removals, 'membership')} removed. No access was changed, and the provider was not contacted.${previewResult.result.truncated ? ' More records remain; continue the preview for complete counts.' : ''}`}
        hideCloseButton
        style={{ marginBottom: 'var(--spacing-5)' }}
      />}
      {replayResult && replayCopy && (replayCopy.partial ? <ActionableNotification
        kind="warning"
        title={replayCopy.title}
        subtitle={replayCopy.description}
        actionButtonLabel="View refresh history"
        onActionButtonClick={() => replayProvider && setHistoryProvider(replayProvider)}
        hideCloseButton
        inline
        style={{ marginBottom: 'var(--spacing-5)' }}
      /> : <InlineNotification
        kind="success"
        title={replayCopy.title}
        subtitle={replayCopy.description}
        hideCloseButton
        style={{ marginBottom: 'var(--spacing-5)' }}
      />)}
      {connectionResult && <InlineNotification
        kind="success"
        title={connectionResult.result.protocol === 'ldap'
          ? `Directory reachable: ${identityProviderName(rows.find((provider) => provider.key === connectionResult.providerKey))}`
          : `Provider metadata reachable: ${identityProviderName(rows.find((provider) => provider.key === connectionResult.providerKey))}`}
        subtitle={connectionResult.result.protocol === 'saml'
          ? `EnterpriseGlue read ${connectionResult.result.entityDescriptorCount} SAML entity descriptors. This checks metadata reachability and size only; assertion issuer, request correlation, audience, recipient, and signature trust are enforced during sign-in.`
          : connectionResult.result.protocol === 'oidc'
            ? `EnterpriseGlue read valid OIDC discovery metadata for ${connectionResult.result.issuer}. This does not verify the client secret, callback registration, or token exchange; complete a controlled sign-in before enabling SSO-only access.`
            : `EnterpriseGlue connected over LDAPS and sampled ${connectionResult.result.sampledIdentities} directory identities within the configured safety budgets.`}
        hideCloseButton
        style={{ marginBottom: 'var(--spacing-5)' }}
      />}
      {externalIdentityUnlinkResult && <InlineNotification kind="success" title={`External identity unlinked: ${identityProviderName(rows.find((provider) => provider.key === externalIdentityUnlinkResult.providerKey))}`} subtitle={`Provider link revoked: ${countPhrase(externalIdentityUnlinkResult.result.providerManagedMembershipsRemoved, 'membership')} and ${countPhrase(externalIdentityUnlinkResult.result.providerRefreshSessionsRevoked, 'saved sign-in session')} removed. A fresh verified sign-in is required to relink.`} hideCloseButton style={{ marginBottom: 'var(--spacing-5)' }} />}
      {rows.length === 0 ? <div className="eg-identity-provider-empty-state">
        <h4>No identity providers yet</h4>
        <p>Create an OIDC, SAML, or LDAP provider to enable organization sign-in and identity mappings.</p>
        <GuardedAction actionId="platform.sso.providers.manage" resource={resource}><Button kind="primary" renderIcon={Add} onClick={startCreate}>Create provider</Button></GuardedAction>
      </div> : <DataTable rows={rows} headers={[{ key: 'name', header: 'Sign-in name' }, { key: 'key', header: 'Key' }, { key: 'protocol', header: 'Protocol' }, { key: 'mode', header: 'Sign-in use' }, { key: 'sync', header: 'Access refresh' }, { key: 'status', header: 'Sign-in status' }, { key: 'source', header: 'Management source' }, { key: 'actions', header: '' }]} isSortable>
        {({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps }) => (
          <TableContainer>
            <Table {...getTableProps()} size="md">
              <TableHead><TableRow>{headers.map((header) => {
                const { key, ...headerProps } = getHeaderProps({ header });
                return <TableHeader key={key} {...headerProps}>{header.header}</TableHeader>;
              })}</TableRow></TableHead>
              <TableBody>{tableRows.map((row) => {
                const provider = rows.find((item) => item.id === row.id)!;
                const configLocked = isConfigLockedIdentityProvider(provider);
                const { key, ...rowProps } = getRowProps({ row });
                return <TableRow key={key} {...rowProps}>
                  <TableCell>{provider.displayName?.trim() || <span style={{ color: 'var(--cds-text-secondary)' }}>Not set</span>}{provider.isPreferred && provider.isEnabled ? <Tag type="blue" size="sm" style={{ marginInlineStart: 'var(--spacing-2)' }}>Preferred</Tag> : null}</TableCell>
                  <TableCell>{provider.key}</TableCell>
                  <TableCell><Tag type="cool-gray">{provider.protocol.toUpperCase()}</Tag></TableCell>
                  <TableCell>{provider.authenticationMode === 'direct' ? 'Shown on sign-in' : 'Trusted claims only (not shown)'}</TableCell>
                  <TableCell>{provider.protocol === 'ldap' && parseSync(provider).scheduled === true ? <Tag type="blue">At sign-in and on schedule</Tag> : 'At sign-in'}</TableCell>
                  <TableCell><Tag type={provider.isEnabled ? 'green' : 'gray'}>{provider.isEnabled ? 'Enabled' : 'Disabled'}</Tag></TableCell>
                  <TableCell>
                    <div><Tag type={isConfigWarnIdentityProvider(provider) ? 'warm-gray' : provider.sourceRef ? 'purple' : 'gray'}>{configurationOwnershipLabel(provider.ownershipMode)}</Tag></div>
                    {isConfigWarnIdentityProvider(provider) && <small style={{ display: 'block', marginTop: 'var(--spacing-2)', color: 'var(--cds-text-secondary)' }}>{configurationOwnershipDescription(provider.ownershipMode, provider.sourceRef)}</small>}
                  </TableCell>
                  <TableCell><GuardedOverflowMenu
                    size="sm"
                    flipped
                    direction="top"
                    menuOptionsClass="eg-identity-provider-menu"
                    iconDescription="Provider actions"
                  >
                    <GuardedOverflowMenuItem decision={configLocked ? read : manage} itemText={configLocked ? 'View configuration' : 'Edit'} onClick={() => startEdit(provider)} />
                    <GuardedOverflowMenuItem decision={read} itemText="View refresh history" onClick={() => setHistoryProvider(provider)} />
                    <GuardedOverflowMenuItem decision={manage} itemText="Test connection" disabled={!provider.isEnabled || testConnection.isPending} onClick={() => testConnection.mutate(provider.key)} />
                    {provider.protocol === 'ldap' && <GuardedOverflowMenuItem decision={manage} itemText="Refresh memberships" disabled={!provider.isEnabled || reconcile.isPending} onClick={() => reconcile.mutate(provider.key)} />}
                    <GuardedOverflowMenuItem decision={manage} itemText={previewCursors[provider.key] ? 'Continue preview' : 'Preview memberships'} disabled={!provider.isEnabled || previewMemberships.isPending} onClick={() => previewMemberships.mutate({ key: provider.key, cursor: previewCursors[provider.key] })} />
                    <GuardedOverflowMenuItem decision={manage} itemText={replayCursors[provider.key] ? 'Continue applying saved data' : 'Apply saved membership data'} disabled={!provider.isEnabled || replayMemberships.isPending} onClick={() => setReplayTarget({ provider, cursor: replayCursors[provider.key] })} />
                    <GuardedOverflowMenuItem decision={manage} itemText="Resolve identity conflict" onClick={() => setExternalIdentityConflict({ provider, subjectId: '', userId: '' })} />
                    {!configLocked && <GuardedOverflowMenuItem decision={manage} itemText="Disable provider" isDelete onClick={() => setArchiveTarget(provider)} />}
                  </GuardedOverflowMenu></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>}
      {historyProvider && <div style={{ marginTop: 'var(--spacing-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-3)' }}>
          <div><h4 style={{ margin: 0 }}>Refresh history: {identityProviderName(historyProvider)}</h4><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Recent sign-in, scheduled, directory, and saved-data membership refreshes. <span style={{ overflowWrap: 'anywhere' }}>Key: {historyProvider.key}</span></p></div>
          <Button kind="ghost" size="sm" onClick={() => setHistoryProvider(null)}>Close</Button>
        </div>
        {syncRunsQuery.isLoading ? <SkeletonText paragraph lineCount={3} /> : syncRunsQuery.error ? <InlineNotification kind="error" title="Refresh history could not be loaded" subtitle={parseApiError(syncRunsQuery.error, 'Request failed').message} hideCloseButton /> : (syncRunsQuery.data || []).length === 0 ? <div className="eg-identity-provider-empty-state eg-identity-provider-empty-state--compact"><h4>No membership refreshes yet</h4><p>History appears after sign-in, directory refresh, or applying saved membership data.</p></div> : <div>{(syncRunsQuery.data || []).map((run) => <div key={run.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-3)', borderBottom: '1px solid var(--cds-border-subtle)' }}><Tag type={run.status === 'failed' ? 'red' : run.status === 'running' ? 'blue' : 'green'}>{syncRunStatusLabel(run.status)}</Tag><Tag type="cool-gray">{syncRunTriggerLabel(run.trigger)}</Tag><span style={{ color: 'var(--cds-text-secondary)' }}>{new Date(run.startedAt).toLocaleString()}</span><span style={{ color: 'var(--cds-text-secondary)' }}>{countPhrase(run.groupMembershipsCreated, 'membership')} added, {countPhrase(run.groupMembershipsRemoved, 'membership')} removed</span>{run.errorMessage && <span style={{ color: 'var(--cds-support-error)' }}>{run.errorMessage}</span>}</div>)}</div>}
      </div>}
    </Tile>
    </>}
    {open && <section className="eg-settings-workflow" role="region" aria-labelledby="identity-provider-workflow-title" data-unsaved-changes={providerWorkflowDirty ? 'true' : 'false'}>
      <div className="eg-settings-workflow__header">
        <div>
          <h2 id="identity-provider-workflow-title">{providerViewOnly ? 'View identity provider configuration' : editing ? 'Edit identity provider' : 'Create identity provider'}</h2>
          <p>{providerViewOnly ? 'Review the configuration-managed provider settings.' : 'Configure identity, connection, membership behavior, and the initial provider status.'}</p>
        </div>
        <Button kind="ghost" size="sm" onClick={unsavedChanges.requestExit}>Back to identity providers</Button>
      </div>
      <div className="eg-settings-workflow__body" role="region" aria-label="Identity provider form fields" tabIndex={0}>
        {providerViewOnly && <Callout kind="info" lowContrast title="Managed by configuration" subtitle={`This provider cannot be changed here. Update ${configurationSourceName(editing?.sourceRef)} and apply it again.`} />}
        {saveError && <InlineNotification kind="error" title="Provider not saved" subtitle={saveError} hideCloseButton />}
        {submitAttempted && !currentStepValid && <InlineNotification kind="error" title="Complete the highlighted fields" subtitle="Correct the indicated provider settings before continuing." hideCloseButton />}
        <ProgressIndicator currentIndex={providerStep - 1} spaceEqually>
          <ProgressStep label="Identity" complete={providerStep > 1} />
          <ProgressStep label="Connection" complete={providerStep > 2} />
          <ProgressStep label="Membership" complete={providerStep > 3} />
          <ProgressStep label="Review" />
        </ProgressIndicator>
        <p className="eg-visually-hidden" aria-live="polite">Step {providerStep} of 4: {['Identity', 'Connection', 'Membership', 'Review'][providerStep - 1]}</p>
        <fieldset disabled={providerViewOnly} className="eg-settings-workflow__fieldset">
          {providerStep === 1 && <section className="eg-settings-form-column" aria-labelledby="identity-provider-step-heading">
            <div className="eg-settings-step-introduction"><h3 id="identity-provider-step-heading" tabIndex={-1}>Identity</h3><p>Choose the name users recognize and how this provider participates in sign-in.</p></div>
            <TextInput id="identity-provider-display-name" labelText="Sign-in name" value={form.displayName} {...fieldValidation('displayName')} onChange={(event) => update('displayName', event.target.value)} helperText={`For example, Microsoft Entra ID. Use ${MAX_LOGIN_LABEL_LENGTH} characters or fewer.`} />
            <TextInput id="identity-provider-organization" labelText="Organization (optional)" value={form.organization} onChange={(event) => update('organization', event.target.value)} helperText="Shown only when providers have similar names." />
            <TextInput id="identity-provider-key" labelText="Provider key" value={form.key} disabled={Boolean(editing)} {...fieldValidation('key')} onChange={(event) => update('key', event.target.value)} helperText="Stable lowercase key used by configuration and sign-in links." />
            <NumberInput id="identity-provider-display-order" label="Display order" min={0} max={10000} value={form.displayOrder} {...fieldValidation('displayOrder')} onChange={(event) => update('displayOrder', event.currentTarget.value)} helperText="Lower numbers appear first in the provider chooser." />
            <Toggle id="identity-provider-preferred" labelText="Preferred sign-in provider" labelA="No" labelB="Yes" toggled={form.isPreferred} onToggle={(checked) => update('isPreferred', checked)} />
            <TextInput id="identity-provider-login-domains" labelText="Discovery email domains (optional)" value={form.loginDomains} {...fieldValidation('loginDomains')} onChange={(event) => update('loginDomains', event.target.value)} helperText="Comma-separated domains, such as example.com. Used only in work-email-first sign-in." />
            <Select id="identity-provider-protocol" labelText="Protocol" value={form.protocol} disabled={Boolean(editing)} onChange={(event) => {
              const protocol = event.target.value as Protocol;
              setForm((current) => ({ ...current, protocol, authenticationMode: protocol === 'ldap' ? 'direct' : current.authenticationMode, syncConnectorCapability: protocol === 'ldap' ? 'ldap_directory' : current.syncConnectorCapability === 'ldap_directory' ? 'claim_only' : current.syncConnectorCapability }));
            }}><SelectItem value="oidc" text="OpenID Connect" /><SelectItem value="saml" text="SAML 2.0" /><SelectItem value="ldap" text="LDAP" /></Select>
            <Select id="identity-provider-mode" labelText="Sign-in use" helperText="Verified host integrations authenticate outside EnterpriseGlue. Direct providers appear in built-in sign-in flows." value={form.authenticationMode} onChange={(event) => update('authenticationMode', event.target.value as AuthenticationMode)}><SelectItem value="claims_only" text="Verified host integration" /><SelectItem value="direct" text="Direct user sign-in" /></Select>
            {form.authenticationMode === 'claims_only' && <Callout kind="warning" lowContrast title="Not shown on the sign-in page" subtitle="The verified host integration must authenticate the user before using this provider namespace." />}
          </section>}
          {providerStep === 2 && <section className="eg-settings-form-column" aria-labelledby="identity-provider-step-heading">
            <div className="eg-settings-step-introduction"><h3 id="identity-provider-step-heading" tabIndex={-1}>Connection</h3><p>Enter the trusted {form.protocol === 'oidc' ? 'OpenID Connect' : form.protocol === 'saml' ? 'SAML' : 'LDAP'} connection and claim details.</p></div>
            {form.protocol === 'oidc' && <>
              <TextInput id="identity-provider-issuer" labelText="Issuer URL" value={form.issuerUrl} {...fieldValidation('issuerUrl')} onChange={(event) => update('issuerUrl', event.target.value)} />
              <TextInput id="identity-provider-client-id" labelText="Client ID" value={form.clientId} {...fieldValidation('clientId')} onChange={(event) => update('clientId', event.target.value)} />
              <TextInput id="identity-provider-secret-ref" labelText="Client secret reference (optional)" value={form.clientSecretRef} onChange={(event) => update('clientSecretRef', event.target.value)} helperText="Reference name only. Secret values are never stored here." />
              <TextInput id="identity-provider-callback" labelText="Callback URL" value={form.callbackUrl} {...fieldValidation('callbackUrl')} onChange={(event) => update('callbackUrl', event.target.value)} />
              <TextInput id="identity-provider-scopes" labelText="Scopes" value={form.scopes} onChange={(event) => update('scopes', event.target.value)} />
              <TextInput id="identity-provider-group-claim" labelText="Group claim (optional)" value={form.groupClaim} onChange={(event) => update('groupClaim', event.target.value)} helperText="Claim containing stable upstream group identifiers." />
              <TextInput id="identity-provider-expected-audience" labelText="Audience confirmation (optional)" value={form.expectedAudience} onChange={(event) => update('expectedAudience', event.target.value)} helperText="When set, this must match the client ID exactly." />
              <TextInput id="identity-provider-requested-acr" labelText="Requested authentication contexts (optional)" value={form.requestedAcrValues} onChange={(event) => update('requestedAcrValues', event.target.value)} helperText="Comma-separated ACR values requested during sign-in, in provider preference order." />
              <TextInput id="identity-provider-mfa-amr" labelText="MFA authentication methods" value={form.mfaAmrValues} onChange={(event) => update('mfaAmrValues', event.target.value)} helperText="Verified ID-token AMR values that satisfy require-MFA policies." />
              <TextInput id="identity-provider-mfa-acr" labelText="MFA authentication contexts (optional)" value={form.mfaAcrValues} onChange={(event) => update('mfaAcrValues', event.target.value)} helperText="Verified ACR values that satisfy require-MFA policies." />
              <TextInput id="identity-provider-post-logout-redirect" labelText="Post-logout redirect URL (optional)" value={form.postLogoutRedirectUrl} {...fieldValidation('postLogoutRedirectUrl')} onChange={(event) => update('postLogoutRedirectUrl', event.target.value)} helperText="Use the canonical EnterpriseGlue /login URL. The discovered end-session endpoint remains provider-controlled." />
            </>}
            {form.protocol === 'saml' && <>
              <TextInput id="identity-provider-entity-id" labelText="EnterpriseGlue service provider entity ID" value={form.entityId} {...fieldValidation('entityId')} onChange={(event) => update('entityId', event.target.value)} />
              <TextInput id="identity-provider-idp-entity-id" labelText="Expected identity provider entity ID" value={form.idpEntityId} {...fieldValidation('idpEntityId')} onChange={(event) => update('idpEntityId', event.target.value)} helperText="Copy the exact entity ID from trusted IdP metadata." />
              <TextInput id="identity-provider-saml-callback" labelText="Assertion consumer service URL" value={form.callbackUrl} {...fieldValidation('callbackUrl')} onChange={(event) => update('callbackUrl', event.target.value)} />
              <TextInput id="identity-provider-saml-sso-url" labelText="Identity provider SSO URL" value={form.ssoUrl} {...fieldValidation('ssoUrl')} onChange={(event) => update('ssoUrl', event.target.value)} />
              <TextInput id="identity-provider-saml-certificate-ref" labelText="Identity provider signing certificate reference" value={form.signingCertificateRef} {...fieldValidation('signingCertificateRef')} onChange={(event) => update('signingCertificateRef', event.target.value)} helperText="Reference name only. Certificate values are never stored here." />
              <TextInput id="identity-provider-saml-name-id" labelText="Subject attribute" value={form.nameIdAttribute} onChange={(event) => update('nameIdAttribute', event.target.value)} />
              <TextInput id="identity-provider-saml-email" labelText="Email attribute" value={form.emailAttribute} onChange={(event) => update('emailAttribute', event.target.value)} />
              <TextInput id="identity-provider-saml-groups" labelText="Group attribute" value={form.groupAttribute} onChange={(event) => update('groupAttribute', event.target.value)} />
              <Select id="identity-provider-saml-signature" labelText="Signature algorithm" value={form.signatureAlgorithm} onChange={(event) => update('signatureAlgorithm', event.target.value as FormState['signatureAlgorithm'])}><SelectItem value="sha256" text="SHA-256" /><SelectItem value="sha512" text="SHA-512" /></Select>
              <TextInput id="identity-provider-requested-authn-context" labelText="Requested authentication contexts (optional)" value={form.requestedAuthnContext} onChange={(event) => update('requestedAuthnContext', event.target.value)} helperText="Comma-separated SAML AuthnContextClassRef URIs requested during sign-in." />
              <TextInput id="identity-provider-mfa-authn-context" labelText="MFA authentication contexts (optional)" value={form.mfaAuthnContextValues} onChange={(event) => update('mfaAuthnContextValues', event.target.value)} helperText="Verified assertion contexts that satisfy require-MFA policies." />
              <TextInput id="identity-provider-saml-slo-url" labelText="Identity provider single logout URL (optional)" value={form.sloUrl} {...fieldValidation('sloUrl')} onChange={(event) => update('sloUrl', event.target.value)} />
              {form.sloUrl.trim() && <>
                <TextInput id="identity-provider-saml-logout-callback" labelText="EnterpriseGlue logout callback URL" value={form.logoutCallbackUrl} {...fieldValidation('logoutCallbackUrl')} onChange={(event) => update('logoutCallbackUrl', event.target.value)} helperText="Use /api/auth/identity/{providerKey}/saml/logout, replacing {providerKey} with this provider's stable key." />
                <TextInput id="identity-provider-saml-request-signing-key-ref" labelText="Request-signing private key reference" value={form.requestSigningPrivateKeyRef} {...fieldValidation('requestSigningPrivateKeyRef')} onChange={(event) => update('requestSigningPrivateKeyRef', event.target.value)} helperText="Required for signed LogoutRequest and LogoutResponse messages." />
                <TextInput id="identity-provider-saml-request-signing-cert-ref" labelText="Request-signing certificate reference (optional)" value={form.requestSigningCertificateRef} onChange={(event) => update('requestSigningCertificateRef', event.target.value)} />
              </>}
              <TextInput id="identity-provider-metadata" labelText="Metadata URL (optional)" value={form.metadataUrl} onChange={(event) => update('metadataUrl', event.target.value)} helperText="Used for a bounded reachability check." />
              <TextInput id="identity-provider-metadata-xml-ref" labelText="Metadata XML reference (optional)" value={form.metadataXmlRef} onChange={(event) => update('metadataXmlRef', event.target.value)} />
            </>}
            {form.protocol === 'ldap' && <><TextInput id="identity-provider-ldap-url" labelText="LDAPS URL" value={form.ldapUrl} {...fieldValidation('ldapUrl')} onChange={(event) => update('ldapUrl', event.target.value)} helperText="Certificate validation is required." /><TextInput id="identity-provider-ldap-bind-dn" labelText="Service bind DN" value={form.ldapBindDn} {...fieldValidation('ldapBindDn')} onChange={(event) => update('ldapBindDn', event.target.value)} /><TextInput id="identity-provider-ldap-bind-password-ref" labelText="Service bind password reference" value={form.ldapBindPasswordRef} {...fieldValidation('ldapBindPasswordRef')} onChange={(event) => update('ldapBindPasswordRef', event.target.value)} helperText="Reference name only. Password values are never stored here." /><TextInput id="identity-provider-ldap-user-base" labelText="User base DN" value={form.ldapUserBaseDn} {...fieldValidation('ldapUserBaseDn')} onChange={(event) => update('ldapUserBaseDn', event.target.value)} /><TextInput id="identity-provider-ldap-user-filter" labelText="User search filter" value={form.ldapUserSearchFilter} {...fieldValidation('ldapUserSearchFilter')} onChange={(event) => update('ldapUserSearchFilter', event.target.value)} helperText="Must contain {username}." /><TextInput id="identity-provider-ldap-directory-filter" labelText="Directory reconciliation filter" value={form.ldapUserEnumerationFilter} onChange={(event) => update('ldapUserEnumerationFilter', event.target.value)} /><NumberInput id="identity-provider-ldap-page-size" label="Directory page size" min={1} max={1000} value={form.ldapPageSize} {...fieldValidation('ldapPageSize')} onChange={(event) => update('ldapPageSize', event.currentTarget.value)} /><TextInput id="identity-provider-ldap-subject-attribute" labelText="Subject identifier attribute" value={form.ldapSubjectAttribute} onChange={(event) => update('ldapSubjectAttribute', event.target.value)} /><TextInput id="identity-provider-ldap-email-attribute" labelText="Email attribute" value={form.ldapEmailAttribute} onChange={(event) => update('ldapEmailAttribute', event.target.value)} /><TextInput id="identity-provider-ldap-group-base" labelText="Group base DN" value={form.ldapGroupBaseDn} {...fieldValidation('ldapGroupBaseDn')} onChange={(event) => update('ldapGroupBaseDn', event.target.value)} /><TextInput id="identity-provider-ldap-group-id" labelText="Group identifier attribute" value={form.ldapGroupIdAttribute} onChange={(event) => update('ldapGroupIdAttribute', event.target.value)} /><Select id="identity-provider-ldap-membership-mode" labelText="Group membership lookup" value={form.ldapMembershipMode} onChange={(event) => update('ldapMembershipMode', event.target.value as FormState['ldapMembershipMode'])}><SelectItem value="memberOf" text="Read memberOf from user" /><SelectItem value="group_search" text="Search groups by member DN" /></Select><Toggle id="identity-provider-ldap-nested-groups" labelText="Nested groups" labelA="Disabled" labelB="Enabled" toggled={form.ldapNestedGroups} onToggle={(checked) => update('ldapNestedGroups', checked)} /><TextInput id="identity-provider-ldap-tls-trust-ref" labelText="TLS trust reference (optional)" value={form.ldapTlsTrustRef} onChange={(event) => update('ldapTlsTrustRef', event.target.value)} /></>}
          </section>}
          {providerStep === 3 && <section className="eg-settings-form-column" aria-labelledby="identity-provider-step-heading">
            <div className="eg-settings-step-introduction"><h3 id="identity-provider-step-heading" tabIndex={-1}>Membership</h3><p>Choose how identities link to accounts and how provider-managed access is refreshed.</p></div>
            <TextInput id="identity-provider-directory-tenant" labelText="Directory tenant ID (optional)" value={form.directoryTenantId} onChange={(event) => update('directoryTenantId', event.target.value)} />
            <div><Toggle id="identity-provider-email-linking" aria-label="Allow verified email account linking" aria-describedby="identity-provider-email-linking-help" labelText="Allow verified email account linking" labelA="Disabled" labelB="Enabled" toggled={form.allowVerifiedEmailLinking} onToggle={(checked) => update('allowVerifiedEmailLinking', checked)} /><p id="identity-provider-email-linking-help" className="eg-settings-field-description">Enable only for trusted domains and providers that verify email ownership.</p></div>
            <TextInput id="identity-provider-authorization-attributes" labelText="Authorization attribute allowlist (optional)" value={form.authorizationAttributeKeys} onChange={(event) => update('authorizationAttributeKeys', event.target.value)} helperText="Comma-separated claim names retained for attribute-based mappings." />
            <Callout kind="info" lowContrast title="Memberships refresh at every sign-in" subtitle="EnterpriseGlue refreshes external groups, roles, and attributes before creating a session. Sign-in fails closed when refresh cannot complete." />
            <Toggle id="identity-provider-sync-manual" labelText="Allow manual membership refresh" labelA="Disabled" labelB="Enabled" toggled={form.syncOnManual} onToggle={(checked) => update('syncOnManual', checked)} />
            <Select id="identity-provider-sync-connector-capability" labelText="Membership source" value={form.syncConnectorCapability} onChange={(event) => update('syncConnectorCapability', event.target.value as FormState['syncConnectorCapability'])}><SelectItem value="claim_only" text="Sign-in claims" /><SelectItem value="ldap_directory" text="LDAP directory query" /></Select>
            {form.protocol === 'ldap' && <><Toggle id="identity-provider-ldap-scheduled-sync" labelText="Scheduled directory reconciliation" labelA="Disabled" labelB="Enabled" toggled={form.syncScheduled} onToggle={(checked) => update('syncScheduled', checked)} />{form.syncScheduled && <NumberInput id="identity-provider-ldap-sync-interval" label="Reconciliation interval (seconds)" min={60} max={86400} value={form.syncIntervalSeconds} {...fieldValidation('syncIntervalSeconds')} onChange={(event) => update('syncIntervalSeconds', event.currentTarget.value)} helperText="Minimum 60 seconds." />}</>}
            <Toggle id="identity-provider-enabled" labelText="Enable provider after creation" labelA="Disabled" labelB="Enabled" toggled={form.isEnabled} onToggle={(checked) => update('isEnabled', checked)} />
          </section>}
          {providerStep === 4 && <section className="eg-settings-form-column" aria-labelledby="identity-provider-step-heading">
            <div className="eg-settings-step-introduction"><h3 id="identity-provider-step-heading" tabIndex={-1}>Review</h3><p>Confirm the provider configuration before {editing ? 'saving changes' : 'creating the provider'}.</p></div>
            <Callout kind="info" lowContrast title="Review before saving" subtitle="Secret and certificate values are referenced by name and are not displayed or stored in this form." />
            <dl className="eg-settings-review-list" aria-label="Identity provider review">{providerReviewItems.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
          </section>}
        </fieldset>
      </div>
      <div className="eg-settings-workflow__actions">
        <Button kind="ghost" onClick={closeProviderWorkflow}>{providerViewOnly ? 'Close' : 'Cancel'}</Button>
        {providerStep > 1 && <Button kind="secondary" onClick={() => setProviderStep((step) => Math.max(1, step - 1))}>Back</Button>}
        {providerStep < 4 && <Button kind="primary" disabled={!providerViewOnly && !manage.allowed} onClick={continueProvider}>Continue</Button>}
        {providerStep === 4 && !providerViewOnly && <Button kind="primary" disabled={!manage.allowed || save.isPending || !formIsValid} onClick={submitProvider}>{save.isPending ? 'Saving provider…' : editing ? 'Save provider' : 'Create provider'}</Button>}
      </div>
    </section>}
    <Modal
      open={unsavedChanges.confirmationOpen}
      modalHeading="Leave without saving?"
      primaryButtonText="Leave"
      secondaryButtonText="Keep editing"
      onRequestClose={unsavedChanges.keepEditing}
      onRequestSubmit={unsavedChanges.leaveWithoutSaving}
    >
      <p>Your identity provider changes have not been saved. Leaving this page will discard them.</p>
    </Modal>
    <Modal open={Boolean(externalIdentityConflict)} danger modalHeading="Resolve external identity conflict" primaryButtonText="Unlink external identity" secondaryButtonText="Cancel" onRequestClose={() => setExternalIdentityConflict(null)} onRequestSubmit={() => externalIdentityConflict && unlinkExternalIdentity.mutate({ key: externalIdentityConflict.provider.key, subjectId: externalIdentityConflict.subjectId, userId: externalIdentityConflict.userId })} primaryButtonDisabled={!externalIdentityConflict?.subjectId.trim() || !externalIdentityConflict?.userId.trim() || unlinkExternalIdentity.isPending}>
      <p>This revokes the selected provider subject from the account currently linked to it. It does not transfer the identity to another account. Provider-managed memberships and provider refresh sessions for that account are revoked, and the action is audited.</p>
      <TextInput id="external-identity-subject" labelText="External provider subject ID" value={externalIdentityConflict?.subjectId || ''} onChange={(event) => setExternalIdentityConflict((current) => current ? { ...current, subjectId: event.target.value } : current)} helperText="Use the immutable subject identifier from the provider conflict or sign-in diagnostics, not an email address." />
      <TextInput id="external-identity-user" labelText="Currently linked account ID" value={externalIdentityConflict?.userId || ''} onChange={(event) => setExternalIdentityConflict((current) => current ? { ...current, userId: event.target.value } : current)} helperText="Confirm the affected local account ID before unlinking." />
      <p style={{ color: 'var(--cds-text-secondary)' }}>Afterward, recovery is permitted only through a fresh verified sign-in for the same recorded provider email when this provider allows verified-email linking. Any other sign-in remains blocked.</p>
    </Modal>
    <Modal
      open={Boolean(replayTarget)}
      danger
      modalHeading="Apply saved membership data?"
      primaryButtonText="Apply changes"
      secondaryButtonText="Cancel"
      onRequestClose={() => setReplayTarget(null)}
      onRequestSubmit={() => replayTarget && replayMemberships.mutate({ key: replayTarget.provider.key, cursor: replayTarget.cursor })}
      primaryButtonDisabled={replayMemberships.isPending}
    >
      EnterpriseGlue will use the most recently saved provider data for <strong>{identityProviderName(replayTarget?.provider)}</strong> to add and remove group memberships. It will not contact the provider. These access changes take effect immediately.
    </Modal>
    <Modal open={Boolean(archiveTarget)} danger modalHeading={`Disable ${identityProviderName(archiveTarget)}?`} primaryButtonText="Disable provider" secondaryButtonText="Cancel" onRequestClose={() => setArchiveTarget(null)} onRequestSubmit={() => archiveTarget && archive.mutate(archiveTarget.key)} primaryButtonDisabled={archive.isPending}>People will no longer be able to sign in with this provider. Provider-managed group memberships will be removed immediately. Existing mappings and sign-in history will remain. Manual and API-managed access will not change.</Modal>
  </>;
}
