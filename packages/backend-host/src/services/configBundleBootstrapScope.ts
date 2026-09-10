import {
  EnterpriseGlueConfigBundleV1Beta1Schema,
  ConfigIdentityProvidersFileSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import type { PlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';

// This validator consumes data, not the filesystem ingress or its compiler.
type ProviderBootstrapInput = {
  bundle: unknown;
  files: Record<string, unknown>;
  acknowledgements?: unknown;
};

/** No request route calls this boundary: it accepts only the verified startup file. */
export function providerBootstrapCapability(payload: ProviderBootstrapInput): Extract<PlatformDatabaseCapability, { kind: 'config-bootstrap' }> {
  const reject = () => { throw new Error('Pooled bootstrap supports only an additive platform identity-provider bundle'); };
  if (!payload || Object.keys(payload).some(key => !['bundle', 'files', 'acknowledgements'].includes(key))
    || (payload.acknowledgements !== undefined && (!Array.isArray(payload.acknowledgements) || payload.acknowledgements.length !== 0))) reject();
  const raw = payload.bundle;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).some(key => !['apiVersion', 'kind', 'metadata', 'tenantKey', 'mode', 'imports'].includes(key))) reject();
  const parsed = EnterpriseGlueConfigBundleV1Beta1Schema.safeParse(raw);
  if (!parsed.success) return reject();
  const bundle = parsed.data;
  if (bundle.tenantKey !== 'platform' || bundle.mode !== 'additive'
    || bundle.imports.length !== 1 || bundle.imports[0] !== './identity-providers.json'
    || !payload.files || Object.keys(payload.files).length !== 1 || !Object.prototype.hasOwnProperty.call(payload.files, './identity-providers.json')) reject();
  const providers = ConfigIdentityProvidersFileSchema.safeParse(payload.files['./identity-providers.json']);
  if (!providers.success) return reject();
  if (!providers.data.identityProviders.length || providers.data.identityProviders.length > 100
    || providers.data.identityProviders.some(provider => provider.type === 'ldap' || !provider.enabled
      || provider.authenticationMode !== 'direct' || provider.allowVerifiedEmailLinking)) reject();
  return { kind: 'config-bootstrap', bundleKey: bundle.metadata.key,
    providerKeys: providers.data.identityProviders.map(provider => provider.key) };
}
