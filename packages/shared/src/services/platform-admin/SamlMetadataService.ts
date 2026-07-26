import { secretResolver } from './SecretResolver.js';

const MAX_METADATA_BYTES = 1024 * 1024;

function metadataSource(configurationJson: string): { url: URL | null; xml: string | null } {
  let configuration: Record<string, unknown>;
  try { configuration = JSON.parse(configurationJson) as Record<string, unknown>; } catch { throw new Error('SAML provider configuration is invalid'); }
  const value = typeof configuration.metadataUrl === 'string' ? configuration.metadataUrl.trim() : '';
  if (!value) {
    const reference = typeof configuration.metadataXmlRef === 'string' ? configuration.metadataXmlRef.trim() : '';
    if (!reference) throw new Error('SAML metadataUrl or metadataXmlRef is required for connection validation');
    const xml = secretResolver.resolveStored(reference.startsWith('ref:') ? reference : `ref:${reference}`);
    if (!xml) throw new Error('SAML metadataXmlRef is unavailable');
    return { url: null, xml };
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('SAML metadataUrl must be a valid URL'); }
  if (url.protocol !== 'https:') throw new Error('SAML metadataUrl must use HTTPS');
  return { url, xml: null };
}

class SamlMetadataService {
  async testConnection(configurationJson: string): Promise<{ metadataUrl: string; entityDescriptorCount: number }> {
    const source = metadataSource(configurationJson);
    const metadata = source.url
      ? await (async () => {
        const response = await fetch(source.url!, { headers: { accept: 'application/samlmetadata+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`SAML metadata request failed (${response.status})`);
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_METADATA_BYTES) throw new Error('SAML metadata exceeds the maximum allowed size');
        return response.text();
      })()
      : source.xml!;
    if (Buffer.byteLength(metadata, 'utf8') > MAX_METADATA_BYTES) throw new Error('SAML metadata exceeds the maximum allowed size');
    const entityDescriptorCount = (metadata.match(/<(?:[A-Za-z0-9_-]+:)?EntityDescriptor\b/g) || []).length;
    if (entityDescriptorCount === 0) throw new Error('SAML metadata does not contain an EntityDescriptor');
    return { metadataUrl: source.url?.toString() || 'secret-reference', entityDescriptorCount };
  }
}

export const samlMetadataService = new SamlMetadataService();
