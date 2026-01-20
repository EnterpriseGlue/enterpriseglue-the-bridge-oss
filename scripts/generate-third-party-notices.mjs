import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function splitNameAndVersion(packageKey) {
  const idx = packageKey.lastIndexOf('@');
  if (idx <= 0) return { name: packageKey, version: '' };
  return { name: packageKey.slice(0, idx), version: packageKey.slice(idx + 1) };
}

function normalizeLicense(license) {
  const v = String(license ?? '').trim();
  return v || 'UNKNOWN';
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  return [v];
}

function isCopyleft(license) {
  const v = String(license || '').toUpperCase();
  // Conservative flagging: GPL/AGPL are typically incompatible with Apache-2.0 distribution.
  // LGPL is often considered acceptable in JS contexts but is still flagged here for review.
  return v.includes('AGPL') || v.includes('GPL') || v.includes('LGPL');
}

function isDualLicensedWithCopyleftOption(license) {
  const v = String(license || '').toUpperCase();
  const hasOr = v.includes(' OR ');
  const hasCopyleft = v.includes('AGPL') || v.includes('GPL') || v.includes('LGPL');
  const hasPermissive = v.includes('MIT') || v.includes('APACHE') || v.includes('ISC') || v.includes('BSD') || v.includes('ZLIB');
  return hasOr && hasCopyleft && hasPermissive;
}

