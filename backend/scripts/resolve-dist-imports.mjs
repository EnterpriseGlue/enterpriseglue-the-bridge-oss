#!/usr/bin/env node
/**
 * Post-build script: resolves @enterpriseglue/* path aliases in compiled JS
 * output to relative paths, making the dist directory self-contained.
 *
 * This is necessary because tsc-alias skips aliases that are resolvable via
 * node_modules (the file: dependencies create symlinks). At runtime the
 * symlinks point to TypeScript source which Node cannot execute directly,
 * so we rewrite them to point at the compiled .js siblings inside dist/.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(scriptDir, '..', 'dist');

// Alias prefix → corresponding directory inside the dist tree
const aliases = [
  { prefix: '@enterpriseglue/shared/',        distSubdir: 'packages/shared/src/' },
  { prefix: '@enterpriseglue/backend-host/',   distSubdir: 'packages/backend-host/src/' },
  { prefix: '@modules/',                       distSubdir: 'packages/backend-host/src/modules/' },
];

// Build a single regex that matches any of the alias prefixes inside quotes
const prefixAlternation = aliases
  .map(a => a.prefix.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'))
  .join('|');
const importRe = new RegExp(`(['"])(${prefixAlternation})([^'"]+)(['"])`, 'g');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

let totalReplacements = 0;

for (const file of walk(distDir)) {
  let content = readFileSync(file, 'utf8');
  let changed = false;

  content = content.replace(importRe, (_match, q1, prefix, rest, q2) => {
    const alias = aliases.find(a => a.prefix === prefix);
    if (!alias) return _match;

    const targetAbs = join(distDir, alias.distSubdir, rest);
    let rel = relative(dirname(file), targetAbs).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;

    changed = true;
    totalReplacements++;
    return `${q1}${rel}${q2}`;
  });

  if (changed) writeFileSync(file, content);
}

console.log(`✔ Resolved ${totalReplacements} path alias imports in dist/`);
