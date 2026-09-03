import { execFileSync } from 'node:child_process';

function collectReferences(value, references) {
  if (typeof value === 'string') {
    references.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, references);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectReferences(entry, references);
  }
}

export function packageEntries(tarball) {
  return execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, ''));
}

export function packageEntryPointReferences(manifest) {
  const references = new Set();
  collectReferences(manifest.exports, references);
  collectReferences(manifest.bin, references);
  for (const field of ['main', 'module', 'types', 'typings']) {
    collectReferences(manifest[field], references);
  }
  return [...references].filter((reference) => reference.startsWith('./')).sort();
}

export function verifyPackageEntryPoints({ manifest, tarball, entries = packageEntries(tarball) }) {
  const packageFiles = new Set(entries);
  const references = packageEntryPointReferences(manifest);
  if (!references.length) {
    throw new Error(`${manifest.name} has no package entry points.`);
  }
  for (const reference of references) {
    const relative = reference.slice(2);
    if (relative.includes('*')) {
      const [prefix, suffix] = relative.split('*');
      const matched = entries.some((entry) => (
        entry.startsWith(`package/${prefix}`) && entry.endsWith(suffix)
      ));
      if (!matched) throw new Error(`${manifest.name} has no packed entry matching ${reference}.`);
      continue;
    }
    if (!packageFiles.has(`package/${relative}`)) {
      throw new Error(`${manifest.name} is missing packed entry point ${reference}.`);
    }
  }
}
