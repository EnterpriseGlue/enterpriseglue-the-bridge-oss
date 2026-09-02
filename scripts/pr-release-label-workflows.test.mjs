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
