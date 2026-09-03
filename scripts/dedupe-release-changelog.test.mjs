import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupeReleaseSection } from './dedupe-release-changelog.mjs';

const link = (summary, commit) => `* ${summary} ([${commit}](https://github.test/commit/${commit}))`;

test('removes only a child entry already represented by its merge commit', () => {
  const input = [
    '# Changelog',
    '',
    '## [1.2.0]',
    '',
    '### Features',
    '',
    link('add feature', 'aaaaaaa'),
    link('add feature', 'bbbbbbb'),
    link('same title but independent', 'ccccccc'),
    link('same title but independent', 'ddddddd'),
    '',
    '## [1.1.0]',
    link('historical duplicate remains immutable', 'eeeeeee'),
    link('historical duplicate remains immutable', 'fffffff'),
    '',
  ].join('\n');
  const output = dedupeReleaseSection(input, (left, right) => (
    left === 'aaaaaaa' && right === 'bbbbbbb' ? 'left-merge' : null
  ));
  assert.match(output, /\[aaaaaaa\]/);
  assert.doesNotMatch(output, /\[bbbbbbb\]/);
  assert.match(output, /\[ccccccc\]/);
  assert.match(output, /\[ddddddd\]/);
  assert.match(output, /\[eeeeeee\][\s\S]*\[fffffff\]/);
});

test('keeps entries with equal text when their commits are unrelated', () => {
  const input = `## [1.0.0]\n${link('legitimate repeated fix', 'aaaaaaa')}\n${link('legitimate repeated fix', 'bbbbbbb')}\n`;
  assert.equal(dedupeReleaseSection(input, () => null), input);
});
