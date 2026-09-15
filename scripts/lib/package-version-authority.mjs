import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_VERSION_AUTHORITY_PATH = 'scripts/package-version-authority.json';
export const PACKAGE_VERSION_PLAN_SCHEMA = 'enterpriseglue-package-version-plan/v1';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const semanticImpacts = new Set(['patch', 'minor', 'major']);
const packageImpacts = new Set(['initial', ...semanticImpacts]);
const dependencyFields = new Set([
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
]);

function fail(message) {
  throw new Error(message);
}

function assertRelativePath(value, context) {
  assert.equal(typeof value, 'string', `${context} must be a string`);
  assert.ok(value.length > 0, `${context} must not be empty`);
  assert.ok(!isAbsolute(value), `${context} must be repository-relative`);
  assert.ok(!value.replaceAll('\\', '/').split('/').includes('..'), `${context} must not escape the repository`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function parseSemanticVersion(value, context = 'version') {
  const match = String(value ?? '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) fail(`${context} must be an exact semantic version; received ${JSON.stringify(value)}`);
  return match.slice(1).map(Number);
}

export function semanticVersionImpact(previousVersion, nextVersion) {
  const previous = parseSemanticVersion(previousVersion, 'previous version');
  const next = parseSemanticVersion(nextVersion, 'next version');
  if (next[0] !== previous[0]) return next[0] > previous[0] ? 'major' : 'invalid';
  if (next[1] !== previous[1]) return next[1] > previous[1] ? 'minor' : 'invalid';
  if (next[2] !== previous[2]) return next[2] > previous[2] ? 'patch' : 'invalid';
  return 'none';
}

export function incrementSemanticVersion(version, impact) {
  assert.ok(semanticImpacts.has(impact), `unsupported semantic impact: ${impact}`);
  const [major, minor, patch] = parseSemanticVersion(version);
  if (impact === 'major') return `${major + 1}.0.0`;
  if (impact === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function validatePackageVersionAuthority(authority) {
  assert.equal(authority?.schemaVersion, 1, 'package version authority schemaVersion must be 1');
  assert.ok(Array.isArray(authority.packages) && authority.packages.length > 0, 'package version authority must list packages');
  assert.ok(Array.isArray(authority.publicationSets) && authority.publicationSets.length > 0, 'package version authority must list publication sets');
  assert.ok(Array.isArray(authority.versionBindings), 'package version authority must list versionBindings');
  assert.ok(Array.isArray(authority.independentArtifacts), 'package version authority must list independentArtifacts');

  const configuredFields = authority.dependencyPolicy?.workspaceFields;
  assert.ok(Array.isArray(configuredFields) && configuredFields.length > 0, 'dependencyPolicy.workspaceFields must not be empty');
  for (const field of configuredFields) {
    assert.ok(dependencyFields.has(field), `unsupported workspace dependency field: ${field}`);
  }
  assert.equal(
    authority.dependencyPolicy?.propagatedConsumerImpact,
    'patch',
    'packed workspace consumers must receive patch propagation',
  );
  for (const pattern of authority.sourceChangeExcludes ?? []) new RegExp(pattern);

  const packages = new Map();
  const packageManifests = new Set();
  const packageRoots = new Set();
  for (const entry of authority.packages) {
    assert.equal(typeof entry.name, 'string', 'package name must be a string');
    assert.ok(!packages.has(entry.name), `duplicate package authority entry: ${entry.name}`);
    assertRelativePath(entry.manifest, `${entry.name}.manifest`);
    assertRelativePath(entry.sourceRoot, `${entry.name}.sourceRoot`);
    assert.ok(entry.manifest.startsWith(`${entry.sourceRoot}/`), `${entry.name}.manifest must be below its sourceRoot`);
    assert.ok(!packageManifests.has(entry.manifest), `duplicate package manifest: ${entry.manifest}`);
    assert.ok(!packageRoots.has(entry.sourceRoot), `duplicate package sourceRoot: ${entry.sourceRoot}`);
    assert.equal(entry.versionPolicy, 'independent', `${entry.name} must declare independent semantic versioning`);
    packages.set(entry.name, entry);
    packageManifests.add(entry.manifest);
    packageRoots.add(entry.sourceRoot);
  }
  const roots = [...packageRoots];
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      assert.ok(
        !roots[left].startsWith(`${roots[right]}/`) && !roots[right].startsWith(`${roots[left]}/`),
        `package sourceRoots must not overlap: ${roots[left]} and ${roots[right]}`,
      );
    }
  }

  const assigned = new Set();
  const publicationSets = new Set();
  for (const set of authority.publicationSets) {
    assert.match(set.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'publication set id must be kebab-case');
    assert.ok(!publicationSets.has(set.id), `duplicate publication set: ${set.id}`);
    publicationSets.add(set.id);
    assert.equal(set.atomic, true, `${set.id} must publish as one qualified set`);
    assertRelativePath(set.workflow, `${set.id}.workflow`);
    assert.ok(Array.isArray(set.packages) && set.packages.length > 0, `${set.id} must list packages`);
    for (const name of set.packages) {
      assert.ok(packages.has(name), `${set.id} references unknown package ${name}`);
      assert.ok(!assigned.has(name), `${name} appears in more than one publication set`);
      assert.equal(packages.get(name).publicationSet, set.id, `${name} publicationSet disagrees with ${set.id}`);
      assigned.add(name);
    }
  }
  assert.deepEqual([...assigned].sort(), [...packages.keys()].sort(), 'every published package must appear in one publication set');

  const bindingIds = new Set();
  const boundTargets = new Set();
  for (const binding of authority.versionBindings) {
    assert.match(binding.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'version binding id must be kebab-case');
    assert.ok(!bindingIds.has(binding.id), `duplicate version binding: ${binding.id}`);
    bindingIds.add(binding.id);
    assert.ok(['package', 'json'].includes(binding.source?.type), `${binding.id} has unsupported source type`);
    if (binding.source.type === 'package') {
      assert.ok(packages.has(binding.source.name), `${binding.id} references unknown source package`);
    } else {
      assertRelativePath(binding.source.path, `${binding.id}.source.path`);
      assert.equal(typeof binding.source.field, 'string', `${binding.id}.source.field must be a string`);
    }
    assert.ok(Array.isArray(binding.targets) && binding.targets.length > 0, `${binding.id} must list targets`);
    for (const target of binding.targets) {
      assertRelativePath(target.path, `${binding.id}.target.path`);
      assert.equal(target.format, 'yaml', `${binding.id} supports YAML targets only`);
      assert.ok(Array.isArray(target.fields) && target.fields.length > 0, `${binding.id} target fields must not be empty`);
      for (const field of target.fields) {
        const key = `${target.path}:${field}`;
        assert.ok(!boundTargets.has(key), `version target must have one authority: ${key}`);
        boundTargets.add(key);
      }
    }
  }

  const artifactIds = new Set();
  for (const artifact of authority.independentArtifacts) {
    assert.match(artifact.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'artifact id must be kebab-case');
    assert.ok(!artifactIds.has(artifact.id), `duplicate independent artifact: ${artifact.id}`);
    artifactIds.add(artifact.id);
    assertRelativePath(artifact.manifest, `${artifact.id}.manifest`);
    assert.ok(['json', 'yaml'].includes(artifact.format), `${artifact.id} has unsupported format`);
    assert.equal(typeof artifact.versionField, 'string', `${artifact.id}.versionField must be a string`);
  }
  return authority;
}

export function loadPackageVersionAuthority(root = repositoryRoot) {
  const path = resolve(root, PACKAGE_VERSION_AUTHORITY_PATH);
  return validatePackageVersionAuthority(JSON.parse(readFileSync(path, 'utf8')));
}

export function publicationOrder(authority, setId) {
  const set = authority.publicationSets.find((entry) => entry.id === setId);
  assert.ok(set, `unknown publication set: ${setId}`);
  return [...set.packages];
}

export function publishedPackageForChangedPath(authority, path) {
  const excluded = (authority.sourceChangeExcludes ?? []).map((pattern) => new RegExp(pattern));
  for (const entry of authority.packages) {
    if (path === entry.manifest) return entry.name;
    const prefix = `${entry.sourceRoot}/`;
    if (!path.startsWith(prefix)) continue;
    const localPath = path.slice(prefix.length);
    if (!excluded.some((pattern) => pattern.test(localPath))) return entry.name;
  }
  return null;
}

export function workspacePackageDependencies(manifest, authority) {
  const publishedNames = new Set(authority.packages.map(({ name }) => name));
  const dependencies = new Set();
  for (const field of authority.dependencyPolicy.workspaceFields) {
    for (const [name, reference] of Object.entries(manifest[field] ?? {})) {
      if (publishedNames.has(name) && String(reference).startsWith('workspace:')) dependencies.add(name);
    }
  }
  return [...dependencies].sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readGitJson(root, revision, path) {
  try {
    return JSON.parse(git(root, ['show', `${revision}:${path}`]));
  } catch {
    return null;
  }
}

export function repositoryChangedPaths(root, baseRef) {
  const mergeBase = git(root, ['merge-base', baseRef, 'HEAD']);
  const tracked = git(root, ['diff', '--name-only', mergeBase, '--'])
    .split(/\r?\n/)
    .filter(Boolean);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/)
    .filter(Boolean);
  return {
    mergeBase,
    paths: [...new Set([...tracked, ...untracked])].sort(),
  };
}

function manifestMaterialChanged(root, mergeBase, entry) {
  const base = readGitJson(root, mergeBase, entry.manifest);
  const current = readJson(resolve(root, entry.manifest));
  if (!base) return true;
  const normalize = (manifest) => {
    const copy = structuredClone(manifest);
    delete copy.version;
    return canonicalJson(copy);
  };
  return JSON.stringify(normalize(base)) !== JSON.stringify(normalize(current));
}

export function directlyChangedPackages({ root, authority, mergeBase, paths }) {
  return authority.packages
    .filter((entry) => paths.some((path) => {
      if (path === entry.manifest) return manifestMaterialChanged(root, mergeBase, entry);
      return publishedPackageForChangedPath(authority, path) === entry.name;
    }))
    .map(({ name }) => name)
    .sort();
}

function changedReleaseFragments(root, paths) {
  return paths
    .filter((path) => /^\.release-notes\/[a-z0-9][a-z0-9-]*\.json$/.test(path))
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => ({ path, value: readJson(resolve(root, path)) }));
}

function packageRecords(root, authority, mergeBase) {
  return new Map(authority.packages.map((entry) => {
    const currentManifest = readJson(resolve(root, entry.manifest));
    assert.equal(currentManifest.name, entry.name, `${entry.manifest} name disagrees with the version authority`);
    parseSemanticVersion(currentManifest.version, `${entry.name} current version`);
    const baseManifest = readGitJson(root, mergeBase, entry.manifest);
    if (baseManifest?.version) parseSemanticVersion(baseManifest.version, `${entry.name} base version`);
    return [entry.name, {
      ...entry,
      currentManifest,
      currentVersion: currentManifest.version,
      baseManifest,
      baseVersion: baseManifest?.version ?? null,
      dependencies: workspacePackageDependencies(currentManifest, authority),
    }];
  }));
}

function releaseNotePackageEntries(fragments) {
  const entries = [];
  for (const fragment of fragments) {
    assert.ok(Array.isArray(fragment.value.packages), `${fragment.path}.packages must be an array`);
    for (const entry of fragment.value.packages) entries.push({ ...entry, fragment: fragment.path });
  }
  return entries;
}

export function createPackageVersionPlan({
  authority,
  records,
  directPackages,
  fragmentEntries,
  changedFiles = [],
  baseRef = '',
  mergeBase = '',
}) {
  const violations = [];
  const declarations = new Map();
  const desiredPackages = new Set();
  const reasons = new Map();
  const addReason = (name, reason) => {
    if (!reasons.has(name)) reasons.set(name, new Set());
    reasons.get(name).add(reason);
  };

  for (const entry of fragmentEntries) {
    if (!records.has(entry.name)) {
      violations.push(`${entry.fragment} references package not governed by ${PACKAGE_VERSION_AUTHORITY_PATH}: ${entry.name}`);
      continue;
    }
    if (!packageImpacts.has(entry.impact)) {
      violations.push(`${entry.fragment} has unsupported package impact for ${entry.name}: ${entry.impact}`);
      continue;
    }
    try {
      parseSemanticVersion(entry.newVersion, `${entry.fragment} ${entry.name} newVersion`);
      if (entry.previousVersion === null) {
        if (entry.impact !== 'initial') {
          violations.push(`${entry.fragment} must declare initial for new package ${entry.name}`);
        }
      } else {
        parseSemanticVersion(entry.previousVersion, `${entry.fragment} ${entry.name} previousVersion`);
        const actualImpact = semanticVersionImpact(entry.previousVersion, entry.newVersion);
        if (actualImpact !== entry.impact) {
          violations.push(`${entry.fragment} declares ${entry.name} impact ${entry.impact}; ${entry.previousVersion} -> ${entry.newVersion} is ${actualImpact}`);
        }
      }
    } catch (error) {
      violations.push(error.message);
    }
    if (!declarations.has(entry.name)) declarations.set(entry.name, []);
    declarations.get(entry.name).push(entry);
    desiredPackages.add(entry.name);
    addReason(entry.name, `release-note:${entry.fragment}`);
  }

  for (const name of directPackages) {
    addReason(name, 'direct-source-change');
    desiredPackages.add(name);
    if (!declarations.has(name)) {
      const suggestion = records.get(name)?.baseVersion ? 'patch' : 'initial';
      violations.push(`${name} has publishable source changes but no package entry in a changed release-note fragment; ${suggestion} is the default suggestion`);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [consumerName, record] of records) {
      const changedDependencies = record.dependencies.filter((name) => desiredPackages.has(name));
      if (changedDependencies.length === 0) continue;
      for (const dependency of changedDependencies) addReason(consumerName, `packed-workspace-consumer:${dependency}`);
      if (!desiredPackages.has(consumerName)) {
        desiredPackages.add(consumerName);
        changed = true;
      }
    }
  }

  for (const [name, record] of records) {
    if (!record.baseVersion) continue;
    const actualImpact = semanticVersionImpact(record.baseVersion, record.currentVersion);
    if (!desiredPackages.has(name) && actualImpact !== 'none') {
      violations.push(`${name} changed version ${record.baseVersion} -> ${record.currentVersion} without a source, dependency, or release-note reason`);
    }
  }

  const packagePlan = [...desiredPackages]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const record = records.get(name);
      assert.ok(record, `missing package record for ${name}`);
      const packageDeclarations = declarations.get(name) ?? [];
      let expectedVersion;
      let impact;

      if (!record.baseVersion) {
        const initialDeclarations = packageDeclarations.filter(
          (entry) => entry.previousVersion === null && entry.impact === 'initial',
        );
        if (initialDeclarations.length !== 1 || packageDeclarations.length !== 1) {
          violations.push(`${name} is new at the comparison base and requires exactly one initial release-note package entry`);
        }
        expectedVersion = initialDeclarations[0]?.newVersion ?? record.currentVersion;
        impact = 'initial';
      } else {
        const byPreviousVersion = new Map();
        for (const entry of packageDeclarations) {
          if (entry.previousVersion === null) continue;
          if (byPreviousVersion.has(entry.previousVersion)) {
            violations.push(`${name} has more than one release-note package entry starting at ${entry.previousVersion}`);
            continue;
          }
          byPreviousVersion.set(entry.previousVersion, entry);
        }
        let cursor = record.baseVersion;
        const consumed = new Set();
        while (byPreviousVersion.has(cursor)) {
          const entry = byPreviousVersion.get(cursor);
          if (consumed.has(entry)) break;
          consumed.add(entry);
          cursor = entry.newVersion;
        }
        if (consumed.size !== packageDeclarations.length) {
          violations.push(`${name} release-note package entries must form one continuous chain from ${record.baseVersion}`);
        }
        if (consumed.size === 0) {
          impact = authority.dependencyPolicy.propagatedConsumerImpact;
          expectedVersion = incrementSemanticVersion(record.baseVersion, impact);
          violations.push(`${name} requires a release-note package entry for ${record.baseVersion} -> ${expectedVersion} (${impact})`);
        } else {
          expectedVersion = cursor;
          impact = semanticVersionImpact(record.baseVersion, expectedVersion);
        }
      }

      if (record.currentVersion !== expectedVersion) {
        violations.push(`${name} must be ${expectedVersion} for a ${impact} change from ${record.baseVersion}; found ${record.currentVersion}`);
      }
      return {
        name,
        publicationSet: record.publicationSet,
        previousVersion: record.baseVersion,
        currentVersion: record.currentVersion,
        expectedVersion,
        impact,
        reasons: [...(reasons.get(name) ?? [])].sort(),
      };
    });

  return {
    schemaVersion: PACKAGE_VERSION_PLAN_SCHEMA,
    status: violations.length === 0 ? 'passed' : 'blocked',
    baseRef,
    mergeBase,
    changedFiles,
    directPackages,
    packages: packagePlan,
    violations: [...new Set(violations)],
  };
}

