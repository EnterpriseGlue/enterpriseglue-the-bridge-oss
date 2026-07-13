import { afterEach, describe, expect, it, vi } from 'vitest';
import { samlMetadataService } from '@enterpriseglue/shared/services/platform-admin/SamlMetadataService.js';

afterEach(() => vi.unstubAllGlobals());

describe('samlMetadataService', () => {
  it('validates a bounded HTTPS metadata document with entity descriptors', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.test" />', {
      status: 200,
      headers: { 'content-length': '128' },
    }));
    vi.stubGlobal('fetch', fetch);

    await expect(samlMetadataService.testConnection(JSON.stringify({ metadataUrl: 'https://idp.example.test/metadata.xml' }))).resolves.toEqual({
      metadataUrl: 'https://idp.example.test/metadata.xml',
      entityDescriptorCount: 1,
    });
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('rejects non-HTTPS metadata URLs before making a request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(samlMetadataService.testConnection(JSON.stringify({ metadataUrl: 'http://idp.example.test/metadata.xml' }))).rejects.toThrow('must use HTTPS');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects metadata that does not contain an entity descriptor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not metadata</html>', { status: 200 })));

    await expect(samlMetadataService.testConnection(JSON.stringify({ metadataUrl: 'https://idp.example.test/metadata.xml' }))).rejects.toThrow('does not contain an EntityDescriptor');
  });
});
