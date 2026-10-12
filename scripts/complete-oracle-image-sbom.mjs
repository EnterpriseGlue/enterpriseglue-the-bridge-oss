#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function oracleClientComponent(architecture, notices, installer) {
  assert.ok(['amd64', 'arm64'].includes(architecture), 'Unsupported Oracle image architecture');
  const version = notices.match(/Oracle Instant Client Basic (\d+\.\d+\.\d+)/)?.[1];
  assert.ok(version, 'Oracle runtime distribution version is missing');
  const distribution = installer.match(new RegExp(`${architecture}\\)\\s*archive=(\\S+)\\s*checksum=([0-9a-f]{64})`));
  assert.ok(distribution, 'Oracle distribution checksum is missing');
  const [, archive, checksum] = distribution;
  assert.ok(archive.endsWith(`-${version}.0.0.zip`), 'Oracle runtime and pinned distribution versions differ');
  const home = `/opt/oracle/instantclient_${version.split('.').slice(0, 2).join('_')}`;
  return {
    type: 'library',
    'bom-ref': `urn:enterpriseglue:oracle-instant-client:${version}:${architecture}`,
    group: 'Oracle', name: 'Oracle Instant Client Basic', version,
    supplier: { name: 'Oracle' },
    licenses: [{ license: { name: 'Oracle Instant Client (BASIC_LICENSE)' } }],
    externalReferences: [{
      type: 'distribution',
      url: `https://download.oracle.com/otn_software/linux/instantclient/${version.replaceAll('.', '')}00/${archive}`,
      hashes: [{ alg: 'SHA-256', content: checksum }],
    }],
    properties: [
      { name: 'enterpriseglue:architecture', value: architecture },
      { name: 'enterpriseglue:runtime-license', value: `${home}/BASIC_LICENSE` },
      { name: 'enterpriseglue:runtime-readme', value: `${home}/BASIC_README` },
      { name: 'enterpriseglue:inventory-source', value: 'runtime notices and checksummed distribution recipe; unpackaged binary' },
    ],
  };
}

export function addOracleClientComponent(sbom, component) {
  sbom.components ??= [];
  if (!sbom.components.some(entry => entry['bom-ref'] === component['bom-ref'])) sbom.components.push(component);
  const parent = sbom.metadata?.component?.['bom-ref'];
  if (parent) {
    sbom.dependencies ??= [];
    let dependency = sbom.dependencies.find(entry => entry.ref === parent);
    if (!dependency) { dependency = { ref: parent, dependsOn: [] }; sbom.dependencies.push(dependency); }
    dependency.dependsOn ??= [];
    if (!dependency.dependsOn.includes(component['bom-ref'])) dependency.dependsOn.push(component['bom-ref']);
  }
  return sbom;
}

if (process.argv[1]?.endsWith('/complete-oracle-image-sbom.mjs')) {
  const [image, file] = process.argv.slice(2);
  const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
  const metadata = JSON.parse(docker(['image', 'inspect', image]))[0];
  if (metadata.Config.Env?.some(value => value.startsWith('LD_LIBRARY_PATH=/opt/oracle/'))) {
    const temporary = mkdtempSync(path.join(tmpdir(), 'eg-oracle-sbom-'));
    const container = `eg-oracle-sbom-${randomBytes(6).toString('hex')}`;
    try {
      docker(['create', '--name', container, image]);
      docker(['cp', `${container}:/app/ORACLE_RUNTIME_NOTICES`, path.join(temporary, 'notices')]);
      const component = oracleClientComponent(metadata.Architecture,
        readFileSync(path.join(temporary, 'notices'), 'utf8'),
        readFileSync(path.resolve(import.meta.dirname, '../backend/install-oracle-instant-client.sh'), 'utf8'));
      // Verify the bundled licence/readme exist in the same retained image.
      for (const property of component.properties.filter(entry => /runtime-(?:license|readme)$/.test(entry.name))) {
        docker(['cp', `${container}:${property.value}`, path.join(temporary, path.basename(property.value))]);
      }
      const sbom = addOracleClientComponent(JSON.parse(readFileSync(file, 'utf8')), component);
      writeFileSync(file, JSON.stringify(sbom, null, 2) + '\n');
    } finally {
      try { docker(['rm', '-v', container]); } catch { /* Only this unstarted inventory container. */ }
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
