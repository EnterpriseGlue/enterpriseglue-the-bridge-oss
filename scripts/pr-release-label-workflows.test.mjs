import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflows = [
  '.github/workflows/pr-ai-assistant.yml',
  '.github/workflows/pr-release-labeler.yml',
];
const breakingDetectionWorkflows = [...workflows, '.github/workflows/release-policy.yml'];

for (const workflowPath of workflows) {
  test(`${workflowPath} tolerates concurrent release-label removal`, () => {
    const workflow = readFileSync(new URL(`../${workflowPath}`, import.meta.url), 'utf8');
    const removalLoop = workflow.match(
      /for \(const label of existingReleaseLabels\)[\s\S]*?Release label already removed by another workflow: \$\{label\}/,
    )?.[0] ?? '';

    assert.match(removalLoop, /github\.rest\.issues\.removeLabel/);
    assert.match(removalLoop, /if \(error\.status !== 404\) throw error/);
  });
}

for (const workflowPath of breakingDetectionWorkflows) {
  test(`${workflowPath} does not treat an unchecked breaking-change box as affirmative`, () => {
    const workflow = readFileSync(new URL(`../${workflowPath}`, import.meta.url), 'utf8');

    assert.match(workflow, /\\\[\[xX\]\\\]\\s\*breaking change/);
    assert.match(workflow, /BREAKING\[ -\]CHANGE/);
    assert.doesNotMatch(workflow, /body(?:IndicatesBreaking|DeclaresBreaking)?\s*=\s*\/breaking\\s\+change/i);
  });
}

test('release policy refreshes labels for concurrent label mutation events', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release-policy.yml', import.meta.url), 'utf8');

  assert.match(
    workflow,
    /const needsFresh = \[[^\]]*'opened'[^\]]*'labeled'[^\]]*'unlabeled'[^\]]*\]\.includes/,
  );
  assert.match(workflow, /await new Promise\(\(r\) => setTimeout\(r, 15000\)\)/);
  assert.match(workflow, /github\.rest\.pulls\.get/);
  assert.match(workflow, /labels = \(freshPR\.labels \|\| \[\]\)\.map/);
});

test('Release Please breaking changelog headings select the breaking label', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/pr-release-labeler.yml', import.meta.url),
    'utf8',
  );
  const patternMatch = workflow.match(
    /const breakingChangelogHeading = \/(\^\\\+[^/]+)\/i;/,
  );

  assert.ok(patternMatch, 'expected an inline breaking-changelog heading contract');
  const breakingChangelogHeading = new RegExp(patternMatch[1], 'i');

  assert.equal(breakingChangelogHeading.test('+### ⚠ BREAKING CHANGES'), true);
  assert.equal(breakingChangelogHeading.test('+### ⚠️ BREAKING CHANGES'), true);
  assert.equal(breakingChangelogHeading.test('+### BREAKING CHANGES'), true);
  assert.equal(breakingChangelogHeading.test(' ### ⚠ BREAKING CHANGES'), false);
  assert.equal(breakingChangelogHeading.test('+### Bug Fixes'), false);
  assert.match(
    workflow,
    /const releasePleaseDeclaresBreaking = isReleasePleaseBranch && files\.some/,
  );
  assert.match(workflow, /file\.filename === 'CHANGELOG\.md'/);
  assert.match(
    workflow,
    /const isBreaking = [^;]+\|\| releasePleaseDeclaresBreaking;/,
  );
});

test('PR AI Assistant does not mutate Release Please-owned pull requests', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/pr-ai-assistant.yml', import.meta.url),
    'utf8',
  );
  const autoApplyStep = workflow.split('- name: Auto-apply title and label (optional)')[1] ?? '';
  const releasePleaseGuard = autoApplyStep.indexOf(
    "const isReleasePleaseBranch = String(freshPR.head?.ref || '').startsWith('release-please--branches--');",
  );
  const labelMutation = autoApplyStep.indexOf('github.rest.issues.removeLabel');
  const titleMutation = autoApplyStep.indexOf('github.rest.pulls.update');

  assert.ok(releasePleaseGuard >= 0, 'expected a Release Please ownership guard');
  assert.match(
    autoApplyStep.slice(releasePleaseGuard, labelMutation),
    /if \(isReleasePleaseBranch\) \{[\s\S]*?return;/,
  );
  assert.ok(releasePleaseGuard < labelMutation, 'ownership guard must precede label mutation');
  assert.ok(releasePleaseGuard < titleMutation, 'ownership guard must precede title mutation');
});
