import { describe, expect, it } from 'vitest';
import { dirname, join, relative, resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(currentDir, '../../../..');
const productionRoots = [
  join(workspaceRoot, 'packages/backend-host/src'),
  join(workspaceRoot, 'packages/shared/src'),
];

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

function workspacePath(path: string): string {
  return relative(workspaceRoot, path).split('\\').join('/');
}

const productionFiles = productionRoots.flatMap(collectTypeScriptFiles);

describe('configuration bundle runtime boundary', () => {
  it('keeps mounted-bundle path access inside configuration and startup ingress', () => {
    const allowed = new Set([
      'packages/shared/src/config/index.ts',
      'packages/backend-host/src/services/configBundleBootstrap.ts',
      'packages/backend-host/src/services/configBundleFileIngress.ts',
    ]);
    const pathReaders = productionFiles
      .filter((path) => /EG_CONFIG_BUNDLE_PATH|configBundlePath/.test(readFileSync(path, 'utf8')))
      .map(workspacePath)
      .sort();

    expect(pathReaders).toEqual([...allowed].sort());
  });

  it('has exactly one filesystem ingress for JSON or ZIP bundle bytes', () => {
    const filesystemReaders = productionFiles
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return /from ['"]node:fs\/promises['"]/.test(source) && /ConfigBundle|configBundle|CONFIG_BUNDLE/.test(source);
      })
      .map(workspacePath);

    expect(filesystemReaders).toEqual([
      'packages/backend-host/src/services/configBundleFileIngress.ts',
    ]);
  });

  it('prevents runtime modules from importing bundle compilers or startup file ingress', () => {
    const allowedCompilerBoundaries = [
      // These services generate or ingest administrator-supplied bundles; they
      // do not participate in request-time runtime authorization.
      /^packages\/shared\/src\/services\/platform-admin\/CamundaNativeGrantDraftService\.ts$/,
      /^packages\/shared\/src\/services\/platform-admin\/ConfigBundleRemoteSourceService\.ts$/,
      /^packages\/shared\/src\/services\/platform-admin\/ConfigBundle(?:Preview|Diff|Apply|Archive|Export|SecretPreflight)Service\.ts$/,
      /^packages\/shared\/src\/services\/platform-admin\/index\.ts$/,
      /^packages\/backend-host\/src\/modules\/platform-admin\/routes\/authz\/config-bundles\.ts$/,
      // The engine-administration route retains the compatibility migration
      // endpoints; ordinary Mission Control runtime routes must not import a
      // bundle compiler or the startup ingress.
      /^packages\/backend-host\/src\/modules\/mission-control\/engines\/routes\.ts$/,
      /^packages\/backend-host\/src\/services\/configBundleBootstrap\.ts$/,
      /^packages\/backend-host\/src\/services\/configBundleFileIngress\.ts$/,
    ];
    const compilerImport = /ConfigBundle(?:Preview|Diff|Apply|Archive|Export|SecretPreflight)Service\.js/;
    const ingressImport = /configBundleFileIngress\.js/;

    const violations = productionFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      if (!compilerImport.test(source) && !ingressImport.test(source)) return [];
      const normalized = workspacePath(path);
      return allowedCompilerBoundaries.some((pattern) => pattern.test(normalized)) ? [] : [normalized];
    });

    expect(violations).toEqual([]);
  });
});
