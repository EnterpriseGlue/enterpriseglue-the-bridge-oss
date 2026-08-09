import { afterEach, describe, expect, it, vi } from 'vitest';
import { samlMetadataService } from '@enterpriseglue/shared/services/platform-admin/SamlMetadataService.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SAML_METADATA_XML;
  delete process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY;
  delete process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS;
});

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
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
  });

  it('blocks an unlisted metadata host before making a request', async () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = 'approved.example.test';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(samlMetadataService.testConnection(JSON.stringify({ metadataUrl: 'https://idp.example.test/metadata.xml' }))).rejects.toThrow('not permitted');
    expect(fetch).not.toHaveBeenCalled();
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

  it('cancels a non-success metadata response before reporting the failure', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, body: { cancel } }));

    await expect(samlMetadataService.testConnection(JSON.stringify({ metadataUrl: 'https://idp.example.test/metadata.xml' }))).rejects.toThrow('request failed (502)');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('validates secret-referenced metadata without fetching or exposing the reference', async () => {
    process.env.SAML_METADATA_XML = '<EntityDescriptor entityID="https://idp.example.test" />';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(samlMetadataService.testConnection(JSON.stringify({ metadataXmlRef: 'env://SAML_METADATA_XML' }))).resolves.toEqual({
      metadataUrl: 'secret-reference',
      entityDescriptorCount: 1,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