function yamlField(content, field, path) {
  const matches = [...content.matchAll(new RegExp(`^${field}:\\s*["']?([^"'\\s#]+)["']?\\s*(?:#.*)?$`, 'gm'))];
  assert.equal(matches.length, 1, `${path} must contain exactly one top-level ${field}`);
  return matches[0][1];
}

function sourceVersion(root, binding, records) {
  if (binding.source.type === 'package') return records.get(binding.source.name).currentVersion;
  const value = readJson(resolve(root, binding.source.path))[binding.source.field];
  parseSemanticVersion(value, `${binding.id} source version`);
  return value;
}

function artifactVersion(root, artifact) {
  const path = resolve(root, artifact.manifest);
  if (artifact.format === 'json') return readJson(path)[artifact.versionField];
  return yamlField(readFileSync(path, 'utf8'), artifact.versionField, artifact.manifest);
}

export function validateVersionBindings({ root, authority, records }) {
  const bindings = [];
  const violations = [];
  for (const binding of authority.versionBindings) {
    const expectedVersion = sourceVersion(root, binding, records);
    parseSemanticVersion(expectedVersion, `${binding.id} expected version`);
    for (const target of binding.targets) {
      const content = readFileSync(resolve(root, target.path), 'utf8');
      for (const field of target.fields) {
        const actualVersion = yamlField(content, field, target.path);
        if (actualVersion !== expectedVersion) {
          violations.push(`${target.path} ${field} must match ${binding.id} at ${expectedVersion}; found ${actualVersion}`);
        }
        bindings.push({
          id: binding.id,
          path: target.path,
          field,
          expectedVersion,
          actualVersion,
        });
      }
    }
  }
  for (const artifact of authority.independentArtifacts) {
    const version = artifactVersion(root, artifact);
    try {
      parseSemanticVersion(version, `${artifact.id} version`);
    } catch (error) {
      violations.push(error.message);
    }
  }
  return { bindings, violations };
}

