#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT_LINK = /^(\* .+?) \(\[([0-9a-f]{7,40})\]\([^)]*\/commit\/[0-9a-f]{7,40}\)\)$/;

export function dedupeReleaseSection(text, isMergeDuplicate) {
  const lines = text.split('\n');
  const firstRelease = lines.findIndex((line) => /^## \[/.test(line));
  if (firstRelease === -1) return text;
  const nextReleaseOffset = lines.slice(firstRelease + 1).findIndex((line) => /^## \[/.test(line));
  const end = nextReleaseOffset === -1 ? lines.length : firstRelease + 1 + nextReleaseOffset;
  const remove = new Set();
  const entries = [];

  for (let index = firstRelease + 1; index < end; index += 1) {
    const match = lines[index].match(COMMIT_LINK);
    if (!match) continue;
    const entry = { index, summary: match[1], commit: match[2] };
    for (const previous of entries) {
      if (previous.summary !== entry.summary) continue;
      const relation = isMergeDuplicate(previous.commit, entry.commit);
      if (relation === 'left-merge') {
        remove.add(entry.index);
        break;
      }
      if (relation === 'right-merge') {
        remove.add(previous.index);
      }
    }
    entries.push(entry);
  }

  return lines.filter((_line, index) => !remove.has(index)).join('\n');
}

function gitOutput(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function resolveCommit(reference) {
  return gitOutput(['rev-parse', '--verify', `${reference}^{commit}`]);
}

function mergeParents(commit) {
  return gitOutput(['show', '-s', '--format=%P', commit]).split(/\s+/).filter(Boolean);
}

function isAncestor(ancestor, descendant) {
  return spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}

function gitMergeDuplicate(leftReference, rightReference) {
  const left = resolveCommit(leftReference);
  const right = resolveCommit(rightReference);
  const leftParents = mergeParents(left);
  if (leftParents.length > 1 && isAncestor(right, leftParents[1])) return 'left-merge';
  const rightParents = mergeParents(right);
  if (rightParents.length > 1 && isAncestor(left, rightParents[1])) return 'right-merge';
  return null;
}

async function main() {
  const [flag, filename] = process.argv.slice(2);
  if (flag !== '--file' || !filename) throw new Error('usage: dedupe-release-changelog.mjs --file CHANGELOG.md');
  const path = resolve(filename);
  const original = await readFile(path, 'utf8');
  const deduplicated = dedupeReleaseSection(original, gitMergeDuplicate);
  if (deduplicated !== original) await writeFile(path, deduplicated);
  process.stdout.write(`${JSON.stringify({ file: path, changed: deduplicated !== original })}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
