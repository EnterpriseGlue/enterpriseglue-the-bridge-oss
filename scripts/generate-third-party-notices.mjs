import { readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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

function normalizeLicenseField(license) {
  if (Array.isArray(license)) {
    const values = license
      .map((entry) => normalizeLicenseField(entry))
      .flatMap((entry) => String(entry).split(/\s+OR\s+/))
      .map((entry) => normalizeLicense(entry))
      .filter(Boolean);
    return Array.from(new Set(values)).join(' OR ') || 'UNKNOWN';
  }

  if (license && typeof license === 'object') {
    return normalizeLicenseField(license.type || license.name || license.url || 'UNKNOWN');
  }

  return normalizeLicense(license);
}

function normalizeRepository(repository) {
  if (!repository) return '';
  if (typeof repository === 'string') return repository;
  if (typeof repository === 'object') return String(repository.url || repository.repository || '').trim();
  return '';
}

function normalizePerson(person) {
  if (!person) return { name: '', email: '', url: '' };

  if (typeof person === 'string') {
    const match = person.match(/^([^<(]+?)\s*(?:<([^>]+)>)?\s*(?:\(([^)]+)\))?$/);
    return {
      name: String(match?.[1] || person).trim(),
      email: String(match?.[2] || '').trim(),
      url: String(match?.[3] || '').trim(),
    };
  }

  return {
    name: String(person.name || '').trim(),
    email: String(person.email || '').trim(),
    url: String(person.url || '').trim(),
  };
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

async function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return '';
  return readFile(filePath, 'utf8');
}

async function loadPackageJson(packageDir) {
  const pkgJsonPath = path.join(packageDir, 'package.json');
  const pkg = await loadJsonIfExists(pkgJsonPath);
  if (!pkg) {
    throw new Error(`Missing package.json at ${pkgJsonPath}`);
  }
  return pkg;
}

async function expandWorkspaceDirs(repoRoot, workspaces) {
  const patterns = Array.isArray(workspaces)
    ? workspaces
    : Array.isArray(workspaces?.packages)
      ? workspaces.packages
      : [];

  const dirs = new Map();

  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      const resolvedDir = path.join(repoRoot, pattern);
      if (existsSync(path.join(resolvedDir, 'package.json'))) {
        dirs.set(path.relative(repoRoot, resolvedDir), resolvedDir);
      }
      continue;
    }

    if (!pattern.endsWith('/*')) continue;

    const baseDir = path.join(repoRoot, pattern.slice(0, -2));
    if (!existsSync(baseDir)) continue;

    const entries = await (await import('node:fs/promises')).readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const resolvedDir = path.join(baseDir, entry.name);
      if (!existsSync(path.join(resolvedDir, 'package.json'))) continue;
      dirs.set(path.relative(repoRoot, resolvedDir), resolvedDir);
    }
  }

  return Array.from(dirs.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, resolvedDir]) => resolvedDir);
}

function getDirectRuntimeDependencyNames(pkg) {
  return Array.from(
    new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {}),
    ]),
  ).sort();
}

function getInternalWorkspaceRefs(pkg, workspacePackageNames) {
  const refs = new Set();

  for (const field of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[field] || {})) {
      if (workspacePackageNames.has(name)) {
        refs.add(name);
      }
    }
  }

  return Array.from(refs).sort();
}

function sortObjectEntries(data) {
  return Object.fromEntries(
    Object.entries(data).sort((a, b) => a[0].localeCompare(b[0])),
  );
}

function normalizeNoticeTimestamp(content) {
  return String(content || '').replace(/^Generated at: .*$/m, 'Generated at: __TIMESTAMP__');
}