async function loadLicenseJson(jsonPath) {
  const raw = await readFile(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  return data;
}

async function loadJsonIfExists(jsonPath) {
  if (!existsSync(jsonPath)) return null;
  const raw = await readFile(jsonPath, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptsDir, '..');

  const sources = [
    { name: 'backend', file: path.join(repoRoot, 'backend', 'third_party_licenses.json') },
    { name: 'frontend', file: path.join(repoRoot, 'frontend', 'third_party_licenses.json') },
  ];

  const merged = new Map();

  // Exclude the workspace root packages themselves (we only want third-party dependencies).
  const excludedPackageKeys = new Set();
  for (const src of sources) {
    const pkgJsonPath = path.join(path.dirname(src.file), 'package.json');
    const pkg = await loadJsonIfExists(pkgJsonPath);
    if (pkg?.name && pkg?.version) {
      excludedPackageKeys.add(`${pkg.name}@${pkg.version}`);
    }
  }

  for (const src of sources) {
    if (!existsSync(src.file)) continue;
    const data = await loadLicenseJson(src.file);
    for (const [pkgKey, meta] of Object.entries(data)) {
      if (excludedPackageKeys.has(pkgKey)) continue;
      const existing = merged.get(pkgKey);
      const licenses = normalizeLicense(meta?.licenses);
      const repository = meta?.repository || meta?.url || '';

      if (!existing) {
        merged.set(pkgKey, {
          licenses,
          repository,
          sources: new Set([src.name]),
        });
        continue;
      }

      existing.sources.add(src.name);
      // Prefer a non-empty repository.
      if (!existing.repository && repository) existing.repository = repository;
      // Prefer a non-UNKNOWN license if present.
      if (existing.licenses === 'UNKNOWN' && licenses !== 'UNKNOWN') existing.licenses = licenses;
    }
  }

  const rows = Array.from(merged.entries())
    .map(([pkgKey, meta]) => {
      const { name, version } = splitNameAndVersion(pkgKey);
      return {
        name,
        version,
        licenses: meta.licenses,
        repository: meta.repository,
        sources: Array.from(meta.sources).sort().join(', '),
      };
    })
    .sort((a, b) => (a.name + '@' + a.version).localeCompare(b.name + '@' + b.version));

  const licenseCounts = new Map();
  const copyleft = [];
  const dualCopyleftOption = [];
  const unknown = [];

  for (const r of rows) {
    for (const l of toArray(r.licenses)) {
      const key = normalizeLicense(l);
      licenseCounts.set(key, (licenseCounts.get(key) || 0) + 1);
      if (key === 'UNKNOWN') unknown.push(r);
      if (isDualLicensedWithCopyleftOption(key)) {
        dualCopyleftOption.push({ ...r, license: key });
      } else if (isCopyleft(key)) {
        copyleft.push({ ...r, license: key });
      }
    }
  }

  const generatedAt = new Date().toISOString();

  const lines = [];
  lines.push('# THIRD_PARTY_NOTICES');
  lines.push('');
  lines.push('This project includes software developed by third parties. The following notices are provided for attribution purposes.');
  lines.push('');
  lines.push(`Generated at: ${generatedAt}`);
  lines.push('');
  lines.push('Generated from:');
  for (const src of sources) {
    lines.push(`- ${path.relative(repoRoot, src.file)}`);
  }
  lines.push('');
  lines.push('## License summary');
  lines.push('');
  lines.push('| License | Count |');
  lines.push('|---|---:|');
  for (const [license, count] of Array.from(licenseCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${license.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${count} |`);
  }
  lines.push('');

  if (dualCopyleftOption.length > 0) {
    lines.push('## Review required (dual-licensed with copyleft option)');
    lines.push('');
    lines.push('The following dependencies are listed with a license expression that includes a copyleft option (e.g. "MIT OR GPL").');
    lines.push('If you are distributing under Apache-2.0, you should confirm you are relying on the permissive option (e.g. MIT) and retain the relevant license text/attribution.');
    lines.push('');
    lines.push('| Package | Version | License expression | Repository | Source(s) |');
    lines.push('|---|---|---|---|---|');
    for (const r of dualCopyleftOption.sort((a, b) => (a.name + a.version + a.license).localeCompare(b.name + b.version + b.license))) {
      lines.push(`| ${r.name} | ${r.version} | ${r.license.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${String(r.repository || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${r.sources} |`);
    }
    lines.push('');
  }

  if (copyleft.length > 0) {
    lines.push('## Review required (copyleft-flagged)');
    lines.push('');
    lines.push('The following dependencies appear to use GPL/AGPL/LGPL-style licensing and should be reviewed for compatibility with your distribution model:');
    lines.push('');
    lines.push('| Package | Version | License | Repository | Source(s) |');
    lines.push('|---|---|---|---|---|');
    for (const r of copyleft.sort((a, b) => (a.name + a.version + a.license).localeCompare(b.name + b.version + b.license))) {
      lines.push(`| ${r.name} | ${r.version} | ${r.license.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${String(r.repository || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${r.sources} |`);
    }
    lines.push('');
  }

  if (unknown.length > 0) {
    lines.push('## Review required (unknown license)');
    lines.push('');
    lines.push('| Package | Version | License | Repository | Source(s) |');
    lines.push('|---|---|---|---|---|');
    for (const r of unknown.sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version))) {
      lines.push(`| ${r.name} | ${r.version} | ${r.licenses.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${String(r.repository || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${r.sources} |`);
    }
    lines.push('');
  }

  lines.push('## Dependency list');
  lines.push('');
  lines.push('| Package | Version | License | Repository | Source(s) |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.version} | ${String(r.licenses).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${String(r.repository || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${r.sources} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('How this file is generated:');
  lines.push('');
  lines.push('```sh');
  lines.push('# backend');
  lines.push('npx --yes license-checker --production --json --out third_party_licenses.json');
  lines.push('# frontend');
  lines.push('npx --yes license-checker --production --json --out third_party_licenses.json');
  lines.push('');
  lines.push('# from repo root');
  lines.push('node scripts/generate-third-party-notices.mjs');
  lines.push('```');
  lines.push('');

  const outputPath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
  await writeFile(outputPath, lines.join('\n'), 'utf8');

  // Console output for CI / local usage
  console.log(`Wrote ${path.relative(repoRoot, outputPath)} with ${rows.length} entries.`);
  if (dualCopyleftOption.length > 0) console.log(`Dual-licensed with copyleft option: ${dualCopyleftOption.length}`);
  if (copyleft.length > 0) console.log(`Copyleft-flagged: ${copyleft.length}`);
  if (unknown.length > 0) console.log(`Unknown license: ${unknown.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
