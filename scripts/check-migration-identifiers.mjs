#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const canonicalMigrationDirectory = 'packages/shared/src/db/migrations';

// These two migrations shipped in v0.13.1 with the same numeric prefix. Their
// TypeORM class names are distinct, so changing either released filename now
// would be less safe than retaining an explicit, narrowly scoped exception.
const releasedDuplicateAllowlist = new Map([
  [
    '1700000000085',
    [
      '1700000000085-add-config-bundle-replay-sync-run.ts',
      '1700000000085-add-role-assignment-source-ref-index.ts',
    ],
  ],
]);

export function findUnexpectedMigrationIdentifierDuplicates(filenames) {
  const identifiers = new Map();
  for (const filename of filenames) {
    const match = filename.match(/^(\d+)-.+\.ts$/);
    if (!match) continue;
    const values = identifiers.get(match[1]) ?? [];
    values.push(filename);
    identifiers.set(match[1], values);
  }

  const failures = [];
  for (const [identifier, values] of identifiers) {
    if (values.length < 2) continue;
    const expected = releasedDuplicateAllowlist.get(identifier) ?? [];
    const actual = [...values].sort();
    if (
      actual.length !== expected.length ||
      actual.some((value, index) => value !== [...expected].sort()[index])
    ) {
      failures.push({ identifier, filenames: actual });
    }
  }
  return failures.sort((left, right) =>
    left.identifier.localeCompare(right.identifier),
  );
}

export function main(root = process.cwd()) {
  const directory = resolve(root, canonicalMigrationDirectory);
  const failures = findUnexpectedMigrationIdentifierDuplicates(
    readdirSync(directory),
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `[migration-identifiers] ${failure.identifier}: ${failure.filenames.join(', ')}`,
      );
    }
    throw new Error('Unexpected duplicate migration identifiers detected.');
  }
  console.log(
    '[migration-identifiers] Canonical migration identifiers are unique apart from the released v0.13.1 exception.',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`[migration-identifiers] ${error.message}`);
    process.exitCode = 1;
  }
}