async function writeNormalizedJson(jsonPath, data) {
  const normalized = sortObjectEntries(data);
  await writeFile(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

function runNpmLs(repoRoot, workspace) {
  const isPnpm = existsSync(path.join(repoRoot, 'pnpm-lock.yaml'));
  const args = isPnpm 
    ? ['list', '--json', '--depth=Infinity']
    : ['ls', '--omit=dev', '--all', '--json'];
  
  if (workspace && !isPnpm) {
    args.push('--workspace', workspace);
  }

  const result = spawnSync(isPnpm ? 'pnpm' : 'npm', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  const output = String(result.stdout || '').trim();
  if (!output) {
    throw new Error(`${isPnpm ? 'pnpm' : 'npm'} ls returned no JSON for ${workspace || 'root'}: ${String(result.stderr || '').trim()}`);
  }

  const parsed = JSON.parse(output);
  
  // pnpm returns an array of workspace packages, npm returns a single object
  if (isPnpm) {
    if (workspace) {
      const workspaceEntry = parsed.find(entry => entry.name === workspace || entry.path.endsWith(workspace));
      if (!workspaceEntry) {
        throw new Error(`pnpm list: workspace ${workspace} not found`);
      }
      return workspaceEntry;
    }
    // For root, return the first entry (root package)
    return parsed[0];
  }
  
  return parsed;
}

function findInstalledPackageDir(packageName, startDir, repoRoot) {
  let currentDir = startDir;

  while (true) {
    const candidateDir = path.join(currentDir, 'node_modules', packageName);
    if (existsSync(path.join(candidateDir, 'package.json'))) {
      return candidateDir;
    }

    if (path.resolve(currentDir) === path.resolve(repoRoot)) {
      break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return null;
}

function inferLicenseFromText(text) {
  const normalizedText = String(text || '').replace(/\r/g, '');

  if (/mit license/i.test(normalizedText)) return 'MIT';
  if (/apache license/i.test(normalizedText) && /version 2(?:\.0)?/i.test(normalizedText)) return 'Apache-2.0';
  if (/the isc license/i.test(normalizedText)) return 'ISC';
  if (/permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted/i.test(normalizedText)) return 'ISC';
  if (/redistribution and use in source and binary forms/i.test(normalizedText)) {
    if (/neither the name/i.test(normalizedText)) return 'BSD-3-Clause';
    return 'BSD-2-Clause';
  }
  if (/this is free and unencumbered software released into the public domain/i.test(normalizedText)) return 'Unlicense';

  return '';
}

async function inferLicenseFromPackageDir(packageDir) {
  for (const manifestName of ['component.json', 'bower.json']) {
    const manifest = await loadJsonIfExists(path.join(packageDir, manifestName));
    const manifestLicense = normalizeLicenseField(manifest?.license || manifest?.licenses || '');
    if (manifestLicense && manifestLicense !== 'UNKNOWN') {
      return manifestLicense;
    }
  }

  const entries = await readdir(packageDir, { withFileTypes: true });
  const licenseEntry = entries.find((entry) => entry.isFile() && /^(license|licence|copying)(\.|$)/i.test(entry.name));
  if (!licenseEntry) {
    return 'UNKNOWN';
  }

  const licenseText = await readFile(path.join(packageDir, licenseEntry.name), 'utf8');
  return inferLicenseFromText(licenseText) || 'UNKNOWN';
}

async function readInstalledPackageMetadata(packageDir, metadataCache) {
  if (metadataCache.has(packageDir)) {
    return metadataCache.get(packageDir);
  }

  const pkg = await loadPackageJson(packageDir);
  const author = normalizePerson(pkg.author);
  const inferredLicense = await inferLicenseFromPackageDir(packageDir);
  const metadata = Object.fromEntries(
    Object.entries({
      licenses: normalizeLicenseField(pkg.license || pkg.licenses || inferredLicense || 'UNKNOWN'),
      repository: normalizeRepository(pkg.repository || pkg.homepage || ''),
      publisher: author.name || undefined,
      email: author.email || undefined,
      url: author.url || undefined,
    }).filter(([, value]) => value !== undefined && value !== ''),
  );

  metadataCache.set(packageDir, metadata);
  return metadata;
}

function mergeEntry(target, pkgKey, metadata) {
  const existing = target[pkgKey];
  if (!existing) {
    target[pkgKey] = { ...metadata };
    return;
  }

  if ((existing.licenses === 'UNKNOWN' || !existing.licenses) && metadata.licenses) {
    existing.licenses = metadata.licenses;
  }

  if (!existing.repository && metadata.repository) {
    existing.repository = metadata.repository;
  }

  if (!existing.publisher && metadata.publisher) {
    existing.publisher = metadata.publisher;
  }

  if (!existing.email && metadata.email) {
    existing.email = metadata.email;
  }

  if (!existing.url && metadata.url) {
    existing.url = metadata.url;
  }
}

async function walkResolvedDependencies({ entries, dependencies, parentDir, repoRoot, workspacePackageNames, metadataCache }) {
  for (const [packageName, node] of Object.entries(dependencies || {})) {
    if (!node || typeof node !== 'object') continue;

    const packageDir = findInstalledPackageDir(packageName, parentDir, repoRoot);
    if (!packageDir) continue;

    if (!workspacePackageNames.has(packageName)) {
      const version = typeof node.version === 'string' ? node.version : '';
      if (version) {
        const metadata = await readInstalledPackageMetadata(packageDir, metadataCache);
        mergeEntry(entries, `${packageName}@${version}`, metadata);
      }
    }

    await walkResolvedDependencies({
      entries,
      dependencies: node.dependencies,
      parentDir: packageDir,
      repoRoot,
      workspacePackageNames,
      metadataCache,
    });
  }
}

async function buildSourceEntries(source, context, seenInternalPackages = new Set()) {
  if (context.sourceEntriesCache.has(source.name)) {
    return context.sourceEntriesCache.get(source.name);
  }

  const entries = {};
  const runtimeDependencyNames = new Set(getDirectRuntimeDependencyNames(source.packageJson));
  const tree = source.isRoot
    ? context.rootTree || (context.rootTree = runNpmLs(context.repoRoot))
    : context.workspaceTreeCache.get(source.name) || (() => {
        const nextTree = runNpmLs(context.repoRoot, source.workspace);
        context.workspaceTreeCache.set(source.name, nextTree);
        return nextTree;
      })();

  const rootNode = source.isRoot ? tree : tree.dependencies?.[source.packageName];
  const dependencyNodes = source.isRoot ? tree.dependencies || {} : rootNode?.dependencies || {};

  for (const dependencyName of runtimeDependencyNames) {
    const node = dependencyNodes[dependencyName];
    if (!node || typeof node !== 'object') continue;

    const dependencyDir = findInstalledPackageDir(dependencyName, source.packageDir, context.repoRoot);
    if (!dependencyDir) continue;

    if (!context.workspacePackageNames.has(dependencyName)) {
      const version = typeof node.version === 'string' ? node.version : '';
      if (version) {
        const metadata = await readInstalledPackageMetadata(dependencyDir, context.metadataCache);
        mergeEntry(entries, `${dependencyName}@${version}`, metadata);
      }
    }

    await walkResolvedDependencies({
      entries,
      dependencies: node.dependencies,
      parentDir: dependencyDir,
      repoRoot: context.repoRoot,
      workspacePackageNames: context.workspacePackageNames,
      metadataCache: context.metadataCache,
    });
  }

  const nextSeen = new Set(seenInternalPackages);
  if (source.packageName) {
    nextSeen.add(source.packageName);
  }

  for (const internalPackageName of getInternalWorkspaceRefs(source.packageJson, context.workspacePackageNames)) {
    if (runtimeDependencyNames.has(internalPackageName)) continue;
    if (nextSeen.has(internalPackageName)) continue;

    const internalSource = context.workspaceSourcesByPackage.get(internalPackageName);
    if (!internalSource) continue;

    const nestedEntries = await buildSourceEntries(internalSource, context, new Set([...nextSeen, internalPackageName]));
    for (const [pkgKey, metadata] of Object.entries(nestedEntries)) {
      mergeEntry(entries, pkgKey, metadata);
    }
  }

  context.sourceEntriesCache.set(source.name, entries);
  return entries;
}

async function resolveSources(repoRoot) {
  const rootPackageJson = await loadPackageJson(repoRoot);
  const workspaceDirs = await expandWorkspaceDirs(repoRoot, rootPackageJson.workspaces || []);
  const workspaceSources = [];

  for (const workspaceDir of workspaceDirs) {
    const packageJson = await loadPackageJson(workspaceDir);
    workspaceSources.push({
      name: path.relative(repoRoot, workspaceDir),
      packageName: packageJson.name,
      packageDir: workspaceDir,
      packageJson,
      workspace: path.relative(repoRoot, workspaceDir),
      outputFile: path.join(workspaceDir, 'third_party_licenses.json'),
      isRoot: false,
    });
  }

  return {
    rootSource: {
      name: 'root',
      packageName: rootPackageJson.name || '',
      packageDir: repoRoot,
      packageJson: rootPackageJson,
      workspace: null,
      outputFile: path.join(repoRoot, 'third_party_licenses.json'),
      isRoot: true,
    },
    workspaceSources,
  };
}

async function main() {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptsDir, '..');
  const failOnIncompatible = String(process.env.EG_FAIL_ON_LICENSE_INCOMPATIBLE || 'false').toLowerCase() === 'true';

  const { rootSource, workspaceSources } = await resolveSources(repoRoot);
  const sources = [rootSource, ...workspaceSources];
  const generatedFiles = [rootSource.outputFile, ...workspaceSources.map((source) => source.outputFile)];

  const context = {
    repoRoot,
    rootTree: null,
    workspaceTreeCache: new Map(),
    metadataCache: new Map(),
    sourceEntriesCache: new Map(),
    workspaceSourcesByPackage: new Map(workspaceSources.map((source) => [source.packageName, source])),
    workspacePackageNames: new Set(workspaceSources.map((source) => source.packageName).filter(Boolean)),
  };

  const sourceEntries = new Map();
  for (const source of sources) {
    const entries = await buildSourceEntries(source, context);
    sourceEntries.set(source.name, entries);
    if (!source.isRoot) {
      await writeNormalizedJson(source.outputFile, entries);
    }
  }

  const aggregateEntries = {};
  for (const source of sources) {
    for (const [pkgKey, metadata] of Object.entries(sourceEntries.get(source.name) || {})) {
      mergeEntry(aggregateEntries, pkgKey, metadata);
    }
  }

  await writeNormalizedJson(rootSource.outputFile, aggregateEntries);

  const merged = new Map();

  // Exclude the workspace root packages themselves (we only want third-party dependencies).
  const excludedPackageKeys = new Set();
  for (const src of sources) {
    const pkg = src.packageJson;
    if (pkg?.name && pkg?.version) {
      excludedPackageKeys.add(`${pkg.name}@${pkg.version}`);
    }
  }

  for (const src of sources) {
    const data = sourceEntries.get(src.name) || {};
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

  const generatedAt = String(process.env.EG_NOTICES_GENERATED_AT || '').trim() || new Date().toISOString();

  const lines = [];
  lines.push('# THIRD_PARTY_NOTICES');
  lines.push('');
  lines.push('This project includes software developed by third parties. The following notices are provided for attribution purposes.');
  lines.push('');
  lines.push(`Generated at: ${generatedAt}`);
  lines.push('');
  lines.push('Generated from:');
  for (const generatedFile of generatedFiles) {
    lines.push(`- ${path.relative(repoRoot, generatedFile)}`);
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
  lines.push('# from repo root');
  lines.push('bash ./scripts/update-third-party-notices.sh');
  lines.push('# strict check (fails on potential Apache-2.0 incompatibility)');
  lines.push('bash ./scripts/update-third-party-notices.sh --check --strict');
  lines.push('```');
  lines.push('');

  const outputPath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
  const nextContent = `${lines.join('\n')}`;
  const existingContent = await readTextIfExists(outputPath);
  if (existingContent) {
    const normalizedExisting = normalizeNoticeTimestamp(existingContent);
    const normalizedNext = normalizeNoticeTimestamp(nextContent);
    if (normalizedExisting === normalizedNext) {
      const existingGeneratedAt = existingContent.match(/^Generated at: (.*)$/m)?.[1]?.trim();
      if (existingGeneratedAt) {
        const stabilizedContent = nextContent.replace(/^Generated at: .*$/m, `Generated at: ${existingGeneratedAt}`);
        await writeFile(outputPath, stabilizedContent, 'utf8');
      } else {
        await writeFile(outputPath, nextContent, 'utf8');
      }
    } else {
      await writeFile(outputPath, nextContent, 'utf8');
    }
  } else {
    await writeFile(outputPath, nextContent, 'utf8');
  }

  // Console output for CI / local usage
  console.log(`Wrote ${path.relative(repoRoot, outputPath)} with ${rows.length} entries.`);
  if (dualCopyleftOption.length > 0) console.log(`Dual-licensed with copyleft option: ${dualCopyleftOption.length}`);
  if (copyleft.length > 0) console.log(`Copyleft-flagged: ${copyleft.length}`);
  if (unknown.length > 0) console.log(`Unknown license: ${unknown.length}`);

  const alertSections = [];
  if (dualCopyleftOption.length > 0) alertSections.push(`dual-licensed with copyleft option=${dualCopyleftOption.length}`);
  if (copyleft.length > 0) alertSections.push(`copyleft-flagged=${copyleft.length}`);
  if (unknown.length > 0) alertSections.push(`unknown=${unknown.length}`);

  if (alertSections.length > 0) {
    console.warn(`ALERT: Possible Apache-2.0 incompatibility requires review (${alertSections.join(', ')}).`);
    console.warn('See THIRD_PARTY_NOTICES.md sections under "Review required" for package-level details.');
  }

  if (failOnIncompatible && alertSections.length > 0) {
    console.error('Failing because EG_FAIL_ON_LICENSE_INCOMPATIBLE=true and potential Apache-2.0 incompatibilities were detected.');
    process.exitCode = 2;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFilePath === currentFilePath) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export {
  expandWorkspaceDirs,
  getDirectRuntimeDependencyNames,
  getInternalWorkspaceRefs,
  inferLicenseFromPackageDir,
  inferLicenseFromText,
  main,
  normalizeNoticeTimestamp,
  normalizeLicenseField,
  splitNameAndVersion,
};
