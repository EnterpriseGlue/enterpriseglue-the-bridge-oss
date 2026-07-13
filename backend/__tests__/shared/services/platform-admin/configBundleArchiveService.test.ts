import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { configBundleArchiveService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleArchiveService.js';

function archive(entries: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  for (const [path, value] of Object.entries(entries)) zip.addFile(path, Buffer.from(JSON.stringify(value)));
  return zip.toBuffer();
}

const bundle = {
  apiVersion: 'enterpriseglue.ai/v1alpha1',
  kind: 'EnterpriseGlueConfigBundle',
  metadata: { key: 'acme.authz', owner: 'platform' },
  tenantKey: 'acme',
  mode: 'preview_only',
  settings: {},
  imports: ['./groups.json'],
};

describe('configBundleArchiveService', () => {
  it('converts a folder-style ZIP into the existing configuration envelope', () => {
    expect(configBundleArchiveService.readZip(archive({
      'bundle.json': bundle,
      'groups.json': { groups: [{ key: 'group.ops', name: 'Operations' }] },
    }))).toEqual({
      bundle,
      files: { './groups.json': { groups: [{ key: 'group.ops', name: 'Operations' }] } },
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
});
