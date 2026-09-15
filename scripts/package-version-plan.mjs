#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyRepositoryPackageVersions,
  planRepositoryPackageVersions,
  repositoryRootForVersionAuthority,
} from './lib/package-version-authority.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/package-version-plan.mjs plan [--base-ref origin/main]',
    '  node scripts/package-version-plan.mjs check [--base-ref origin/main]',
    '  node scripts/package-version-plan.mjs apply --fragment .release-notes/change.json --bump name=patch|minor|major [--bump ...] [--base-ref origin/main]',
  ].join('\n');
}

export function parsePackageVersionPlanArguments(argv) {
  const values = argv[0] === '--' ? argv.slice(1) : argv;
  const command = values[0];
  if (!['plan', 'check', 'apply'].includes(command)) throw new Error(usage());
  const options = {
    command,
    baseRef: 'origin/main',
    fragmentPath: '',
    requestedImpacts: new Map(),
  };
  for (let index = 1; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (flag === '--base-ref') {
      if (!value) throw new Error('--base-ref requires a value');
      options.baseRef = value;
      index += 1;
      continue;
    }
    if (flag === '--fragment') {
      if (!value) throw new Error('--fragment requires a value');
      options.fragmentPath = value;
      index += 1;
      continue;
    }
    if (flag === '--bump') {
      if (!value) throw new Error('--bump requires name=patch|minor|major');
      const separator = value.lastIndexOf('=');
      if (separator <= 0) throw new Error(`invalid --bump value: ${value}`);
      const name = value.slice(0, separator);
      const impact = value.slice(separator + 1);
      if (!['patch', 'minor', 'major'].includes(impact)) throw new Error(`invalid --bump impact for ${name}: ${impact}`);
      if (options.requestedImpacts.has(name)) throw new Error(`duplicate --bump package: ${name}`);
      options.requestedImpacts.set(name, impact);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${flag}\n${usage()}`);
  }
  if (command === 'apply') {
    if (!options.fragmentPath) throw new Error('apply requires --fragment');
    if (options.requestedImpacts.size === 0) throw new Error('apply requires at least one --bump');
  } else if (options.fragmentPath || options.requestedImpacts.size > 0) {
    throw new Error('--fragment and --bump are valid only with apply');
  }
  return options;
}

function renderTextSummary(plan) {
  const lines = [
    `Package version plan: ${plan.status}`,
    `Base: ${plan.baseRef} (${plan.mergeBase})`,
    `Direct package changes: ${plan.directPackages.join(', ') || 'none'}`,
  ];
  for (const entry of plan.packages) {
    lines.push(
      `- ${entry.name}: ${entry.previousVersion} -> ${entry.expectedVersion} (${entry.impact}; ${entry.reasons.join(', ')})`,
    );
  }
  for (const violation of plan.violations) lines.push(`ERROR: ${violation}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const options = parsePackageVersionPlanArguments(process.argv.slice(2));
  const root = repositoryRootForVersionAuthority();
  const plan = options.command === 'apply'
    ? applyRepositoryPackageVersions({
      root,
      baseRef: options.baseRef,
      fragmentPath: options.fragmentPath,
      requestedImpacts: options.requestedImpacts,
    })
    : planRepositoryPackageVersions({ root, baseRef: options.baseRef });

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.stderr.write(renderTextSummary(plan));
  if (options.command !== 'plan' && plan.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
