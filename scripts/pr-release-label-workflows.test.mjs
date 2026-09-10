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

test('deprecations use feat titles and minor impact across release automation', () => {
  const policy = readFileSync(new URL('../.github/workflows/release-policy.yml', import.meta.url), 'utf8');
  const assistant = readFileSync(new URL('../.github/workflows/pr-ai-assistant.yml', import.meta.url), 'utf8');
  const labeler = readFileSync(new URL('../.github/workflows/pr-release-labeler.yml', import.meta.url), 'utf8');
  const mappedLabels = (source, type) => [
    ...source.matchAll(new RegExp(`${type}: new Set\\(\\[([^\\]]*)\\]\\)`, 'g')),
  ].map((match) => match[1]);

  const policyFeat = mappedLabels(policy, 'feat');
  const policyRefactor = mappedLabels(policy, 'refactor');
  assert.equal(policyFeat.length, 1);
  assert.equal(policyRefactor.length, 1);
  assert.match(policyFeat[0], /'release:deprecation'/);
  assert.doesNotMatch(policyRefactor[0], /'release:deprecation'/);

  const assistantFeat = mappedLabels(assistant, 'feat');
  const assistantRefactor = mappedLabels(assistant, 'refactor');
  assert.equal(assistantFeat.length, 2);
  assert.equal(assistantRefactor.length, 2);
  assistantFeat.forEach((labels) => assert.match(labels, /'release:deprecation'/));
  assistantRefactor.forEach((labels) => assert.doesNotMatch(labels, /'release:deprecation'/));
  assert.deepEqual(
    [...assistant.matchAll(/'release:deprecation': '([a-z]+)'/g)].map((match) => match[1]),
    ['feat', 'feat'],
  );
  assert.match(assistant, /Deprecations use release:deprecation, minor impact, and a feat title/);
  assert.match(assistant, /else if \(deprecation\) \{\s+releaseLabel = 'release:deprecation';\s+impact = 'minor';\s+type = 'feat';/);
  assert.match(assistant, /if \(safeLabel === 'release:deprecation'\) safeImpact = 'minor';/);

  assert.match(
    labeler,
    /const describesDeprecation = [^;]+;\s+const isDeprecation = titleType === 'feat' && describesDeprecation;/,
  );
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

test('release-note preflight waits for the actual Release Please breaking label', () => {
  const preflight = readFileSync(
    new URL('../.github/workflows/release-notes-preflight-reusable.yml', import.meta.url),
    'utf8',
  );

  assert.match(
    preflight,
    /String\(pullRequest\.head\?\.ref \|\| ''\)\.startsWith\('release-please--branches--'\)/,
  );
  assert.match(
    preflight,
    /String\(pullRequest\.head\?\.repo\?\.full_name \|\| ''\) === `\$\{context\.repo\.owner\}\/\$\{context\.repo\.repo\}`/,
  );
  assert.match(preflight, /BREAKING CHANGES/);
  assert.match(
    preflight,
    /releaseLabels\.length === 1 && releaseLabels\[0\] === 'release:breaking'/,
  );
  assert.match(preflight, /const waitForAutomaticLabel = isRepositoryReleasePlease \|\|/);
  assert.match(preflight, /attempt <= 6/);
  assert.doesNotMatch(preflight, /labels\.push\('release:breaking'\)/);
});