export function validatePublicationOrder({ authority, records }) {
  const violations = [];
  for (const set of authority.publicationSets) {
    const positions = new Map(set.packages.map((name, index) => [name, index]));
    for (const name of set.packages) {
      for (const dependency of records.get(name).dependencies) {
        if (!positions.has(dependency)) continue;
        if (positions.get(dependency) >= positions.get(name)) {
          violations.push(`${set.id} must publish ${dependency} before its consumer ${name}`);
        }
      }
    }
  }
  return violations;
}

export function planRepositoryPackageVersions({ root = repositoryRoot, baseRef = 'origin/main' } = {}) {
  const authority = loadPackageVersionAuthority(root);
  const { mergeBase, paths } = repositoryChangedPaths(root, baseRef);
  const records = packageRecords(root, authority, mergeBase);
  const fragments = changedReleaseFragments(root, paths);
  const directPackages = directlyChangedPackages({ root, authority, mergeBase, paths });
  const plan = createPackageVersionPlan({
    authority,
    records,
    directPackages,
    fragmentEntries: releaseNotePackageEntries(fragments),
    changedFiles: paths,
    baseRef,
    mergeBase,
  });
  const bindings = validateVersionBindings({ root, authority, records });
  plan.bindings = bindings.bindings;
  plan.violations.push(...bindings.violations, ...validatePublicationOrder({ authority, records }));
  plan.violations = [...new Set(plan.violations)];
  plan.status = plan.violations.length === 0 ? 'passed' : 'blocked';
  return plan;
}

