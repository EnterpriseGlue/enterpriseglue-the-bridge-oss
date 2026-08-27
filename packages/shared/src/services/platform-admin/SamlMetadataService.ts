import { secretResolver } from './SecretResolver.js';
import { readBoundedIdentityProviderResponse, validateIdentityProviderEndpointUrl } from './IdentityProviderEndpointPolicy.js';

const MAX_METADATA_BYTES = 1024 * 1024;

async function metadataSource(
  configurationJson: string,
  secretContext?: { tenantId?: string | null; correlationId?: string },
): Promise<{ url: URL | null; xml: string | null }> {
  let configuration: Record<string, unknown>;
  try { configuration = JSON.parse(configurationJson) as Record<string, unknown>; } catch { throw new Error('SAML provider configuration is invalid'); }
  const value = typeof configuration.metadataUrl === 'string' ? configuration.metadataUrl.trim() : '';
  if (!value) {
    const reference = typeof configuration.metadataXmlRef === 'string' ? configuration.metadataXmlRef.trim() : '';
    if (!reference) throw new Error('SAML metadataUrl or metadataXmlRef is required for connection validation');
    const stored = reference.startsWith('ref:') ? reference : `ref:${reference}`;
    const xml = stored.includes('tenant-secret://')
      ? secretContext?.tenantId
        ? await secretResolver.resolveTenantStored(stored, {
          tenantId: secretContext.tenantId,
          purpose: 'saml.metadata_xml',
          ...(secretContext.correlationId ? { correlationId: secretContext.correlationId } : {}),
        })
        : null
      : secretResolver.resolveStored(stored);
    if (!xml) throw new Error('SAML metadataXmlRef is unavailable');
    return { url: null, xml };
  }
  const url = validateIdentityProviderEndpointUrl(value, 'SAML metadataUrl', ['https:']);
  return { url, xml: null };
}

class SamlMetadataService {
  async testConnection(configurationJson: string, secretContext?: { tenantId?: string | null; correlationId?: string }): Promise<{ metadataUrl: string; entityDescriptorCount: number }> {
    const source = await metadataSource(configurationJson, secretContext);
    const metadata = source.url
      ? await (async () => {
        const response = await fetch(source.url!, { redirect: 'error', headers: { accept: 'application/samlmetadata+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`SAML metadata request failed (${response.status})`);
        }
        return (await readBoundedIdentityProviderResponse(response, 'SAML metadata', MAX_METADATA_BYTES)).toString('utf8');
      })()
      : source.xml!;
    if (Buffer.byteLength(metadata, 'utf8') > MAX_METADATA_BYTES) throw new Error('SAML metadata exceeds the maximum allowed size');
    const entityDescriptorCount = (metadata.match(/<(?:[A-Za-z0-9_-]+:)?EntityDescriptor\b/g) || []).length;
    if (entityDescriptorCount === 0) throw new Error('SAML metadata does not contain an EntityDescriptor');
    return { metadataUrl: source.url?.toString() || 'secret-reference', entityDescriptorCount };
  }
}

export const samlMetadataService = new SamlMetadataService();
