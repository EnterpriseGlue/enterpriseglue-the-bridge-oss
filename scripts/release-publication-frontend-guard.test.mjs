import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { prepareFrontendGuard } from './release-publication-frontend-guard.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const oldPlugin = 'enterpriseglue-strip-external-carbon-font-faces';
const newPlugin = 'enterpriseglue-carbon-font-faces';
const guard = read('./check-frontend-self-contained.mjs');
const frozenVite = `
const externalCarbonFontHostname = '1.www.s81c.com'
const plugin = {
  postcssPlugin: 'enterpriseglue-carbon-font-faces',
  AtRule(atRule) {
    if (atRule.name !== 'font-face') return
    if (urlReferencesHostname(atRule.toString(), externalCarbonFontHostname)) {
      atRule.remove()
      return
    }
  },
}
`;
const earlierVite = frozenVite.replace(newPlugin, oldPlugin)
  .replace("if (atRule.name !== 'font-face') return", "if (atRule.name === 'font-face') {");

test('leaves the originally named Carbon plugin and its guard alone', () => {
  assert.equal(prepareFrontendGuard(guard, earlierVite), guard);
});

test('matches the font-display plugin by name while preserving every other guard assertion', () => {
  const expected = guard.replace(oldPlugin, newPlugin)
    .replace("atRule.name === 'font-face'", "if (atRule.name !== 'font-face') return");
  assert.equal(prepareFrontendGuard(guard, frozenVite), expected);
});

test('requires actual removal of external fonts before accepting the new plugin name', () => {
  assert.throws(() => prepareFrontendGuard(guard, frozenVite.replace('atRule.remove()', 'pass()')), /external-font removal/);
  assert.throws(() => prepareFrontendGuard(guard + guard, frozenVite), /guard assertion/);
  assert.throws(() => prepareFrontendGuard(guard, frozenVite.replace("if (atRule.name !== 'font-face') return", '')), /external-font removal/);
  assert.equal(prepareFrontendGuard(guard, frozenVite.replace(newPlugin, 'unreviewed-plugin')), guard);
});

test('runs the frozen guard through the publisher and restores it after a gate failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eg-frozen-font-gate-'));
  try {
    const origin = join(directory, 'origin');
    const checkout = join(directory, 'checkout');
    const commands = join(directory, 'commands');
    const temp = join(directory, 'temp');
    const env = {
      PATH: `${commands}:${process.env.PATH}`,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: directory,
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.test',
    };
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
    const put = (root, name, value) => {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, value);
    };
    const originalChecker = 'scripts/check-frontend-self-contained.mjs';
    const helper = 'scripts/release-publication-frontend-guard.mjs';
    put(origin, originalChecker, guard);
    put(origin, 'frontend/vite.config.ts', frozenVite);
    for (const file of ['frontend/index.html', 'frontend/nginx.conf', 'packages/frontend-host/src/main.tsx', 'packages/frontend-host/package.json']) {
      put(origin, file, read('../' + file));
    }
    git(origin, 'init', '-b', 'main');
    git(origin, 'add', '.');
    git(origin, 'commit', '-m', 'Frozen source');
    const source = git(origin, 'rev-parse', 'HEAD');
    git(origin, 'branch', 'frozen');
    put(origin, helper, read('./release-publication-frontend-guard.mjs'));
    git(origin, 'add', helper);
    git(origin, 'commit', '-m', 'Protected control');
    const workflowRevision = git(origin, 'rev-parse', 'HEAD');
    git(directory, 'clone', '--no-local', '--depth=1', '--branch', 'frozen', `file://${origin}`, checkout);
    mkdirSync(temp);
    mkdirSync(commands);
    writeFileSync(join(commands, 'pnpm'), '#!/bin/sh\nif [ "$1" = test:plugin-platform ]; then\n  node scripts/check-frontend-self-contained.mjs || exit $?\n  exit 42\nfi\n', { mode: 0o700 });

    const workflow = read('../.github/workflows/plugin-toolchain-release.yml');
    const start = workflow.indexOf('          set -euo pipefail', workflow.indexOf('- name: Run public plugin-platform and chart gates'));
    const end = workflow.indexOf('\n\n      - name:', start);
    const gate = workflow.slice(start, end).replace(/^          /gm, '');
    const result = spawnSync('bash', ['-c', gate], {
      cwd: checkout, encoding: 'utf8', timeout: 10000,
      env: { ...env, RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout, GITHUB_WORKFLOW_SHA: workflowRevision, SOURCE_REF: source },
    });
    assert.equal(result.status, 42, result.stderr);
    assert.match(result.stdout, /Self-contained frontend verification passed/);
    assert.equal(readFileSync(join(checkout, originalChecker), 'utf8'), guard);
    assert.equal(git(checkout, 'status', '--porcelain'), '');
    assert.equal(git(checkout, 'rev-parse', 'HEAD'), source);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