function replaceYamlField(content, field, version, path) {
  const expression = new RegExp(`^(${field}:\\s*)(["']?)([^"'\\s#]+)(["']?)(\\s*(?:#.*)?)$`, 'gm');
  const matches = [...content.matchAll(expression)];
  assert.equal(matches.length, 1, `${path} must contain exactly one top-level ${field}`);
  return content.replace(expression, (_match, prefix, openingQuote, _old, closingQuote, suffix) => {
    const quote = openingQuote || closingQuote;
    return `${prefix}${quote}${version}${quote}${suffix}`;
  });
}

function applyVersionBindings({ root, authority, records }) {
  for (const binding of authority.versionBindings) {
    const expectedVersion = sourceVersion(root, binding, records);
    for (const target of binding.targets) {
      const path = resolve(root, target.path);
      let content = readFileSync(path, 'utf8');
      for (const field of target.fields) content = replaceYamlField(content, field, expectedVersion, target.path);
      writeFileSync(path, content);
    }
  }
}

export function applyRepositoryPackageVersions({
  root = repositoryRoot,
  baseRef = 'origin/main',
  fragmentPath,
  requestedImpacts = new Map(),
} = {}) {
  assertRelativePath(fragmentPath, 'release-note fragment path');
  assert.match(fragmentPath, /^\.release-notes\/[a-z0-9][a-z0-9-]*\.json$/, 'release-note fragment must be a kebab-case JSON file under .release-notes');
  const authority = loadPackageVersionAuthority(root);
  const { mergeBase, paths } = repositoryChangedPaths(root, baseRef);
  const records = packageRecords(root, authority, mergeBase);
  const directPackages = directlyChangedPackages({ root, authority, mergeBase, paths });
  const fragmentFile = resolve(root, fragmentPath);
  const fragment = readJson(fragmentFile);
  assert.ok(Array.isArray(fragment.packages), `${fragmentPath}.packages must be an array`);

  const impacts = new Map();
  for (const entry of fragment.packages) {
    if (records.has(entry.name) && semanticImpacts.has(entry.impact)) impacts.set(entry.name, entry.impact);
  }
  for (const [name, impact] of requestedImpacts) {
    assert.ok(records.has(name), `unknown published package: ${name}`);
    assert.ok(semanticImpacts.has(impact), `unsupported semantic impact for ${name}: ${impact}`);
    impacts.set(name, impact);
  }
  const missing = directPackages.filter((name) => !impacts.has(name));
  assert.deepEqual(missing, [], `select --bump name=patch|minor|major for directly changed packages: ${missing.join(', ')}`);

  let changed = true;
  while (changed) {
    changed = false;
    for (const [consumerName, record] of records) {
      if (!record.dependencies.some((name) => impacts.has(name))) continue;
      if (!impacts.has(consumerName)) {
        impacts.set(consumerName, authority.dependencyPolicy.propagatedConsumerImpact);
        changed = true;
      }
    }
  }

  const appliedEntries = [];
  for (const [name, impact] of [...impacts].sort(([left], [right]) => left.localeCompare(right))) {
    const record = records.get(name);
    assert.ok(record.baseVersion, `${name} is not present at the comparison base`);
    const newVersion = incrementSemanticVersion(record.baseVersion, impact);
    record.currentManifest.version = newVersion;
    record.currentVersion = newVersion;
    writeFileSync(resolve(root, record.manifest), `${JSON.stringify(record.currentManifest, null, 2)}\n`);
    appliedEntries.push({
      name,
      previousVersion: record.baseVersion,
      newVersion,
      impact,
    });
  }

  const governedNames = new Set(records.keys());
  fragment.packages = [
    ...fragment.packages.filter((entry) => !governedNames.has(entry.name)),
    ...appliedEntries,
  ].sort((left, right) => left.name.localeCompare(right.name));
  writeFileSync(fragmentFile, `${JSON.stringify(fragment, null, 2)}\n`);
  applyVersionBindings({ root, authority, records });
  return planRepositoryPackageVersions({ root, baseRef });
}

export function repositoryRootForVersionAuthority() {
  return repositoryRoot;
}
