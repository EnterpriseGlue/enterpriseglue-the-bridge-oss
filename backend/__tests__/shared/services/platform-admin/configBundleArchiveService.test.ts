import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { configBundleArchiveService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleArchiveService.js';

function archive(entries: Record<string, unknown | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [path, value] of Object.entries(entries)) zip.addFile(path, Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)));
  return zip.toBuffer();
}

const bundle = {
  apiVersion: 'enterpriseglue.ai/v1beta1',
  kind: 'EnterpriseGlueConfigBundle',
  metadata: { key: 'acme.authz', owner: 'platform' },
  tenantKey: 'acme',
  mode: 'preview_only',
  imports: ['./groups.json'],
};

describe('configBundleArchiveService', () => {
  it('converts a folder-style ZIP into the existing configuration envelope', () => {
    const mappingBundle = {
      ...bundle,
      imports: ['./groups.json', './engine-tenant-mappings.json'],
    };
    expect(configBundleArchiveService.readZip(archive({
      'bundle.json': mappingBundle,
      'groups.json': { groups: [{ key: 'group.ops', name: 'Operations' }] },
      'engine-tenant-mappings.json': { engineTenantMappings: [] },
    }))).toEqual({
      bundle: mappingBundle,
      files: {
        './groups.json': { groups: [{ key: 'group.ops', name: 'Operations' }] },
        './engine-tenant-mappings.json': { engineTenantMappings: [] },
      },
    });
  });

  it('accepts every production engine mapping file advertised by the public contract', () => {
    const mappingBundle = {
      ...bundle,
      imports: ['./engine-backstop-mappings.json'],
    };
    expect(configBundleArchiveService.readZip(archive({
      'bundle.json': mappingBundle,
      'engine-backstop-mappings.json': { engineBackstopMappings: [] },
    }))).toEqual({
      bundle: mappingBundle,
      files: {
        './engine-backstop-mappings.json': { engineBackstopMappings: [] },
      },
    });
  });

  it('rejects non-JSON entries before the configuration compiler receives them', () => {
    expect(() => configBundleArchiveService.readZip(archive({
      'bundle.json': bundle,
      'README.txt': 'not configuration',
    }))).toThrow('Configuration archive entries must be JSON files');
  });

  it('requires a root bundle manifest', () => {
    expect(() => configBundleArchiveService.readZip(archive({
      'groups.json': { groups: [] },
    }))).toThrow('must contain bundle.json');
  });

  it('rejects undeclared production files before the configuration compiler receives them', () => {
    expect(() => configBundleArchiveService.readZip(archive({
      'bundle.json': bundle,
      'identity-mocks.json': { subjects: [] },
    }))).toThrow('not declared by the production bundle contract');
  });

  it('rejects duplicate JSON object keys instead of allowing JSON.parse to overwrite one', () => {
    expect(() => configBundleArchiveService.readZip(archive({
      'bundle.json': bundle,
      'groups.json': Buffer.from('{"groups":[],"groups":[]}'),
    }))).toThrow('duplicate JSON key "groups"');
  });

  it('rejects invalid maximum archive sizes before reading the input', () => {
    const input = archive({ 'bundle.json': bundle });
    for (const maxBytes of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => configBundleArchiveService.readZip(input, maxBytes)).toThrow('maximum size must be a positive safe integer');
    }
  });
});
