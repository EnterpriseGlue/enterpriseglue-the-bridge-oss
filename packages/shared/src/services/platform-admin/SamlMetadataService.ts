const MAX_METADATA_BYTES = 1024 * 1024;

function metadataUrl(configurationJson: string): URL {
  let configuration: Record<string, unknown>;
  try { configuration = JSON.parse(configurationJson) as Record<string, unknown>; } catch { throw new Error('SAML provider configuration is invalid'); }
  const value = typeof configuration.metadataUrl === 'string' ? configuration.metadataUrl.trim() : '';
  if (!value) throw new Error('SAML metadataUrl is required for connection validation');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('SAML metadataUrl must be a valid URL'); }
  if (url.protocol !== 'https:') throw new Error('SAML metadataUrl must use HTTPS');
  return url;
}

class SamlMetadataService {
  async testConnection(configurationJson: string): Promise<{ metadataUrl: string; entityDescriptorCount: number }> {
    const url = metadataUrl(configurationJson);
    const response = await fetch(url, { headers: { accept: 'application/samlmetadata+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`SAML metadata request failed (${response.status})`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_METADATA_BYTES) throw new Error('SAML metadata exceeds the maximum allowed size');
    const metadata = await response.text();
    if (Buffer.byteLength(metadata, 'utf8') > MAX_METADATA_BYTES) throw new Error('SAML metadata exceeds the maximum allowed size');
    const entityDescriptorCount = (metadata.match(/<(?:[A-Za-z0-9_-]+:)?EntityDescriptor\b/g) || []).length;
    if (entityDescriptorCount === 0) throw new Error('SAML metadata does not contain an EntityDescriptor');
    return { metadataUrl: url.toString(), entityDescriptorCount };
  }
}

export const samlMetadataService = new SamlMetadataService();
