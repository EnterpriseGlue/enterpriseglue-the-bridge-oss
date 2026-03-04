import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');

/**
 * API Surface Snapshot — Layer 3 contract validation.
 *
 * Reads the plugin-api `.d.ts` files and snapshots exported interface names,
 * method signatures, and property types. Any rename, removal, or signature
 * change shows up as a snapshot diff requiring explicit approval via:
 *
 *   npm --prefix backend run test:unit -- -u
 */

function extractExports(content: string): string[] {
  const lines = content.split('\n');
  const exports: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Capture: export type/interface/const/function declarations
    if (/^export\s+(type|interface|const|function|class|enum)\s+/.test(trimmed)) {
      exports.push(trimmed);
      continue;
    }

    // Capture: properties and methods inside exported interfaces (indented lines with type annotations)
    if (/^\s{2}\w/.test(line) && (line.includes(':') || line.includes('('))) {
      exports.push(trimmed);
    }
  }

  return exports;
}

describe('Plugin API surface snapshot', () => {
  it('frontend contract surface matches snapshot', () => {
    const frontendDts = readFileSync(
      resolve(root, 'packages/enterprise-plugin-api/src/frontend.d.ts'),
      'utf-8',
    );

    const surface = extractExports(frontendDts);
    expect(surface).toMatchSnapshot();
  });

  it('backend contract surface matches snapshot', () => {
    const backendDts = readFileSync(
      resolve(root, 'packages/enterprise-plugin-api/src/backend.d.ts'),
      'utf-8',
    );

    const surface = extractExports(backendDts);
    expect(surface).toMatchSnapshot();
  });
});
