import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const missionControlRoot = fileURLToPath(new URL(
  '../../../../packages/backend-host/src/modules/mission-control/',
  import.meta.url,
));

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('mission-control router authentication isolation', () => {
  it('does not register an unscoped browser-auth middleware on a shared router', () => {
    const offenders = typescriptFiles(missionControlRoot)
      .filter((file) => /\b(?:r|router)\.use\(\s*requireAuth\s*\)/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(missionControlRoot.length));

    expect(offenders).toEqual([]);
  });
});
