import assert from 'node:assert/strict';
import test from 'node:test';

import { findUnexpectedMigrationIdentifierDuplicates } from './check-migration-identifiers.mjs';

test('accepts unique migration identifiers and the exact released exception', () => {
  assert.deepEqual(
    findUnexpectedMigrationIdentifierDuplicates([
      '1700000000085-add-role-assignment-source-ref-index.ts',
      '1700000000085-add-config-bundle-replay-sync-run.ts',
      '1700000000114-add-plugin-platform.ts',
      '1700000000115-add-plugin-broker-replay.ts',
    ]),
    [],
  );
});

test('rejects a new duplicate and any expansion of the released exception', () => {
  assert.deepEqual(
    findUnexpectedMigrationIdentifierDuplicates([
      '1700000000114-add-plugin-platform.ts',
      '1700000000114-another-feature.ts',
    ]),
    [
      {
        identifier: '1700000000114',
        filenames: [
          '1700000000114-add-plugin-platform.ts',
          '1700000000114-another-feature.ts',
        ],
      },
    ],
  );
  assert.equal(
    findUnexpectedMigrationIdentifierDuplicates([
      '1700000000085-add-config-bundle-replay-sync-run.ts',
      '1700000000085-add-role-assignment-source-ref-index.ts',
      '1700000000085-unreleased-third-migration.ts',
    ]).length,
    1,
  );
});
