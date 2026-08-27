import assert from 'node:assert/strict';
import test from 'node:test';

import { findChangedWorkspaceDependencies } from './check-workspace-dependency-version-drift.mjs';

test('detects a changed packed workspace dependency version', () => {
  assert.deepEqual(
    findChangedWorkspaceDependencies({
      manifest: {
        dependencies: {
          '@enterpriseglue/plugin-sdk': 'workspace:*',
          ajv: '^8.17.1',
        },
      },
      currentVersions: new Map([['@enterpriseglue/plugin-sdk', '0.3.1']]),
      baseVersions: new Map([['@enterpriseglue/plugin-sdk', '0.3.0']]),
    }),
    [
      {
        name: '@enterpriseglue/plugin-sdk',
        baseVersion: '0.3.0',
        currentVersion: '0.3.1',
      },
    ],
  );
});

test('ignores unchanged and non-workspace dependency versions', () => {
  assert.deepEqual(
    findChangedWorkspaceDependencies({
      manifest: {
        dependencies: {
          '@enterpriseglue/plugin-sdk': 'workspace:^',
          '@enterpriseglue/plugin-runtime': '^0.2.0',
        },
      },
      currentVersions: new Map([
        ['@enterpriseglue/plugin-sdk', '0.3.1'],
        ['@enterpriseglue/plugin-runtime', '0.2.1'],
      ]),
      baseVersions: new Map([
        ['@enterpriseglue/plugin-sdk', '0.3.1'],
        ['@enterpriseglue/plugin-runtime', '0.2.0'],
      ]),
    }),
    [],
  );
});

test('detects a newly introduced workspace package version', () => {
  assert.deepEqual(
    findChangedWorkspaceDependencies({
      manifest: {
        optionalDependencies: {
          '@enterpriseglue/plugin-runtime': 'workspace:*',
        },
      },
      currentVersions: new Map([['@enterpriseglue/plugin-runtime', '0.2.1']]),
      baseVersions: new Map(),
    }),
    [
      {
        name: '@enterpriseglue/plugin-runtime',
        baseVersion: null,
        currentVersion: '0.2.1',
      },
    ],
  );
});
